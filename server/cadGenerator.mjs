// Spawn the Python CAD service to build manufacturable CAD bundles from
// a furniture spec. Output goes into public/cad/<id>/ and is zipped to
// public/cad/<id>.zip for one-click download.
//
// Why a subprocess: build123d's CAD kernel (OpenCascade) is C++ and can't
// run in Node. Python is the only commercial-friendly path. Subprocess
// rather than HTTP sidecar because (a) the conversion is fast (~0.2s),
// (b) it's local-only, (c) no extra process to manage.

import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SERVICE_DIR = resolve("server/python-cad-service");
const PYTHON_BIN = resolve("server/python-cad-service/.venv/bin/python");
const GENERATE_PY = resolve("server/python-cad-service/generate.py");
const PUBLIC_CAD_DIR = resolve("public/cad");

/**
 * Build a manufacturable CAD bundle for a single furniture spec.
 *
 * @param {object} spec - A FurnitureSpec (any category).
 * @param {object} [opts]
 * @param {string} [opts.id] - Stable ID for the output dir/zip. Defaults to a random hex.
 * @returns {Promise<{ id: string, zipUrl: string, summary: object, elapsedMs: number }>}
 */
export async function generateCadBundle(spec, opts = {}) {
  if (!spec || typeof spec !== "object" || !spec.category) {
    throw new Error("generateCadBundle: spec must be an object with .category");
  }
  if (!existsSync(PYTHON_BIN)) {
    throw new Error(
      `CAD venv missing at ${PYTHON_BIN}. Run: python3.11 -m venv server/python-cad-service/.venv && server/python-cad-service/.venv/bin/pip install build123d ezdxf trimesh`
    );
  }

  const id = opts.id || cryptoRandomId();
  const outDir = resolve(PUBLIC_CAD_DIR, id);
  const zipPath = resolve(PUBLIC_CAD_DIR, `${id}.zip`);
  await mkdir(PUBLIC_CAD_DIR, { recursive: true });
  await rm(outDir, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(outDir, { recursive: true });

  const specPath = resolve(outDir, "spec.input.json");
  await writeFile(specPath, JSON.stringify(spec, null, 2));

  const t0 = performance.now();

  // 1. Run the Python builder
  const summary = await runPython(specPath, outDir);

  // 2. Zip the output dir
  await zipDirectory(outDir, zipPath);

  const elapsedMs = Math.round(performance.now() - t0);
  const zipStat = await stat(zipPath);

  return {
    id,
    zipUrl: `/cad/${id}.zip`,
    summary: {
      ...summary,
      zip_size_bytes: zipStat.size,
    },
    elapsedMs,
  };
}

function runPython(specPath, outDir) {
  return new Promise((accept, reject) => {
    const child = spawn(
      PYTHON_BIN,
      [GENERATE_PY, "--spec-file", specPath, "--out-dir", outDir],
      { cwd: SERVICE_DIR, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(
          new Error(
            `CAD generator exited ${code}\nstderr:\n${stderr.slice(-1500)}\nstdout:\n${stdout.slice(-500)}`
          )
        );
      }
      try {
        accept(JSON.parse(stdout));
      } catch (e) {
        reject(
          new Error(
            `CAD generator produced invalid JSON: ${e.message}\nstdout:\n${stdout.slice(0, 1500)}`
          )
        );
      }
    });
  });
}

function zipDirectory(dir, zipPath) {
  return new Promise((accept, reject) => {
    // -r recursive, -q quiet, -j NO — we want the dir name flattened out.
    // We pass dir as the cwd and zip its contents (. = everything inside).
    const child = spawn("zip", ["-r", "-q", zipPath, "."], { cwd: dir });
    let stderr = "";
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`zip exited ${code}: ${stderr}`));
      }
      accept();
    });
  });
}

function cryptoRandomId() {
  // 12 hex chars — collision-safe enough for per-session bundles.
  return [...crypto.getRandomValues(new Uint8Array(6))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
