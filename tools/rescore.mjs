#!/usr/bin/env node
// Re-run prescore + cross-source dedupe over data/jobs.json without fetching. Use after editing lib/score.mjs or preferences.json.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadJobs, saveJobs } from '../lib/store.mjs';
import { prescore, upside } from '../lib/score.mjs';
import { dedupeKey } from '../lib/schema.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const prefs = JSON.parse(await readFile(ROOT + 'profile/preferences.json', 'utf8'));
const db = await loadJobs();
const byKey = new Map(); let merged = 0;
for (const j of Object.values(db.jobs)) {
  const { score, reasons } = prescore(j, prefs); j.prescore = score; j.prescoreReasons = reasons; const up = upside(j, prefs); j.upside = up.upside; j.priority = up.priority; j.upsideReasons = up.reasons;
  const k = dedupeKey(j);
  if (!byKey.has(k)) { byKey.set(k, j); continue; }
  const keep = byKey.get(k);
  // prefer the record with a description / the non-aggregator source; fold the other in as alsoOn
  const [primary, dup] = (keep.description && !j.description) || (['phenom', 'oracle-orc', 'greenhouse', 'lever', 'ashby'].includes(keep.source) && !['phenom', 'oracle-orc', 'greenhouse', 'lever', 'ashby'].includes(j.source)) ? [keep, j] : (j.description && !keep.description) ? [j, keep] : [keep, j];
  primary.alsoOn = [...(primary.alsoOn || []), { source: dup.source, url: dup.url }].filter((a, i, arr) => arr.findIndex((b) => b.url === a.url) === i);
  for (const f of ['rating', 'fit', 'notes', 'status']) if (dup[f] && !primary[f]) primary[f] = dup[f];
  byKey.set(k, primary); delete db.jobs[dup.id]; merged++;
}
await saveJobs(db);
console.log(JSON.stringify({ jobs: Object.keys(db.jobs).length, merged }));
