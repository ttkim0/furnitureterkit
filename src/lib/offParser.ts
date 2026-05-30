// Minimal OFF parser tuned for OpenSCAD's manifold-backend output.
//
// OpenSCAD with --backend=manifold writes per-face colors at the end of each
// face line: "n v1 v2 ... vn [r g b [a]]" (RGBA in [0,1]). We expand each
// face's color out to its triangle vertices so Three.js can render with
// vertex colors (one mesh, many colors).
//
// OpenSCAD always emits triangulated faces for the manifold backend (each
// face line starts with "3"), but we triangulate fan-style as a defensive
// fallback in case a non-triangle slips through.

import { BufferAttribute, BufferGeometry } from "three";

interface Vertex {
  x: number;
  y: number;
  z: number;
}

export function parseOFFToBufferGeometry(off: string | Uint8Array): BufferGeometry {
  const text =
    typeof off === "string" ? off : new TextDecoder("utf-8").decode(off);
  const lines = text.split(/\r?\n/);

  let i = 0;
  const skipBlankAndComments = () => {
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === "" || t.startsWith("#")) {
        i++;
        continue;
      }
      break;
    }
  };

  skipBlankAndComments();
  // OFF header — may be "OFF", "COFF" (with color), or include counts on the same line
  let header = lines[i].trim();
  let countsTokens: string[] | null = null;
  if (/^[A-Z]+$/.test(header)) {
    i++;
    skipBlankAndComments();
    countsTokens = lines[i].trim().split(/\s+/);
    i++;
  } else {
    // Header line might be "OFF nVert nFace nEdge" combined
    const parts = header.split(/\s+/);
    if (parts.length >= 4 && /^[A-Z]+$/.test(parts[0])) {
      countsTokens = parts.slice(1);
      header = parts[0];
      i++;
    } else {
      throw new Error(`Unexpected OFF header: ${header}`);
    }
  }

  const numVerts = parseInt(countsTokens[0], 10);
  const numFaces = parseInt(countsTokens[1], 10);
  if (!isFinite(numVerts) || !isFinite(numFaces)) {
    throw new Error(`Invalid OFF counts: ${countsTokens.join(" ")}`);
  }

  const verts: Vertex[] = [];
  for (let v = 0; v < numVerts; v++) {
    skipBlankAndComments();
    const tokens = lines[i++].trim().split(/\s+/);
    verts.push({
      x: parseFloat(tokens[0]),
      y: parseFloat(tokens[1]),
      z: parseFloat(tokens[2]),
    });
  }

  // Output buffers — we duplicate vertices per-face so each triangle can have
  // its own color (vertex colors only — Three.js doesn't do per-face natively).
  const positions: number[] = [];
  const colors: number[] = [];
  let sawFaceColor = false;

  for (let f = 0; f < numFaces; f++) {
    skipBlankAndComments();
    const tokens = lines[i++].trim().split(/\s+/);
    const n = parseInt(tokens[0], 10);
    const idx: number[] = [];
    for (let k = 0; k < n; k++) idx.push(parseInt(tokens[1 + k], 10));

    // Color at end. Standard OFF colors are RGB(A) in [0,1], but OpenSCAD's
    // manifold backend writes them as bytes [0,255]. Auto-detect by checking
    // if any value > 1.
    const colorTokens = tokens.slice(1 + n);
    let r = 0.78,
      g = 0.71,
      b = 0.6;
    if (colorTokens.length >= 3) {
      sawFaceColor = true;
      r = parseFloat(colorTokens[0]);
      g = parseFloat(colorTokens[1]);
      b = parseFloat(colorTokens[2]);
      if (r > 1 || g > 1 || b > 1) {
        r /= 255;
        g /= 255;
        b /= 255;
      }
    }

    // Fan-triangulate if needed (OpenSCAD's manifold output is already tri,
    // but be defensive).
    for (let t = 1; t < n - 1; t++) {
      const a = verts[idx[0]];
      const c = verts[idx[t]];
      const d = verts[idx[t + 1]];
      positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      colors.push(r, g, b, r, g, b, r, g, b);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3)
  );
  if (sawFaceColor) {
    geometry.setAttribute(
      "color",
      new BufferAttribute(new Float32Array(colors), 3)
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}
