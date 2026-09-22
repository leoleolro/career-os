#!/usr/bin/env node
// Market signals from the candidate's own hunt data: how the roles he cares about are trending month by month,
// so career-decision kill criteria ("if AI postings halve, revisit") can be checked instead of remembered.
//   node tools/signals.mjs            → table + JSON summary
//   node tools/signals.mjs --json     → JSON only
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { loadJobs } from '../lib/store.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const prefs = JSON.parse(await readFile(ROOT + 'profile/preferences.json', 'utf8'));
const db = await loadJobs();
const jobs = Object.values(db.jobs).filter((j) => (j.prescore ?? 1) > 0);
const HOME = String(prefs.locations?.primary?.[0] || 'Perth').split(/[ ,]/)[0];
const AU = new RegExp(prefs.locations?.country_regex || 'perth|sydney|melbourne|brisbane|canberra|adelaide|australia', 'i');
const LANES = {
  'AI / FDE / applied AI': /\b(ai|ml|llm|genai|generative|agentic|machine learning)\b.*\b(engineer|scientist|developer|architect)\b|forward[- ]deployed|applied ai|\bai (consultant|solutions?)\b/i,
  'Consulting (strategy / M&A / tech)': /\bconsultant\b|consulting|\bm&a\b|mergers|transaction|strategy|associate\b/i,
  'Oracle / EPM / ERP': /\boracle\b|\bepm\b|epbcs|edmcs|hyperion|netsuite|\berp\b/i,
  'Data science / analytics': /data scien|analytics|\bdata analyst\b/i,
};
const month = (iso) => String(iso || '').slice(0, 7);
const months = [...new Set(jobs.map((j) => month(j.firstSeen)).filter(Boolean))].sort();

const rows = [];
for (const [lane, re] of Object.entries(LANES)) {
  const inLane = jobs.filter((j) => re.test(j.title));
  const au = inLane.filter((j) => AU.test(j.location));
  const home = au.filter((j) => new RegExp(HOME, 'i').test(j.location));
  const byMonth = Object.fromEntries(months.map((m) => [m, au.filter((j) => month(j.firstSeen) === m).length]));
  const strong = inLane.filter((j) => ['Strong', 'Good'].includes(j.rating)).length;
  rows.push({ lane, total: inLane.length, au: au.length, [HOME.toLowerCase()]: home.length, ratedStrongOrGood: strong, byMonth });
}
const out = {
  generated: new Date().toISOString().slice(0, 10),
  windowMonths: months,
  jobsTracked: jobs.length,
  note: 'Counts are postings seen by this agent in the configured searches, not the whole market. Compare months with equal coverage: a month with fewer hunt runs looks smaller.',
  runsByMonth: Object.fromEntries(months.map((m) => [m, (db.runs || []).filter((r) => month(r.at) === m).length])),
  lanes: rows,
};
await writeFile(ROOT + 'data/signals.json', JSON.stringify(out, null, 2) + '\n');
if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
const pad = (s, n) => String(s).padEnd(n);
console.log(`Market signals from this agent's own data (${out.jobsTracked} postings, months: ${months.join(', ')})`);
console.log(`Hunt runs per month: ${Object.entries(out.runsByMonth).map(([m, n]) => `${m} ${n}`).join(' · ')}  (compare like with like)\n`);
console.log(pad('Lane', 36) + pad('all', 7) + pad('AU', 7) + pad(HOME, 8) + pad('Strong/Good', 13) + 'by month');
for (const r of rows) console.log(pad(r.lane, 36) + pad(r.total, 7) + pad(r.au, 7) + pad(r[HOME.toLowerCase()], 8) + pad(r.ratedStrongOrGood, 13) + months.map((m) => `${m.slice(5)}:${r.byMonth[m]}`).join(' '));
console.log('\nKill-criteria check: compare each lane\'s AU count per month against the earliest full month. A sustained halving in the AI lane is the signal to revisit reports/career-decision-*.md.');
