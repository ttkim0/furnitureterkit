// In-memory job tracker for room-scan requests. Each job represents one
// uploaded video being processed by the Python sidecar. The frontend
// polls GET /api/scan-room/:jobId for status; this module owns the
// state machine.
//
// State transitions:
//   queued    → uploading → processing → done
//                                      ↘ error
//
// We keep job entries for ~1 hour after completion so the frontend can
// refresh and still see the result. Restart-safe? No — if the Node
// process restarts mid-scan the job is lost. For an MVP that's fine; a
// production version would persist to disk or Redis.

const JOBS = new Map();
const RETENTION_MS = 60 * 60 * 1000; // 1 h
const MAX_JOBS = 100; // hard cap

function gc() {
  const now = Date.now();
  if (JOBS.size <= MAX_JOBS && now - lastGc < 5 * 60 * 1000) return;
  lastGc = now;
  for (const [id, job] of JOBS) {
    if (job.finishedAt && now - job.finishedAt > RETENTION_MS) {
      JOBS.delete(id);
    }
  }
  // Hard-cap: drop the oldest if still over
  if (JOBS.size > MAX_JOBS) {
    const sorted = [...JOBS.entries()].sort(
      (a, b) => a[1].createdAt - b[1].createdAt
    );
    for (let i = 0; i < JOBS.size - MAX_JOBS; i++) {
      JOBS.delete(sorted[i][0]);
    }
  }
}
let lastGc = Date.now();

export function createJob(jobId, { filename, sizeBytes }) {
  const job = {
    id: jobId,
    status: "queued",
    filename,
    sizeBytes,
    progress: 0,
    message: "uploaded — queued for processing",
    createdAt: Date.now(),
    finishedAt: null,
    result: null,
    error: null,
  };
  JOBS.set(jobId, job);
  gc();
  return job;
}

export function getJob(jobId) {
  return JOBS.get(jobId) ?? null;
}

export function updateJob(jobId, patch) {
  const job = JOBS.get(jobId);
  if (!job) return null;
  Object.assign(job, patch);
  if (patch.status === "done" || patch.status === "error") {
    job.finishedAt = Date.now();
  }
  return job;
}

export function listJobs() {
  return [...JOBS.values()];
}
