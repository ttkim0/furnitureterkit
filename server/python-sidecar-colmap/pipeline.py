"""
The actual scan pipeline. Pure functions; main.py just orchestrates.

Algorithms (all classical, no ML weights):
  1. ffmpeg     : video → ~30 evenly-spaced keyframes
  2. COLMAP     : Structure-from-Motion (sparse) + patch-match stereo (dense)
                  → colored fused point cloud (fused.ply)
  3. Manhattan  : PCA on z-axis to find "up" direction, rotate so floor is +y
  4. Open3D     : RANSAC plane fitting
                  - Largest horizontal plane near min y = FLOOR
                  - Largest vertical planes (mostly orthogonal pairs) = WALLS
                  - Heights from floor → walls top out at ceiling
  5. Layout     : Each wall plane → start/end XZ + height. Convert into
                  the same Wall/Door/Window/Bbox shape SpatialLM emits so
                  the React renderer doesn't have to know which sidecar
                  produced the output.

We deliberately don't try to detect doors / windows from a point cloud —
that's where SpatialLM has a real edge (semantic LLM). For COLMAP-only
scans we just leave those arrays empty; the room reads as bare walls,
which is honest and still useful for furniture placement.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import numpy as np


def extract_frames(
    video: Path, job_dir: Path, n_frames: int, ffmpeg_bin: str
) -> Path:
    """Use ffmpeg to extract ~n_frames evenly-spaced JPEG keyframes."""
    frames_dir = job_dir / "frames"
    frames_dir.mkdir(exist_ok=True)
    # Probe duration via ffprobe (ships with ffmpeg)
    probe = subprocess.run(
        [
            ffmpeg_bin.replace("ffmpeg", "ffprobe"),
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    duration = float(probe.stdout.strip())
    if duration <= 0:
        raise RuntimeError(f"video has zero/unknown duration: {duration}")
    fps = max(0.5, n_frames / duration)
    subprocess.run(
        [
            ffmpeg_bin,
            "-y",
            "-i",
            str(video),
            "-vf",
            f"fps={fps}",
            "-q:v",
            "2",
            str(frames_dir / "frame_%04d.jpg"),
        ],
        check=True,
        capture_output=True,
    )
    n_extracted = len(list(frames_dir.glob("frame_*.jpg")))
    if n_extracted < 3:
        raise RuntimeError(
            f"only extracted {n_extracted} frame(s) — video may be too short or unreadable"
        )
    print(
        f"[colmap-sidecar] extracted {n_extracted} frames at {fps:.2f} fps",
        flush=True,
    )
    return frames_dir


def run_colmap_sparse(
    frames_dir: Path, job_dir: Path, colmap_bin: str, use_gpu: bool
) -> Path:
    """
    COLMAP feature extraction → matching → mapper.
    Outputs sparse reconstruction in job_dir/sparse/0/.
    """
    db_path = job_dir / "colmap.db"
    sparse_dir = job_dir / "sparse"
    sparse_dir.mkdir(exist_ok=True)
    gpu_flag = "1" if use_gpu else "0"

    # 1. Feature extraction
    subprocess.run(
        [
            colmap_bin,
            "feature_extractor",
            "--database_path",
            str(db_path),
            "--image_path",
            str(frames_dir),
            "--ImageReader.single_camera",
            "1",
            "--SiftExtraction.use_gpu",
            gpu_flag,
        ],
        check=True,
        capture_output=True,
    )

    # 2. Exhaustive matching — fine for ≤50 images
    subprocess.run(
        [
            colmap_bin,
            "exhaustive_matcher",
            "--database_path",
            str(db_path),
            "--SiftMatching.use_gpu",
            gpu_flag,
        ],
        check=True,
        capture_output=True,
    )

    # 3. Mapper — sparse reconstruction
    subprocess.run(
        [
            colmap_bin,
            "mapper",
            "--database_path",
            str(db_path),
            "--image_path",
            str(frames_dir),
            "--output_path",
            str(sparse_dir),
        ],
        check=True,
        capture_output=True,
    )

    # COLMAP writes models as numbered subdirs (0, 1, …). Take the first.
    model_dirs = sorted([p for p in sparse_dir.iterdir() if p.is_dir()])
    if not model_dirs:
        raise RuntimeError("COLMAP mapper produced no reconstruction")
    return model_dirs[0]


def run_colmap_dense(
    frames_dir: Path,
    sparse_model_dir: Path,
    job_dir: Path,
    colmap_bin: str,
    use_gpu: bool,
) -> Path:
    """
    Dense reconstruction via patch-match stereo + fusion. Returns the
    path to the fused PLY (colored point cloud). Requires CUDA-built
    COLMAP for PatchMatchStereo on Linux; on CPU we fall back to a
    sparse-only point cloud, which is rougher but works.
    """
    dense_dir = job_dir / "dense"
    dense_dir.mkdir(exist_ok=True)
    fused_ply = dense_dir / "fused.ply"

    # CPU-only fallback: skip dense, just export the sparse model as PLY
    if not use_gpu:
        print(
            "[colmap-sidecar] CPU mode — using sparse point cloud (no dense stereo)",
            flush=True,
        )
        subprocess.run(
            [
                colmap_bin,
                "model_converter",
                "--input_path",
                str(sparse_model_dir),
                "--output_path",
                str(fused_ply),
                "--output_type",
                "PLY",
            ],
            check=True,
            capture_output=True,
        )
        return fused_ply

    # GPU mode: full dense pipeline
    subprocess.run(
        [
            colmap_bin,
            "image_undistorter",
            "--image_path",
            str(frames_dir),
            "--input_path",
            str(sparse_model_dir),
            "--output_path",
            str(dense_dir),
            "--output_type",
            "COLMAP",
        ],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [colmap_bin, "patch_match_stereo", "--workspace_path", str(dense_dir)],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [
            colmap_bin,
            "stereo_fusion",
            "--workspace_path",
            str(dense_dir),
            "--output_path",
            str(fused_ply),
        ],
        check=True,
        capture_output=True,
    )
    return fused_ply


def fused_ply_to_layout(fused_ply: Path) -> dict[str, Any]:
    """
    Run Open3D RANSAC plane segmentation on the fused point cloud and
    convert detected floor + walls into the same shape that SpatialLM
    emits, so the React renderer is a drop-in.
    """
    import open3d as o3d

    pcd = o3d.io.read_point_cloud(str(fused_ply))
    if len(pcd.points) < 1000:
        # Sparse cloud — try anyway but warn
        print(
            f"[colmap-sidecar] WARN: only {len(pcd.points)} points; "
            "layout may be inaccurate",
            flush=True,
        )

    # ── Step 1: orient so "up" is +y ───────────────────────────────────
    # PCA: smallest eigenvector = direction with least variance ≈ up
    pts = np.asarray(pcd.points)
    centroid = pts.mean(axis=0)
    centered = pts - centroid
    cov = np.cov(centered.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    up = eigvecs[:, np.argmin(eigvals)]
    if up[1] < 0:
        up = -up
    # Build rotation: up → +y
    y_axis = np.array([0.0, 1.0, 0.0])
    axis = np.cross(up, y_axis)
    angle = float(np.arccos(np.clip(float(np.dot(up, y_axis)), -1.0, 1.0)))
    if np.linalg.norm(axis) < 1e-6:
        R = np.eye(3)
    else:
        axis = axis / np.linalg.norm(axis)
        K = np.array(
            [[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]]
        )
        R = np.eye(3) + np.sin(angle) * K + (1 - np.cos(angle)) * (K @ K)
    pts_oriented = centered @ R.T
    # Re-ground at y=0 (10th percentile = floor)
    y_floor = np.percentile(pts_oriented[:, 1], 10)
    pts_oriented[:, 1] -= y_floor
    pcd.points = o3d.utility.Vector3dVector(pts_oriented)

    # ── Step 2: find the floor as the largest horizontal plane near y=0 ──
    floor_plane, floor_inliers = pcd.segment_plane(
        distance_threshold=0.05, ransac_n=3, num_iterations=1000
    )
    # If the dominant plane isn't horizontal-ish, walk RANSAC a few more
    # times and pick the one with closest-to-vertical normal
    floor_normal = np.array(floor_plane[:3])
    if abs(floor_normal[1]) < 0.7:
        # Try a few more
        best_plane, best_inliers, best_align = floor_plane, floor_inliers, abs(floor_normal[1])
        rest = pcd.select_by_index(floor_inliers, invert=True)
        for _ in range(5):
            p2, inl = rest.segment_plane(0.05, 3, 1000)
            n2 = np.array(p2[:3])
            if abs(n2[1]) > best_align:
                best_plane, best_inliers, best_align = p2, inl, abs(n2[1])
                if best_align > 0.95:
                    break
        floor_plane, floor_inliers = best_plane, best_inliers

    # ── Step 3: walls = largest vertical planes from remaining points ──
    rest = pcd.select_by_index(floor_inliers, invert=True)
    walls: list[dict] = []
    ceiling_height = max(2.5, float(np.percentile(np.asarray(rest.points)[:, 1], 99)))
    for wi in range(8):  # up to 8 wall planes
        if len(rest.points) < 1000:
            break
        plane, inliers = rest.segment_plane(0.05, 3, 800)
        n = np.array(plane[:3])
        if abs(n[1]) > 0.4:
            # Not vertical enough — skip
            rest = rest.select_by_index(inliers, invert=True)
            continue
        wall_pts = np.asarray(rest.select_by_index(inliers).points)
        if len(wall_pts) < 300:
            rest = rest.select_by_index(inliers, invert=True)
            continue
        # Project wall points onto its plane's horizontal direction to
        # get a 2D line segment (start, end) at floor height
        # Horizontal axis on the wall = cross(plane normal, +y), normalized
        horiz = np.cross(n, np.array([0.0, 1.0, 0.0]))
        if np.linalg.norm(horiz) < 1e-6:
            rest = rest.select_by_index(inliers, invert=True)
            continue
        horiz = horiz / np.linalg.norm(horiz)
        t = wall_pts @ horiz
        t_min, t_max = float(np.percentile(t, 2)), float(np.percentile(t, 98))
        # Anchor point on the wall = point projected onto centroid along horiz
        c = wall_pts.mean(axis=0)
        a = c + horiz * (t_min - float(np.dot(c, horiz)))
        b = c + horiz * (t_max - float(np.dot(c, horiz)))
        walls.append(
            {
                "id": f"wall_{wi}",
                "ax": float(a[0]),
                "ay": float(-a[2]),  # our y-up → SpatialLM z-up (x same, y=-z)
                "az": 0.0,
                "bx": float(b[0]),
                "by": float(-b[2]),
                "bz": 0.0,
                "height": float(ceiling_height),
                "thickness": 0.1,
            }
        )
        rest = rest.select_by_index(inliers, invert=True)

    return {
        "walls": walls,
        # COLMAP+Open3D doesn't detect doors/windows/furniture (that's
        # where the SpatialLM LLM has the edge). Leave empty — frontend
        # renders bare walls + floor, which is honest and still useful.
        "doors": [],
        "windows": [],
        "bboxes": [],
    }
