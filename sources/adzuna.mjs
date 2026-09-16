// Adzuna — official JSON API (free key). Register at https://developer.adzuna.com/ → create an app → app_id + app_key.
// Verified 2026-09-12 (without a key, so: auth path, official swagger spec, public ad pages):
//   GET https://api.adzuna.com/v1/api/jobs/au/search/{page}?app_id=..&app_key=..&what=..&where=..&distance=50&max_days_old=30&results_per_page=50&sort_by=date
//     → 401 {"exception":"AUTH_FAIL"} on bad keys (400 HTML "Uh oh" when app_id/app_key are missing entirely).
//     Response shape per the swagger spec at https://developer.adzuna.com/swagger/spec/test2.json and the docs sample:
//       { count, results: [{ id, title, description (truncated to 500 chars), created (ISO 8601), redirect_url, adref,
//                            company.display_name, location.display_name, location.area[], category.label, category.tag,
//                            salary_min, salary_max, salary_is_predicted ("0"/"1"), contract_type (permanent|contract),
//                            contract_time (full_time|part_time), latitude, longitude }] }
//     `distance` defaults to 5 km (spec), so we pass 50 for city searches. adzuna.com.au's own search resolves "Perth WA";
//     "Remote Australia" is not a place, so remote-style locations search nationwide (no `where`) with "remote" folded into `what`.
//   details(): the public ad page https://www.adzuna.com.au/details/{id} (no key; same numeric id as the API / redirect_url)
//     carries a JSON-LD JobPosting with the full description, employmentType and datePosted; <section class="adp-body"> is the
//     HTML fallback. Verified on a live ad; a missing ad returns {}.
// Keys: env ADZUNA_APP_ID + ADZUNA_APP_KEY, else data/secrets.json {"adzuna":{"app_id":"","app_key":""}} (copy data/secrets.example.json).
// Without keys the adapter prints ONE stderr line per process and returns [] so the rest of the hunt still runs.
// With rejected keys it throws once (so hunt.mjs logs it) and then returns [] for the remaining combos of the run.
// Free tier is rate-limited (per-day quota) — keep maxPages small; responses are cached 30 min by http.mjs.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchJson, fetchText } from '../lib/http.mjs';
import { normalizeJob, stripHtml, toIsoDate } from '../lib/schema.mjs';

export const name = 'adzuna';
export const description = 'Adzuna Australia job search API (free app_id/app_key from developer.adzuna.com)';

const SECRETS = fileURLToPath(new URL('../data/secrets.json', import.meta.url));
const API = 'https://api.adzuna.com/v1/api/jobs/au/search/';
const DISABLED_MSG = '[adzuna] disabled: add keys to data/secrets.json (free at https://developer.adzuna.com/)';

let keysPromise; // resolved once per process
let warned = false;
let rejected = false; // keys failed once this run — do not hammer the API 40 more times

async function loadKeys() {
  if (!keysPromise) {
    keysPromise = (async () => {
      const id = (process.env.ADZUNA_APP_ID || '').trim();
      const key = (process.env.ADZUNA_APP_KEY || '').trim();
      if (id && key) return { app_id: id, app_key: key };
      try {
        const s = JSON.parse(await readFile(SECRETS, 'utf8'));
        const a = s?.adzuna || {};
        const fid = String(a.app_id || '').trim(), fkey = String(a.app_key || '').trim();
        if (fid && fkey) return { app_id: fid, app_key: fkey };
      } catch (e) {
        if (e?.code !== 'ENOENT') console.error(`[adzuna] could not read data/secrets.json: ${e.message}`);
      }
      return null;
    })();
  }
  return keysPromise;
}

/** Map hunt's location strings onto Adzuna's geocoder. Returns { what, where, distance }. */
export function mapSearch(query, location) {
  const loc = String(location || '').trim();
  const q = String(query || '').trim();
  const remote = /\b(remote|anywhere|work from home|wfh)\b/i.test(loc);
  if (!loc || remote || /^australia$/i.test(loc)) {
    return { what: remote && !/\bremote\b/i.test(q) ? `${q} remote` : q, where: '', distance: '' };
  }
  return { what: q, where: loc, distance: '50' };
}

function fmtSalary(j) {
  const min = Number(j.salary_min), max = Number(j.salary_max);
  const aud = (n) => `$${Math.round(n).toLocaleString('en-AU')}`;
  let s = '';
  if (min && max) s = min === max ? aud(min) : `${aud(min)} – ${aud(max)}`;
  else if (min) s = `from ${aud(min)}`;
  else if (max) s = `up to ${aud(max)}`;
  if (!s) return undefined;
  return String(j.salary_is_predicted) === '1' ? `${s} (est.)` : s;
}

const WORKTYPE = { full_time: 'Full time', part_time: 'Part time', contract: 'Contract' };
function workType(j) {
  return WORKTYPE[j.contract_time] || (j.contract_type === 'contract' ? 'Contract' : '') || undefined;
}

/** Never let app_key/app_id leak into hunt reports via error messages. */
function scrub(msg, keys) {
  let m = String(msg);
  for (const v of Object.values(keys)) if (v) m = m.split(v).join('***');
  return m;
}

/** Map one API result to a Job. Exported so it can be unit-tested against the documented sample without a key. */
export function toJob(j) {
  const id = String(j.id || '').trim();
  if (!id) return null;
  return normalizeJob({
    source: name,
    sourceId: id,
    title: stripHtml(j.title || ''), // the API wraps matched terms in <strong>
    company: j.company?.display_name || '',
    location: j.location?.display_name || (j.location?.area || []).slice().reverse().join(', '),
    url: `https://www.adzuna.com.au/details/${id}`,
    applyUrl: j.redirect_url || undefined,
    postedAt: j.created,
    salary: fmtSalary(j),
    workType: workType(j),
    summary: j.description || '',
    tags: [j.category?.label, j.contract_type, j.contract_time].filter(Boolean),
    raw: { redirect_url: j.redirect_url, category: j.category?.tag, salary_is_predicted: j.salary_is_predicted, adref: j.adref },
  });
}

export async function search({ query, location = 'Perth WA', prefs = {}, maxPages = 2 }) {
  const keys = await loadKeys();
  if (!keys) {
    if (!warned) { warned = true; console.error(DISABLED_MSG); }
    return [];
  }
  if (rejected) return [];
  const { what, where, distance } = mapSearch(query, location);
  const perPage = 50;
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = new URL(API + page);
    u.searchParams.set('app_id', keys.app_id);
    u.searchParams.set('app_key', keys.app_key);
    u.searchParams.set('what', what);
    if (where) u.searchParams.set('where', where);
    if (distance) u.searchParams.set('distance', distance);
    u.searchParams.set('max_days_old', String(Number(prefs.max_days_old) || 30));
    u.searchParams.set('results_per_page', String(perPage));
    u.searchParams.set('sort_by', 'date');
    u.searchParams.set('content-type', 'application/json');
    let d;
    try {
      d = await fetchJson(u.toString(), { minGapMs: 1000, cacheTtlMs: 30 * 60 * 1000 });
    } catch (e) {
      if (/HTTP 40[13]\b/.test(e.message)) {
        rejected = true;
        throw new Error('Adzuna rejected the API keys (AUTH_FAIL) — check ADZUNA_APP_ID/ADZUNA_APP_KEY or data/secrets.json; skipping adzuna for the rest of this run');
      }
      throw new Error(scrub(e.message, keys));
    }
    const items = Array.isArray(d?.results) ? d.results : [];
    for (const j of items) {
      try { const job = toJob(j); if (job) out.push(job); } catch { /* skip malformed record */ }
    }
    const total = Number(d?.count) || 0;
    if (items.length < perPage || (total && page * perPage >= total)) break;
  }
  return out;
}

const EMPLOYMENT = { FULL_TIME: 'Full time', PART_TIME: 'Part time', CONTRACTOR: 'Contract', CONTRACT: 'Contract', TEMPORARY: 'Contract', INTERN: 'Graduate' };

/** Full description from the public ad page (no key needed). JSON-LD JobPosting first, adp-body HTML as fallback. */
export async function details(job) {
  if (!job.sourceId) return {};
  const r = await fetchText(`https://www.adzuna.com.au/details/${job.sourceId}`, { minGapMs: 1500, retries: 2, cacheTtlMs: 24 * 3600 * 1000 });
  if (r.status !== 200) return {};
  for (const m of r.text.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed;
    try { parsed = JSON.parse(m[1]); } catch { continue; }
    const post = (Array.isArray(parsed) ? parsed : [parsed]).find((o) => o && o['@type'] === 'JobPosting');
    if (!post?.description) continue;
    const et = [].concat(post.employmentType || []).map((t) => String(t).toUpperCase());
    const out = { description: stripHtml(post.description) };
    const wt = et.map((t) => EMPLOYMENT[t]).find(Boolean);
    if (wt && !job.workType) out.workType = wt;
    if (et.length) out.tags = [...new Set([...(job.tags || []), ...et.map((t) => t.toLowerCase())])];
    if (!job.postedAt && post.datePosted) out.postedAt = toIsoDate(post.datePosted);
    const sal = post.baseSalary?.value;
    if (!job.salary && sal && (sal.minValue || sal.value)) out.salary = sal.minValue && sal.maxValue ? `$${sal.minValue} – $${sal.maxValue}` : `$${sal.value || sal.minValue}`;
    return out;
  }
  const body = r.text.match(/<section[^>]*class="[^"]*adp-body[^"]*"[^>]*>([\s\S]*?)<\/section>/i);
  return body ? { description: stripHtml(body[1]) } : {};
}
