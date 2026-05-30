// Main-thread interface to the OpenSCAD-WASM worker.
//
// Spawns a single Worker (lazily, on first compile call) and serializes
// requests to it. The worker is heavy to instantiate (~9.6MB WASM download +
// init), so we keep one alive for the lifetime of the page.

import OpenSCADWorker from "../worker/openscad.worker.ts?worker";
import type {
  CompileRequest,
  CompileResponse,
} from "../worker/openscad.worker";

let _worker: Worker | null = null;
let _pending = new Map<
  string,
  { resolve: (r: CompileResponse) => void; reject: (e: Error) => void }
>();
let _seq = 0;

function getWorker(): Worker {
  if (_worker) return _worker;
  _worker = new OpenSCADWorker();
  _worker.onmessage = (e: MessageEvent<CompileResponse>) => {
    const id = e.data.id;
    const p = _pending.get(id);
    if (!p) return;
    _pending.delete(id);
    p.resolve(e.data);
  };
  _worker.onerror = (e) => {
    const err = new Error(`OpenSCAD worker error: ${e.message}`);
    for (const p of _pending.values()) p.reject(err);
    _pending.clear();
  };
  return _worker;
}

export type CompileMode = "stl" | "preview";

export interface CompileResult {
  stl: Uint8Array;
  off?: Uint8Array;
  durationMs: number;
  stdErr: string[];
}

export async function compileSCAD(
  scad: string,
  mode: CompileMode = "preview"
): Promise<CompileResult> {
  const w = getWorker();
  const id = `req-${++_seq}-${Date.now()}`;
  const req: CompileRequest = { id, scad, mode };
  const resPromise = new Promise<CompileResponse>((resolve, reject) => {
    _pending.set(id, { resolve, reject });
  });
  w.postMessage(req);
  const res = await resPromise;
  if (!res.ok) {
    const errMsg = `${res.error}\n${res.stdErr.slice(-10).join("\n")}`.trim();
    throw new Error(errMsg);
  }
  return {
    stl: res.stl,
    off: res.off,
    durationMs: res.durationMs,
    stdErr: res.stdErr,
  };
}
