/// <reference lib="webworker" />
//
// OpenSCAD-WASM compile worker. Runs the vendored 2025.x build (see
// src/vendor/openscad-wasm/) inside a dedicated Web Worker so the multi-second
// CSG compile doesn't freeze the UI.
//
// Pattern adapted from CADAM (GPL-3.0) and openscad-web-gui (GPL-3.0).
// Vendored OpenSCAD itself is GPL-2.0+ — see src/vendor/openscad-wasm/SOURCE-OFFER.txt.

import OpenSCAD from "../vendor/openscad-wasm/openscad.js";
import wasmUrl from "../vendor/openscad-wasm/openscad.wasm?url";
import type { OpenSCAD as OpenSCADInstance } from "../vendor/openscad-wasm/openscad";

export type CompileRequest = {
  id: string;
  scad: string;
  // "stl" exports binary STL (one file). "preview" exports binary STL + OFF
  // (OFF preserves per-face color from OpenSCAD `color()` calls).
  mode: "stl" | "preview";
};

export type CompileResponse =
  | {
      id: string;
      ok: true;
      stl: Uint8Array;
      off?: Uint8Array;
      durationMs: number;
      stdErr: string[];
    }
  | { id: string; ok: false; error: string; stdErr: string[] };

async function newInstance(
  log: { stdErr: string[]; stdOut: string[] }
): Promise<OpenSCADInstance> {
  return await OpenSCAD({
    noInitialRun: true,
    print: (s: string) => log.stdOut.push(s),
    printErr: (s: string) => log.stdErr.push(s),
    locateFile: (path: string) => {
      if (path.endsWith(".wasm")) return wasmUrl;
      return path;
    },
  });
}

async function compile(req: CompileRequest): Promise<CompileResponse> {
  const log = { stdErr: [] as string[], stdOut: [] as string[] };
  const start = performance.now();

  try {
    const inst = await newInstance(log);

    inst.FS.writeFile("/input.scad", req.scad);

    const baseFlags = ["--backend=manifold", "--enable=lazy-union"];

    let exitCode: number;
    if (req.mode === "preview") {
      // Two outputs: binary STL for the geometry + OFF for per-face colors.
      // OpenSCAD --export-format is global, so we don't pass it here; the
      // file extension determines the format per output.
      exitCode = inst.callMain([
        "/input.scad",
        "-o",
        "/out.stl",
        "-o",
        "/out.off",
        ...baseFlags,
      ]);
    } else {
      exitCode = inst.callMain([
        "/input.scad",
        "-o",
        "/out.stl",
        "--export-format=binstl",
        ...baseFlags,
      ]);
    }

    if (exitCode !== 0) {
      return {
        id: req.id,
        ok: false,
        error: `OpenSCAD exited with code ${exitCode}`,
        stdErr: log.stdErr,
      };
    }

    const stl = inst.FS.readFile("/out.stl", { encoding: "binary" }) as Uint8Array;
    let off: Uint8Array | undefined;
    if (req.mode === "preview") {
      try {
        off = inst.FS.readFile("/out.off", { encoding: "binary" }) as Uint8Array;
      } catch {
        // OFF is optional (e.g. SVG fallback paths) — proceed without color.
      }
    }

    return {
      id: req.id,
      ok: true,
      stl,
      off,
      durationMs: Math.round(performance.now() - start),
      stdErr: log.stdErr,
    };
  } catch (e) {
    return {
      id: req.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      stdErr: log.stdErr,
    };
  }
}

self.onmessage = async (event: MessageEvent<CompileRequest>) => {
  const response = await compile(event.data);
  if (response.ok) {
    const transfers: ArrayBuffer[] = [response.stl.buffer as ArrayBuffer];
    if (response.off) transfers.push(response.off.buffer as ArrayBuffer);
    (self as unknown as Worker).postMessage(response, transfers);
  } else {
    (self as unknown as Worker).postMessage(response);
  }
};
