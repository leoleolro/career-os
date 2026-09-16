#!/usr/bin/env node
// Re-verify that shortlisted / rated jobs are still open. A network failure or ambiguous answer is 'unknown', never 'gone' —
// only an adapter's explicit notFound/closed signal or an HTTP 404/410 closes a job (lesson from the 2026-09-16 cloud outage). Fetches each posting (via its adapter's details() where available,
// else the URL) and flags: gone (404/410), closed-text ("no longer accepting", "position has been filled" on a NON-decoy source,
// "applications closed"), or closesAt in the past. Writes `openCheck: {at, status, note}` on the job and prints a table.
//   node tools/recheck.mjs            pipeline + Strong/Good jobs
//   node tools/recheck.mjs --all      every rated job
import { sources } from '../sources/index.mjs';
import { loadJobs, saveJobs, loadPipeline } from '../lib/store.mjs';
import { fetchText } from '../lib/http.mjs';
const DECOY = new Set(['phenom', 'oracle-orc', 'seek']); // phenom/orc serve "filled" pages to plain fetches; seek's job page is Cloudflare-gated — rely on details() (GraphQL) instead
const BROWSER_ONLY = new Set(['mckinsey']);
const all = process.argv.includes('--all');
const today = new Date().toISOString().slice(0, 10);
const db = await loadJobs(); const pipe = await loadPipeline();
const pipeIds = new Set(pipe.applications.map((a) => a.jobId).filter(Boolean));
const targets = Object.values(db.jobs).filter((j) => pipeIds.has(j.id) || (all ? j.rating : ['Strong', 'Good'].includes(j.rating)));
const CLOSED = /no longer (accepting|available|open)|applications? (are )?(now )?closed|this (job|position|role) (has been|is) (filled|closed|removed)|job (has )?expired|vacancy (has )?closed|is no longer advertised/i;
const rows = [];
for (const j of targets) {
  let status = 'open', note = '';
  try {
    if (j.closesAt && j.closesAt < today) { status = 'closed-by-date'; note = `closed ${j.closesAt}`; }
    else if (BROWSER_ONLY.has(j.source)) { status = 'needs-browser'; note = 'verify in Browser pane'; }
    else {
      const src = sources.find((s) => s.name === j.source);
      if (src?.details && DECOY.has(j.source)) {
        const d = await src.details(j);
        if (d?.notFound) { status = 'gone'; note = 'adapter: not found'; }
        else if (d?.raw?.status === 'closed') { status = 'closed-text'; note = 'adapter: closed'; }
        else if (!d?.description) { status = 'unknown'; note = 'no detail record (network?)'; } // never 'gone' on an ambiguous answer
      } else {
        const r = await fetchText(j.url, { minGapMs: 1500, retries: 1, cacheTtlMs: 0 });
        if (r.status === 404 || r.status === 410) { status = 'gone'; note = `HTTP ${r.status}`; }
        else if (r.status >= 400) { status = 'unknown'; note = `HTTP ${r.status}`; }
        else if (CLOSED.test(r.text.replace(/<[^>]+>/g, ' '))) { status = 'closed-text'; note = (r.text.replace(/<[^>]+>/g, ' ').match(CLOSED) || [''])[0]; }
      }
    }
  } catch (e) { status = 'unknown'; note = e.message.slice(0, 60); }
  j.openCheck = { at: today, status, note };
  rows.push([status, j.id, j.title.slice(0, 44), j.company.slice(0, 20), note.slice(0, 40)]);
}
await saveJobs(db);
for (const r of rows.sort()) console.log(r.map((c, i) => String(c).padEnd([14, 30, 46, 22, 40][i])).join(' '));
console.log(`\n${rows.length} checked · ${rows.filter((r) => r[0] === 'open').length} open · ${rows.filter((r) => ['gone', 'closed-text', 'closed-by-date'].includes(r[0])).length} closed/gone · ${rows.filter((r) => ['unknown', 'needs-browser'].includes(r[0])).length} unverified`);
