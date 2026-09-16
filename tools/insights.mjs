#!/usr/bin/env node
// Market insights from data/jobs.json: what AU employers ask for in AI / consulting / Oracle roles, vs the candidate's resume.
//   node tools/insights.mjs            → reports/market-insights-<today>.md (also prints JSON summary)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadJobs } from '../lib/store.mjs';
import { computeInsights } from '../lib/insights.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const db = await loadJobs();
const prefs = JSON.parse(await readFile(ROOT + 'profile/preferences.json', 'utf8'));
const master = (await readFile(ROOT + 'profile/master-resume.md', 'utf8')).toLowerCase();
const today = new Date().toISOString().slice(0, 10);
const jobs = Object.values(db.jobs);

const I = computeInsights(jobs, prefs, master);
const { HOME, au, aiAu, aiPerth, n, np, familiesAu, familiesPerth, aiByCity, yrsAi, yrsPerthAi, techAi, techPerthAi, certsAi, workType, salaries, med, topCosPerthAi, oracleAu, oracleCos, grads, gaps, rated, HAS, pct } = I;
const md = `# Market insights — ${today}

Basis: ${jobs.length} postings in data/jobs.json (${au.length} located in Australia; ${aiAu.length} are AI/FDE/solutions/data-science roles, ${aiPerth.length} of those in ${HOME}). Tech frequencies use the ${n} AU AI roles with full descriptions (${np} in ${HOME}). Counts are of postings, not vacancies.

## 1. What the Australian market is hiring (by title family)
| Family | Country postings | ${HOME} postings |
|---|---|---|
${familiesAu.map(([k, v]) => `| ${k} | ${v} | ${familiesPerth.find(([kk]) => kk === k)?.[1] || 0} |`).join('\n')}

AI roles by city: ${aiByCity.map(([k, v]) => `${k} ${v}`).join(' · ')}

## 2. Experience asked in AU AI roles (first explicit "N years" in the ad)
| Years asked | Country AI roles | ${HOME} AI roles |
|---|---|---|
${['0–2', '3–4', '5–7', '8+'].map((b) => `| ${b} | ${yrsAi.find(([k]) => k === b)?.[1] || 0} | ${yrsPerthAi.find(([k]) => k === b)?.[1] || 0} |`).join('\n')}
Unstated: ${n - yrsAi.reduce((a, [, v]) => a + v, 0)} of ${n}. the candidate is at ~2.2 years → the 0–4 band plus every "unstated" ad is their addressable market.

## 3. Technology & skills mentioned in AU AI roles (share of ads)
| Skill | Country AI (${n}) | ${HOME} AI (${np}) | On the candidate's resume? |
|---|---|---|---|
${techAi.map(([k, v]) => `| ${k} | ${v} (${pct(v, n)}%) | ${techPerthAi.find(([kk]) => kk === k)?.[1] || 0} | ${HAS[k] ? (HAS[k].test(master) ? '✅' : '❌ gap') : '—'} |`).join('\n')}

Certifications named in ads: ${certsAi.map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}

## 4. Biggest resume gaps vs demand (frequently asked, not evidenced in master-resume.md)
${gaps.map(([k, v], i) => `${i + 1}. **${k}** — in ${v} of ${n} AU AI ads (${pct(v, n)}%)`).join('\n') || '_none_'}

## 5. Contract vs permanent (AU AI roles, where stated)
${workType.map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## 6. Salary signals (AU AI roles that state a figure; n=${salaries.length})
${salaries.length ? `min $${salaries[0].toLocaleString()} · median $${med(salaries).toLocaleString()} · max $${salaries[salaries.length - 1].toLocaleString()}` : '_too few stated_'}

## 7. Who is hiring AI in ${HOME} (postings)
${topCosPerthAi.map(([k, v]) => `- ${k} (${v})`).join('\n')}

## 8. Oracle / EPM market in Australia (${oracleAu.length} postings mention Oracle/EPM/NetSuite)
${oracleCos.map(([k, v]) => `- ${k} (${v})`).join('\n')}

## 9. 2027 graduate programs seen (${grads.length})
${grads.slice(0, 25).map((j) => `- ${j.title} — ${j.company} · ${j.location.slice(0, 40)} · [${j.source}](${j.url})`).join('\n')}

## 10. Ratings so far
${rated.map(([k, v]) => `${k} ${v}`).join(' · ') || '_none yet_'}

_Regenerate: \`node tools/insights.mjs\`. Feed into \`/career-path\`._
`;
await writeFile(`${ROOT}reports/market-insights-${today}.md`, md);
console.log(JSON.stringify({ au: au.length, aiAu: aiAu.length, aiPerth: aiPerth.length, gaps: gaps.map(([k, v]) => `${k}:${v}`), yrsAi, topTech: techAi.slice(0, 8), report: `reports/market-insights-${today}.md` }, null, 1));
