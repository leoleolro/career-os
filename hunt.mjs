#!/usr/bin/env node
// Career OS job hunt: runs every source × every search query from profile/preferences.json,
// normalizes + dedups, pre-scores, persists to data/jobs.json and writes reports/hunt-YYYY-MM-DD.md.
//
//   node hunt.mjs                    full run, all sources
//   node hunt.mjs --source seek      one source
//   node hunt.mjs --query "Oracle EPM" --location "Perth WA"     (any city string your sources understand)
//   node hunt.mjs --new-only         report only jobs never seen before
//   node hunt.mjs --details 15       also fetch full descriptions for the top N new jobs
//   node hunt.mjs --min-score 40     drop noise below this prescore from the report
//   node hunt.mjs --dry              fetch + score + print JSON only; touches no files (safe for adapter testing)
//   node hunt.mjs --top 60           cap each report section (default 60); --source-timeout 480000 per-source wall clock (ms)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sources } from './sources/index.mjs';
import { loadJobs, saveJobs, mergeJobs } from './lib/store.mjs';
import { prescore, upside } from './lib/score.mjs';
import { dedupeKey } from './lib/schema.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const prefs = JSON.parse(await readFile(ROOT + 'profile/preferences.json', 'utf8').catch(() => readFile(ROOT + 'profile/preferences.example.json', 'utf8')));
const today = new Date().toISOString().slice(0, 10);
const onlySource = opt('--source');
const minScore = Number(opt('--min-score', 35));
const detailsN = Number(opt('--details', 0));
const queries = opt('--query') ? [opt('--query')] : prefs.search_queries;
const locations = opt('--location') ? [opt('--location')] : [...(prefs.locations.primary || []), ...(prefs.locations.also_consider || [])];

const active = sources.filter((s) => !onlySource || s.name === onlySource);
if (!active.length) { console.error('No such source:', onlySource, '— available:', sources.map((s) => s.name).join(', ')); process.exit(1); }

console.error(`[hunt] ${today} sources=${active.map((s) => s.name).join(',')} queries=${queries.length} locations=${locations.join(' | ')}`);

const fresh = new Map(); // id -> job
const errors = [];
const stats = {};
const SOURCE_TIMEOUT_MS = Number(opt('--source-timeout', 8 * 60 * 1000));
const withTimeout = (p, ms, label) => { let t; const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms); t.unref?.(); }); return Promise.race([p, timer]).finally(() => clearTimeout(t)); };

// Sources run concurrently (lib/http.mjs paces per host, so each site still sees polite spacing); combos within a source run sequentially.
async function runSource(src) {
  stats[src.name] = { fetched: 0, errors: 0, ms: 0 };
  const t0 = Date.now();
  const combos = src.queryless ? [{ query: '', location: locations[0] }] : queries.flatMap((q) => locations.map((l) => ({ query: q, location: l })));
  for (const c of combos) {
    try {
      const jobs = await src.search({ ...c, prefs });
      stats[src.name].fetched += jobs.length;
      for (const j of jobs) if (!fresh.has(j.id)) fresh.set(j.id, j);
      process.stderr.write(`  ${src.name} "${c.query}" @ ${c.location}: ${jobs.length}\n`);
    } catch (e) {
      stats[src.name].errors++;
      errors.push(`${src.name} "${c.query}" @ ${c.location}: ${e.message}`);
      process.stderr.write(`  ${src.name} "${c.query}" @ ${c.location}: ERROR ${e.message.slice(0, 120)}\n`);
      if (stats[src.name].errors >= 5) { errors.push(`${src.name}: aborted after 5 errors`); break; }
    }
  }
  stats[src.name].ms = Date.now() - t0;
}
await Promise.all(active.map((src) => withTimeout(runSource(src), SOURCE_TIMEOUT_MS, src.name).catch((e) => { errors.push(e.message); stats[src.name] = { ...(stats[src.name] || { fetched: 0 }), errors: (stats[src.name]?.errors || 0) + 1, timedOut: true }; })));

// cross-source dedupe: keep the first seen per (company|title), but remember the others' URLs
const byKey = new Map();
for (const j of fresh.values()) {
  const k = dedupeKey(j);
  if (!byKey.has(k)) byKey.set(k, j);
  else { const keep = byKey.get(k); keep.alsoOn = [...(keep.alsoOn || []), { source: j.source, url: j.url }]; }
}
const unique = [...byKey.values()];
for (const j of unique) { const { score, reasons } = prescore(j, prefs); j.prescore = score; j.prescoreReasons = reasons; const up = upside(j, prefs); j.upside = up.upside; j.priority = up.priority; j.upsideReasons = up.reasons; }

if (flag('--dry')) {
  const top = unique.sort((a, b) => b.prescore - a.prescore);
  console.log(JSON.stringify({ dry: true, fetched: fresh.size, unique: unique.length, errors, stats, jobs: top.slice(0, Number(opt('--limit', 25))) }, null, 2));
  process.exit(errors.length && !unique.length ? 1 : 0);
}
const db = await loadJobs();
const { added, updated } = mergeJobs(db, unique, today);
db.runs.push({ at: new Date().toISOString(), sources: active.map((s) => s.name), fetched: fresh.size, unique: unique.length, added: added.length, updated, errors });
await saveJobs(db);

// optional: full descriptions for top new jobs
const ranked = (flag('--new-only') ? added : unique.map((j) => db.jobs[j.id])).filter((j) => j.prescore >= minScore).sort((a, b) => b.prescore - a.prescore);
if (detailsN > 0) {
  for (const j of ranked.slice(0, detailsN)) {
    const src = sources.find((s) => s.name === j.source);
    if (!src?.details || j.description) continue;
    try { Object.assign(db.jobs[j.id], await src.details(j)); j.description = db.jobs[j.id].description; } catch (e) { errors.push(`details ${j.id}: ${e.message}`); }
  }
  await saveJobs(db);
}

// report
const line = (j) => `- ${j.priority ? `\`${j.priority}\` ` : ''}**${j.title}** — ${j.company} · ${j.location || '?'}${j.postedAt ? ` · posted ${j.postedAt}` : ''}${j.closesAt ? ` · **closes ${j.closesAt}**` : ''}${j.salary ? ` · ${j.salary}` : ''}\n  score ${j.prescore} (${(j.prescoreReasons || []).join(', ')}) · [${j.source}](${j.url})${(j.alsoOn || []).map((a) => ` · [${a.source}](${a.url})`).join('')}${j.firstSeen === today ? ' · **NEW**' : ` · seen ${j.firstSeen}`}\n  ${(j.summary || '').slice(0, 220)}`;
const newRanked = added.filter((j) => j.prescore >= minScore).sort((a, b) => b.prescore - a.prescore);
const TOP = Number(opt('--top', 60));
const auAi = (j) => new RegExp((prefs.locations?.country_regex || 'perth|sydney|melbourne|brisbane|canberra|adelaide|australia') + '|remote', 'i').test(j.location)
  && /\b(ai|ml|llm|agent|agentic|generative|gen-?ai|forward deployed|machine learning|data scien|oracle|epm|erp|solutions? engineer)\b/i.test(j.title)
  || (/\bconsult/i.test(j.title) && /\b(technology|tech|management|strategy|junior|graduate|associate|business|data|ai|digital|cloud|oracle|erp|epm|sap|analytics|transformation|advisory)\b/i.test(j.title) && !/sales|recruit|customer|property|settlement|travel|beauty|retail|insurance|leasing|real estate|mortgage|fitness/i.test(j.title));
const newAuAi = newRanked.filter(auAi);
const md = `# Hunt report — ${today}

Sources: ${active.map((s) => `${s.name} (${stats[s.name].fetched} fetched${stats[s.name].errors ? `, ${stats[s.name].errors} errors` : ''}${stats[s.name].timedOut ? ', TIMED OUT' : ''}, ${Math.round((stats[s.name].ms || 0) / 1000)}s)`).join(', ')}
Fetched ${fresh.size} postings → ${unique.length} unique → **${added.length} never seen before** (${updated} already tracked). Report threshold: prescore ≥ ${minScore}.

## New AI / Oracle / consulting roles in your country (${newAuAi.length})
${newAuAi.length ? newAuAi.slice(0, TOP).map(line).join('\n') : '_none_'}${newAuAi.length > TOP ? `\n_…${newAuAi.length - TOP} more in data/jobs.json_` : ''}

## Other new postings above threshold (${newRanked.length - newAuAi.length}, showing top ${Math.min(TOP, newRanked.length - newAuAi.length)})
${newRanked.filter((j) => !auAi(j)).slice(0, TOP).map(line).join('\n') || '_none_'}

${flag('--new-only') ? '' : `## Everything above threshold (${ranked.length}, showing top ${Math.min(TOP, ranked.length)})\n${ranked.slice(0, TOP).map(line).join('\n')}\n`}
${errors.length ? `## Errors\n${errors.map((e) => `- ${e}`).join('\n')}\n` : ''}
_Next: ask Claude to \`/hunt review\` — it reads this report, rates real fit against profile/master-resume.md, and shortlists._
`;
await mkdir(ROOT + 'reports', { recursive: true });
const reportPath = `${ROOT}reports/hunt-${today}.md`;
await writeFile(reportPath, md);
console.error(`[hunt] done: ${fresh.size} fetched, ${unique.length} unique, ${added.length} new, ${errors.length} errors → ${reportPath}`);
console.log(JSON.stringify({ today, fetched: fresh.size, unique: unique.length, added: added.length, updated, report: reportPath, errors: errors.length, topNew: newRanked.slice(0, 10).map((j) => ({ title: j.title, company: j.company, score: j.prescore, url: j.url })) }, null, 2));
