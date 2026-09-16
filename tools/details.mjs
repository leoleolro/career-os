#!/usr/bin/env node
// Fetch full descriptions for specific jobs (by id) or the top-N by prescore that lack one. Writes into data/jobs.json.
//   node tools/details.mjs --top 30            top 30 without description
//   node tools/details.mjs seek:94123058 linkedin:4456166260
import { sources } from '../sources/index.mjs';
import { loadJobs, saveJobs } from '../lib/store.mjs';
import { stripHtml, closingDate } from '../lib/schema.mjs';
const args = process.argv.slice(2);
const top = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 0;
const ids = args.filter((a) => a.includes(':'));
const db = await loadJobs();
let targets = ids.map((id) => db.jobs[id]).filter(Boolean);
if (top) targets = Object.values(db.jobs).filter((j) => !j.description).sort((a, b) => b.prescore - a.prescore).slice(0, top);
let ok = 0, fail = 0;
for (const j of targets) {
  const src = sources.find((s) => s.name === j.source);
  if (!src?.details) { fail++; continue; }
  try { const d = await src.details(j); if (d?.description) { Object.assign(j, d, { description: stripHtml(d.description) }); j.closesAt = closingDate(j.description) || j.closesAt; ok++; } else fail++; }
  catch (e) { fail++; process.stderr.write(`details ${j.id}: ${e.message.slice(0, 100)}\n`); }
  process.stderr.write(`  ${j.id} ${j.description ? 'ok ' + j.description.length : 'no description'}\n`);
}
await saveJobs(db);
console.log(JSON.stringify({ requested: targets.length, ok, fail }));
