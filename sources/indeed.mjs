// Indeed (au.indeed.com) — NOT plain-fetchable. Ships as a self-checking stub: one live probe per process, then [] + one stderr line.
// Tested 2026-09-12 with lib/http.mjs (Chrome-like UA, en-AU headers):
//   GET https://au.indeed.com/jobs?q=..&l=Perth+WA&fromage=14&sort=date → 403, Cloudflare managed challenge
//        (server: cloudflare, cf-mitigated: challenge, <title>Security Check - Indeed.com</title>); same for /m/jobs.
//   GET https://au.indeed.com/viewjob?jk=..                             → 401 "Authenticating..." JS gate (bot-detection login redirect)
//   GET https://au.indeed.com/rss?q=..&l=..  (and www.indeed.com/rss)    → 404 "Not Found | Indeed" — RSS is retired, not blocked
//   GET https://api.indeed.com/ads/apisearch  (legacy Publisher API)     → host no longer resolves
// The challenge needs a real browser to run JS, so nothing in lib/http.mjs can pass it. Do not add retries or UA games here.
//
// What works instead: the Browser pane (see skills/hunt) passes the challenge. Verified live 2026-09-12 in the pane:
//   the search page embeds, inside <script id="mosaic-data">,
//     window.mosaic.providerData["mosaic-provider-jobcards"]={"metaData":{"mosaicProviderJobCardsModel":{"results":[ ... ]}}};
//   and each result carries { jobkey, title, displayTitle, company, formattedLocation, jobLocationCity, jobLocationState,
//     pubDate (ms epoch), createDate, snippet (HTML), jobTypes[], salarySnippet{text?,currency}, extractedSalary{min,max,type}?,
//     taxonomyAttributes[{label:"job-types"|"remote"|"benefits"|..., attributes:[{label}]}], expired, sponsored, viewJobLink }.
//   The key is ABSENT when the query has zero results (the page then says "did not match any jobs").
// parseMosaic(html) turns that HTML into Job records. Two ways it gets used:
//   1. search() runs it on the live response if Indeed ever answers 200 (self-healing, no code change needed).
//   2. Save the search page's HTML from the Browser pane as inbox/indeed*.html (or inbox/indeed/*.html); search() ingests
//      every such file once per process and returns the jobs on its first call, so they flow through hunt like any source.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText } from '../lib/http.mjs';
import { normalizeJob } from '../lib/schema.mjs';

export const name = 'indeed';
export const description = 'Indeed Australia (Cloudflare-blocked for plain fetch — returns [] + stderr hint; ingests inbox/indeed*.html saved from the Browser pane)';

const INBOX = fileURLToPath(new URL('../inbox/', import.meta.url));
const BLOCKED_MSG = '[indeed] blocked by bot protection — use the Browser pane (see skills/hunt)';
let blocked = false; // set after the first failed probe; later combos short-circuit without hitting Indeed again
let warned = false;
let inboxPromise; // ingested once per process
let inboxDelivered = false; // saved-page jobs are handed to hunt on the first search() call only

export function searchUrl(query, location = 'Perth WA', days = 14) {
  const u = new URL('https://au.indeed.com/jobs');
  u.searchParams.set('q', query);
  u.searchParams.set('l', location);
  u.searchParams.set('fromage', String(days));
  u.searchParams.set('sort', 'date');
  return u.toString();
}

/** Extract the mosaic-provider-jobcards JSON object from Indeed search HTML. Returns null if absent/unparseable. */
function extractMosaic(html) {
  let i = html.indexOf('window.mosaic.providerData["mosaic-provider-jobcards"]');
  if (i < 0) i = html.indexOf("window.mosaic.providerData['mosaic-provider-jobcards']");
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  if (start < 0) return null;
  // brace-balanced scan, string-aware (the JSON is one statement; the next statement follows after "};")
  let depth = 0, inStr = false, esc = false;
  for (let p = start; p < html.length; p++) {
    const ch = html[p];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, p + 1)); } catch { return null; } } }
  }
  return null;
}

const taxo = (r, label) => (Array.isArray(r.taxonomyAttributes) ? r.taxonomyAttributes : [])
  .filter((t) => t?.label === label).flatMap((t) => (t.attributes || []).map((a) => a?.label)).filter(Boolean);

function workTypeOf(r) {
  const types = [...(r.jobTypes || []), ...taxo(r, 'job-types')].map(String);
  if (types.some((t) => /full[- ]?time/i.test(t))) return 'Full time';
  if (types.some((t) => /part[- ]?time/i.test(t))) return 'Part time';
  if (types.some((t) => /contract|temporary|fixed[- ]term|casual/i.test(t))) return 'Contract';
  if (types.some((t) => /graduate|intern/i.test(t))) return 'Graduate';
  return undefined;
}

function remoteOf(r) {
  const labels = taxo(r, 'remote').join(' ').toLowerCase();
  if (/hybrid/.test(labels)) return 'hybrid';
  if (/remote/.test(labels) || r.remoteLocation === true) return 'remote';
  return undefined;
}

function salaryOf(r) {
  const text = r.salarySnippet?.text;
  if (text) return String(text);
  const es = r.extractedSalary;
  if (es && (es.min || es.max)) {
    const fmt = (n) => `$${Math.round(Number(n)).toLocaleString('en-AU')}`;
    const per = { YEARLY: 'a year', MONTHLY: 'a month', WEEKLY: 'a week', DAILY: 'a day', HOURLY: 'an hour' }[es.type] || '';
    return `${es.min && es.max && es.min !== es.max ? `${fmt(es.min)} – ${fmt(es.max)}` : fmt(es.min || es.max)} ${per}`.trim();
  }
  return undefined;
}

/** Parse Indeed search-page HTML (live, or saved from the Browser pane) into normalized Jobs. Never throws. */
export function parseMosaic(html) {
  const data = extractMosaic(String(html || ''));
  const results = data?.metaData?.mosaicProviderJobCardsModel?.results;
  if (!Array.isArray(results)) return [];
  const out = [];
  for (const r of results) {
    try {
      const jk = String(r.jobkey || r.jk || '').trim();
      if (!jk || r.expired === true) continue;
      const jobTypes = [...new Set([...(r.jobTypes || []), ...taxo(r, 'job-types')].map(String))];
      out.push(normalizeJob({
        source: name,
        sourceId: jk,
        title: r.displayTitle || r.title,
        company: r.company || r.truncatedCompany || '',
        location: r.formattedLocation || [r.jobLocationCity, r.jobLocationState].filter(Boolean).join(' '),
        url: `https://au.indeed.com/viewjob?jk=${jk}`,
        postedAt: r.pubDate || r.createDate || undefined,
        salary: salaryOf(r),
        workType: workTypeOf(r),
        remote: remoteOf(r),
        summary: r.snippet || '',
        tags: [...jobTypes, ...taxo(r, 'remote')],
        raw: { sponsored: !!r.sponsored, relativeTime: r.formattedRelativeTime, benefits: taxo(r, 'benefits').slice(0, 6) },
      }));
    } catch { /* skip malformed card */ }
  }
  return out;
}

/** Jobs from inbox/indeed*.html and inbox/indeed/*.html (HTML saved from the Browser pane). Read once per process. */
async function fromInbox() {
  if (!inboxPromise) {
    inboxPromise = (async () => {
      const files = [];
      const scan = async (dir, pred) => {
        let ents = [];
        try { ents = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) if (e.isFile() && pred(e.name)) files.push(path.join(dir, e.name));
      };
      await scan(INBOX, (n) => /^indeed.*\.html?$/i.test(n));
      await scan(path.join(INBOX, 'indeed'), (n) => /\.html?$/i.test(n));
      const seen = new Map();
      for (const f of files) {
        try {
          for (const j of parseMosaic(await readFile(f, 'utf8'))) if (!seen.has(j.id)) seen.set(j.id, j);
        } catch (e) { console.error(`[indeed] could not read ${path.relative(INBOX, f)}: ${e.message}`); }
      }
      if (files.length) console.error(`[indeed] ingested ${seen.size} job(s) from ${files.length} saved page(s) in inbox/`);
      return [...seen.values()];
    })();
  }
  return inboxPromise;
}

function markBlocked(msg = BLOCKED_MSG) {
  blocked = true;
  if (!warned) { warned = true; console.error(msg); }
}

export async function search({ query, location = 'Perth WA' }) {
  // Saved pages first: hand them over on the first call only, so hunt's per-source counts are not inflated per combo.
  const saved = await fromInbox();
  const inboxJobs = saved.length && !inboxDelivered ? saved : [];
  inboxDelivered = true;

  if (blocked) return inboxJobs;
  let r;
  try {
    r = await fetchText(searchUrl(query, location), { minGapMs: 3000, retries: 1, timeoutMs: 20000 });
  } catch {
    markBlocked();
    return inboxJobs;
  }
  const challenged = r.status !== 200 || r.headers['cf-mitigated'] || /Security Check - Indeed|Blocked - Indeed|Authenticating\.\.\./i.test(r.text.slice(0, 4000));
  if (challenged) { markBlocked(); return inboxJobs; }

  const live = parseMosaic(r.text);
  if (!live.length && !r.text.includes('mosaic-provider-jobcards') && !/did not match any jobs/i.test(r.text)) {
    // 200 but no job-cards JSON and not a genuine empty result: page shape changed. Say so once rather than probing 40 more times.
    markBlocked('[indeed] search page returned 200 but no mosaic-provider-jobcards JSON — page shape changed; use the Browser pane (see skills/hunt)');
  }
  const seen = new Set(inboxJobs.map((j) => j.id));
  return [...inboxJobs, ...live.filter((j) => !seen.has(j.id))];
}
