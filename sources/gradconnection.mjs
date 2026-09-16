// GradConnection / SEEK Grad (au.gradconnection.com) — Australian graduate programs, internships, entry-level.
// Plain-fetchable (no bot wall, no key). The React front-end talks to a public JSON API that we call directly.
// Verified 2026-09-12:
//   search : GET https://au.gradconnection.com/api/campaignsearch/?job_type=graduate-jobs&location=perth,AU,Cities
//                &query=<keywords>&disciplines=<slug>&limit=100&offset=0
//            → bare JSON array of "campaign groups": [{ campaigns:[{ id, title, slug, description, job_type, interval{start,end},
//              locations[], disciplines[], display_disciplines[], work_rights[], salary, show_salary, remote_option,
//              target_url (/track-link/..), origin_target_url (employer ATS), is_event, item_type }], customer_organization{name,slug,logo},
//              earliest_closing_date }]
//            Response HEADERS carry the paging metadata: `count` (total), `link: <...offset=N>; rel="next"`,
//            and `fallback: true|false` + `fallback_amount: N`. FALLBACK MATTERS: when a keyword matches few/no jobs the API
//            still returns a full page padded with unrelated jobs — only the first `fallback_amount` results (from offset 0)
//            are real matches. Keyword search is OR-ish across words ("graduate program 2027" matches ~everything).
//            `location` must be the full `<slug>,AU,<Type>` value (bare "perth" is ignored). `disciplines` takes ONE slug
//            (a comma list is ignored). `item_type: "notify_me"` records are "notify me when this employer posts" placeholders.
//   details: GET https://au.gradconnection.com/api/campaigns/<campaign-slug>/ → { content.body (HTML), job_time,
//            job_commencement_date, graduation_dates{start,end}, degree_level, salary_details, origin_target_url, ... }
//   html   : /graduate-jobs/<location>/<discipline>/ embeds `window.__initialState__ = {...}` (JS literal, not JSON) with the
//            same campaigngroupstore data — but the SSR ignores the discipline slug, so the API is the reliable route.
//   NOT used: the /track-link/<id>/ redirector (needs a browser session); origin_target_url is the same destination.
// Job page: https://au.gradconnection.com/employers/<org-slug>/jobs/<campaign-slug>/
import { fetchText, fetchJson } from '../lib/http.mjs';
import { normalizeJob, toIsoDate } from '../lib/schema.mjs';

export const name = 'gradconnection';
export const description = 'GradConnection / SEEK Grad graduate programs via public /api/campaignsearch JSON (no key)';
export const queryless = false;

const SITE = 'https://au.gradconnection.com';
const API = `${SITE}/api`;
const JOB_TYPE = 'graduate-jobs';
const NATIONAL = 'australia,AU,Country';
// Fixed discipline sweep run alongside every keyword search. It is fetched NATIONWIDE and filtered locally, so the same
// URLs serve every hunt location and http.mjs's 30-min cache makes it ~2 requests per discipline per process.
const DISCIPLINES = ['computer-science', 'consulting', 'data-science-and-analytics', 'engineering-software'];
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const CACHE_MS = 30 * 60 * 1000;

const CITIES = ['perth', 'sydney', 'melbourne', 'brisbane', 'canberra', 'adelaide', 'hobart', 'darwin'];
// Location labels that mean "anywhere in Australia" (country-level postings are NOT returned by a city filter server-side).
const NATIONWIDE = /^australia$|all of australia|all locations|nationwide|australia[- ]wide|remote/i;

/**
 * Map a free-text hunt location ("Perth WA", "Remote Australia", "Sydney NSW") to
 *   value : the GradConnection `location` filter value used for the keyword search
 *   keep  : (locations[], campaign) → boolean post-filter applied to every campaign (keyword + nationwide sweep)
 */
function resolveLocation(location = '') {
  const l = String(location).toLowerCase();
  if (/\bremote\b/.test(l)) {
    // the server's "remote" filter is exactly remote_option === 'remote_friendly' (verified 2026-09-12)
    return { value: 'remote,AU,Remote', keep: (locs, c) => /remote/i.test(String(c?.remote_option || '')) || locs.some((x) => NATIONWIDE.test(x)) };
  }
  if (/\bperth\b|western australia|\bwa\b/.test(l)) return { value: 'perth,AU,Cities', keep: matcher(/perth|western australia/i) };
  for (const c of CITIES) if (l.includes(c)) return { value: `${c},AU,Cities`, keep: matcher(new RegExp(c, 'i')) };
  return { value: NATIONAL, keep: () => true };
}
// Keep a job if any of its locations is the wanted city/state, is Australia-wide / all locations / remote, or it lists none.
function matcher(re) {
  return (locs) => !locs.length || locs.some((x) => re.test(x) || NATIONWIDE.test(x));
}

/** One page of /campaignsearch/. Returns { groups, count, fallback, fallbackAmount }. Throws on HTTP >= 400. */
async function searchPage(params, offset) {
  const u = new URL(`${API}/campaignsearch/`);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  u.searchParams.set('limit', String(PAGE_SIZE));
  u.searchParams.set('offset', String(offset));
  const r = await fetchText(u.toString(), { headers: { accept: 'application/json' }, minGapMs: 1500, cacheTtlMs: CACHE_MS });
  if (r.status >= 400) throw new Error(`HTTP ${r.status} for ${u}: ${r.text.slice(0, 200)}`);
  let groups;
  try { groups = JSON.parse(r.text); } catch { throw new Error(`Non-JSON from ${u}: ${r.text.slice(0, 200)}`); }
  const h = r.headers || {};
  return {
    groups: Array.isArray(groups) ? groups : [],
    count: Number(h.count || 0),
    fallback: String(h.fallback || '').toLowerCase() === 'true',
    fallbackAmount: Number(h.fallback_amount || 0),
  };
}

/** All real-match campaign groups for a filter set, honouring the fallback headers and the page cap. */
async function searchAll(params) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const { groups, count, fallback, fallbackAmount } = await searchPage(params, offset);
    if (fallback) {
      // padded response: only the leading `fallbackAmount` results (counted from offset 0) match the query
      const real = Math.max(0, fallbackAmount - offset);
      out.push(...groups.slice(0, real));
      if (groups.length < PAGE_SIZE || offset + groups.length >= fallbackAmount) break;
      continue;
    }
    out.push(...groups);
    if (!groups.length || groups.length < PAGE_SIZE || offset + groups.length >= count) break;
  }
  return out;
}

// SEEK Grad's own "Top100 Future Leader Award" competitions sit in the graduate-jobs feed (and the site re-posts each one
// under its own 'seek-grad' organisation). Keep the employer's copy but flag it — it is an award, not a job.
const AWARD_RE = /\btop\s?100\b|future leader award/i;
const SITE_ORGS = new Set(['seek-grad', 'gradconnection']);

function toJob(group, campaign) {
  const c = campaign;
  const org = group.customer_organization || {};
  if (!c || c.item_type === 'notify_me' || !c.interval) return null; // placeholder, not a posting
  if (!c.slug || !org.slug || SITE_ORGS.has(org.slug)) return null;
  const closesAt = c.interval?.end || group.earliest_closing_date || '';
  if (closesAt && Date.parse(closesAt) < Date.now()) return null; // already closed
  const closes = toIsoDate(closesAt);
  const locs = (Array.isArray(c.locations) ? c.locations : []).filter(Boolean).map(String);
  const jobType = typeof c.job_type === 'string' ? c.job_type : c.job_type?.name || '';
  const ro = String(c.remote_option || '').toLowerCase();
  const remote = ro === 'remote_friendly' || ro === 'hybrid' ? 'hybrid' : ro.includes('remote') ? 'remote' : undefined;
  const isAward = AWARD_RE.test(String(c.title || ''));
  const summary = [
    closes ? `Closes ${closes}` : '',
    c.is_event ? 'Event (not a job posting)' : isAward ? 'Award / competition (not a job posting)' : '',
    c.description || '',
  ].filter(Boolean).join(' · ');
  const tags = [
    jobType,
    ...(Array.isArray(c.display_disciplines) ? c.display_disciplines : []),
    ...(Array.isArray(c.work_rights) ? c.work_rights.map((w) => (typeof w === 'string' ? w : w?.name)) : []),
    c.is_event ? 'Event' : '',
    isAward ? 'Award' : '',
  ].filter(Boolean);
  const applyUrl = c.origin_target_url || (c.target_url ? new URL(c.target_url, SITE).toString() : undefined);
  return normalizeJob({
    source: name,
    sourceId: String(c.id || ''),
    title: c.title,
    company: org.name || '',
    location: locs.join('; '),
    url: `${SITE}/employers/${org.slug}/jobs/${c.slug}/`,
    applyUrl,
    postedAt: c.interval?.start,
    salary: c.show_salary && c.salary ? String(c.salary) : undefined,
    workType: 'Graduate',
    remote,
    summary,
    tags,
    raw: { closes: closesAt, slug: c.slug, org: org.slug, remote_option: c.remote_option || '', is_event: !!c.is_event, disciplines: (c.disciplines || []).slice(0, 12) },
  });
}

export async function search({ query = '', location = 'Perth WA' }) {
  const loc = resolveLocation(location);
  const filterSets = [];
  // keyword search: server-side location filter (precise; fallback-aware) — the discipline sweep is nationwide + local filter
  if (String(query).trim()) filterSets.push({ job_type: JOB_TYPE, location: loc.value, query: String(query).trim() });
  for (const d of DISCIPLINES) filterSets.push({ job_type: JOB_TYPE, location: NATIONAL, disciplines: d });

  const out = new Map(); // id -> job (a job appears under several disciplines)
  let hardErrors = 0, lastErr;
  for (const params of filterSets) {
    let groups;
    try { groups = await searchAll(params); } catch (e) { hardErrors++; lastErr = e; continue; }
    for (const g of groups) {
      for (const c of g?.campaigns || []) {
        try {
          const locs = (Array.isArray(c?.locations) ? c.locations : []).filter(Boolean).map(String);
          if (!loc.keep(locs, c)) continue;
          const job = toJob(g, c);
          if (job && !out.has(job.id)) out.set(job.id, job);
        } catch { /* skip malformed campaign */ }
      }
    }
  }
  // every request failed → hard failure so hunt.mjs logs it; partial failures just shrink the result
  if (hardErrors === filterSets.length && lastErr) throw new Error(`gradconnection: all ${filterSets.length} requests failed: ${lastErr.message}`);
  return [...out.values()];
}

/** Full posting HTML + a few structured extras via /api/campaigns/<slug>/. Returns only the fields it could fill. */
export async function details(job) {
  const slug = job.raw?.slug || (job.url.match(/\/jobs\/([^/?#]+)\/?$/) || [])[1];
  if (!slug) return {};
  const d = await fetchJson(`${API}/campaigns/${encodeURIComponent(slug)}/`, { minGapMs: 1500, cacheTtlMs: 24 * 3600 * 1000 });
  const patch = {};
  const body = d?.content?.body || d?.draft_content?.body || '';
  if (body) patch.description = body;
  const extra = [];
  if (d?.job_time) extra.push(`Job time: ${d.job_time}`);
  if (d?.job_commencement_date) extra.push(`Commences: ${d.job_commencement_date}`);
  if (d?.graduation_dates?.start || d?.graduation_dates?.end) extra.push(`Graduation window: ${d.graduation_dates.start || '?'} to ${d.graduation_dates.end || '?'}`);
  if (d?.degree_level) extra.push(`Degree level: ${typeof d.degree_level === 'string' ? d.degree_level : d.degree_level?.name || ''}`);
  if (d?.interval?.end) extra.push(`Closes: ${toIsoDate(d.interval.end)}`);
  if (extra.length) patch.tags = [...new Set([...(job.tags || []), ...extra])];
  if (d?.show_salary && (d.salary_details || d.salary)) patch.salary = String(d.salary_details || d.salary);
  if (d?.origin_target_url) patch.applyUrl = d.origin_target_url;
  return patch;
}
