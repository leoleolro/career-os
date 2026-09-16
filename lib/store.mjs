// Persistence for data/jobs.json (all jobs ever seen) and data/pipeline.json (the candidate's application tracker).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
export const JOBS_PATH = DATA + 'jobs.json';
export const PIPELINE_PATH = DATA + 'pipeline.json';

async function readJson(p, fallback) {
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}
async function writeJson(p, v) {
  await mkdir(DATA, { recursive: true });
  await writeFile(p, JSON.stringify(v, null, 2) + '\n');
}

export async function loadJobs() { return readJson(JOBS_PATH, { jobs: {}, runs: [] }); }
export async function saveJobs(db) { return writeJson(JOBS_PATH, db); }

/**
 * Merge freshly fetched jobs into the db. Returns { added: Job[], updated: number }.
 * Each stored job gets firstSeen / lastSeen (ISO date) and keeps user fields (status, rating, notes) untouched.
 */
export function mergeJobs(db, fresh, today) {
  const added = [];
  let updated = 0;
  for (const j of fresh) {
    const prev = db.jobs[j.id];
    if (!prev) {
      db.jobs[j.id] = { ...j, firstSeen: today, lastSeen: today, status: 'new' };
      added.push(db.jobs[j.id]);
    } else {
      const keep = { firstSeen: prev.firstSeen, status: prev.status, rating: prev.rating, notes: prev.notes, fit: prev.fit };
      db.jobs[j.id] = { ...prev, ...j, ...keep, lastSeen: today };
      updated++;
    }
  }
  return { added, updated };
}

export async function loadPipeline() {
  return readJson(PIPELINE_PATH, { applications: [] });
}
export async function savePipeline(p) { return writeJson(PIPELINE_PATH, p); }
