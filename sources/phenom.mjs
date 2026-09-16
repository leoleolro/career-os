// Phenom People career sites (BCG, and any other tenant listed in sources/config/phenom-sites.json).
// Verified 2026-09-12 against https://careers.bcg.com:
//   search : POST {base}/widgets  body {ddoKey:"refineSearch", keywords, selected_fields:{country:[...]}, from, size, ...}
//            → refineSearch.data.jobs[] (jobId, reqId, title, city, state, country, multi_location[string], category,
//              subCategory, type, postedDate, dateCreated, descriptionTeaser, applyUrl, jobSeqNo, ml_skills)
//   details: GET  {base}/{site}/job/{jobId}/{slug}  → HTML whose visible text is a DECOY ("the job ... has been filled")
//            but which embeds `phApp.ddo = {...}` inline; jobDetail.data.job carries description (HTML), applyUrl,
//            multi_location[object], jobDeletedOn / jobReopenedOn. A missing job answers HTTP 410 with hits:0.
//   fallback: GET {base}/{site}/search-results?keywords=... embeds phApp.ddo.eagerLoadRefineSearch (first page only,
//            not country-filtered) — used only when /widgets fails.
//   NOT used: GET {base}/api/apply/v2/jobs?domain=... → {"errorMsg":"Tenant not identified"} for BCG.
// Phenom's keyword search does not stem ("consultant" misses "Consulting (Graduate)"), so results are unioned with a
// local stem match over the site's full in-country catalogue (fetched once per process, a handful of pages at most).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchText, fetchJson } from '../lib/http.mjs';
import { normalizeJob, stripHtml, toIsoDate } from '../lib/schema.mjs';

export const name = 'phenom';
export const description = 'Phenom People career sites (BCG, ...) via POST /widgets + inline phApp.ddo job pages; tenants in sources/config/phenom-sites.json';
export const queryless = false;

const CONFIG_PATH = fileURLToPath(new URL('./config/phenom-sites.json', import.meta.url));
const AU_STATES = { wa: 'western australia', nsw: 'new south wales', vic: 'victoria', qld: 'queensland', sa: 'south australia', tas: 'tasmania', act: 'australian capital territory', nt: 'northern territory' };
const AU_HINTS = ['australia', 'perth', 'sydney', 'melbourne', 'brisbane', 'adelaide', 'canberra', 'hobart', 'darwin', ...Object.keys(AU_STATES), ...Object.values(AU_STATES)];
const STOP = new Set(['and', 'or', 'the', 'of', 'in', 'for', 'a', 'an', 'to', 'with', 'remote', 'australia']);

let configCache; // parsed phenom-sites.json
const catalogueCache = new Map(); // `${site.key}|${countries}` -> raw job[] (per process)

async function loadSites() {
  if (!configCache) {
    const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    const d = cfg.defaults || {};
    configCache = (cfg.sites || []).filter((s) => s.enabled !== false && s.base && s.site).map((s) => ({ ...d, ...s, base: s.base.replace(/\/+$/, '') }));
  }
  return configCache;
}

// ---------- helpers ----------
const slugify = (s) => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-{2,}/g, '-').slice(0, 120);
const decodeEntities = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#38;/g, '&');

/** Phenom apply links carry tracking junk (post_onboarding_pid, customredirect, utm_*). Keep show_apply/profile_type. */
function cleanApplyUrl(u) {
  if (!u) return undefined;
  try {
    const url = new URL(decodeEntities(u));
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|post_onboarding_pid|customredirect)/i.test(k)) url.searchParams.delete(k);
    return url.toString();
  } catch { return decodeEntities(u); }
}

/** multi_location is string[] in search results and object[] on job pages. */
function locationText(j) {
  const ml = Array.isArray(j.multi_location) ? j.multi_location : [];
  const parts = ml.map((m) => (typeof m === 'string' ? m : m?.location || [m?.city, m?.state, m?.country].filter(Boolean).join(', '))).filter(Boolean);
  if (!parts.length) parts.push([j.city, j.state, j.country].filter(Boolean).join(', ') || j.location || '');
  return [...new Set(parts)].join('; ');
}

function countriesOf(j) {
  const ml = Array.isArray(j.multi_location) ? j.multi_location : [];
  const set = new Set([j.country, ...ml.map((m) => (typeof m === 'string' ? m.split(',').pop() : m?.country))].map((c) => String(c || '').trim().toLowerCase()).filter(Boolean));
  return set;
}

function workTypeOf(j) {
  const t = `${j.type || ''} ${j.jobType || ''}`.toLowerCase();
  const grad = /\b(graduate|intern(ship)?)\b/i.test(j.title || ''); // subCategory is unreliable (BCG tags senior roles 'Co-op/Intern/Temporary')
  if (grad) return 'Graduate';
  if (/full/.test(t)) return 'Full time';
  if (/part/.test(t)) return 'Part time';
  if (/contract|temp/.test(t)) return 'Contract';
  return j.type ? String(j.type) : '';
}

/** Tokens of a hunt location ("Perth WA" → ["perth", "western australia"]). Empty for "Remote Australia". */
function locationTokens(location) {
  return String(location || '').toLowerCase().split(/[\s,/]+/).map((t) => AU_STATES[t] || t).filter((t) => t.length >= 3 && !STOP.has(t));
}
const looksAustralian = (location) => { const l = String(location || '').toLowerCase(); return !l.trim() || AU_HINTS.some((h) => new RegExp(`\\b${h}\\b`).test(l)); };

// crude stemmer + prefix compare so "consultant" ~ "consulting", "engineer" ~ "engineering"; short tokens must match a whole word
const stem = (w) => w.toLowerCase().replace(/(ants?|ing|ers?|ed|s)$/, '');
function tokenMatches(token, words) {
  const t = token.toLowerCase();
  if (t.length < 4) return words.includes(t);
  const ts = stem(t);
  return words.some((w) => { const ws = stem(w); return ws.startsWith(ts) || ts.startsWith(ws) && ws.length >= 4; });
}
function localMatch(query, j) {
  const tokens = String(query || '').toLowerCase().split(/[^a-z0-9+#.]+/i).filter((t) => t && !STOP.has(t));
  if (!tokens.length) return false;
  // ml_skills deliberately excluded: Phenom tags e.g. an Operations Manager with 'ai technologies'
  const hay = [j.title, j.descriptionTeaser, j.category, j.subCategory, ...(j.multi_category || [])].join(' ').toLowerCase();
  const words = hay.split(/[^a-z0-9+#.]+/).filter(Boolean);
  return tokens.every((t) => tokenMatches(t, words));
}

/** Extract the inline `phApp.ddo = {...}` object from a Phenom page (brace-matched, string-aware; tolerates `phApp.ddo={`). */
export function extractDdo(html) {
  html = String(html || '');
  const m = /phApp\.ddo\s*=\s*\{/.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length - 1; // index of the opening brace
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(html.slice(start, k + 1)); } catch { return null; } }
  }
  return null;
}

// ---------- remote calls ----------
function widgetsBody(site, { keywords, from, size, countries }) {
  return {
    lang: site.lang, deviceType: 'desktop', country: site.country, pageName: 'search-results', ddoKey: 'refineSearch',
    sortBy: 'Most recent', subsearch: '', from, jobs: true, counts: true,
    all_fields: ['category', 'country', 'state', 'city', 'type', 'subCategory'], size, clearAll: false, jdsource: 'facets',
    isSliderEnable: false, pageId: site.pageId, siteType: site.siteType, keywords, global: true,
    selected_fields: countries.length ? { country: countries } : {}, locationData: {},
  };
}

/** Paginated POST /widgets refineSearch. Returns raw Phenom job objects. Throws on hard failure. */
async function widgetsSearch(site, keywords, countries, { maxPages = site.maxPages, size = site.pageSize } = {}) {
  const out = [];
  for (let page = 0, from = 0; page < maxPages; page++, from += size) {
    const d = await fetchJson(`${site.base}/widgets`, {
      method: 'POST', minGapMs: site.minGapMs, retries: 2,
      headers: { 'content-type': 'application/json', origin: site.base, referer: `${site.base}/${site.site}/search-results` },
      body: JSON.stringify(widgetsBody(site, { keywords, from, size, countries })),
    });
    const rs = d?.refineSearch;
    if (!rs || typeof rs !== 'object') throw new Error(`widgets: no refineSearch in response (${JSON.stringify(d).slice(0, 120)})`);
    const jobs = rs.data?.jobs || [];
    out.push(...jobs);
    const total = Number(rs.totalHits ?? rs.hits ?? 0);
    if (!jobs.length || jobs.length < size || from + size >= total) break;
  }
  return out;
}

/** Fallback when /widgets is broken: the SSR search page embeds the first page of results. */
async function htmlSearch(site, keywords) {
  const u = new URL(`${site.base}/${site.site}/search-results`);
  if (keywords) u.searchParams.set('keywords', keywords);
  const r = await fetchText(u.toString(), { minGapMs: site.minGapMs, retries: 2, cacheTtlMs: 30 * 60 * 1000 });
  if (r.status >= 400) throw new Error(`HTTP ${r.status} for ${u}`);
  const ddo = extractDdo(r.text);
  const jobs = ddo?.eagerLoadRefineSearch?.data?.jobs || ddo?.refineSearch?.data?.jobs;
  if (!Array.isArray(jobs)) throw new Error('search-results page has no eagerLoadRefineSearch data');
  return jobs;
}

async function catalogue(site, countries) {
  const key = `${site.key}|${countries.join(',')}`;
  if (!catalogueCache.has(key)) catalogueCache.set(key, widgetsSearch(site, '', countries).catch((e) => { catalogueCache.delete(key); throw e; }));
  return catalogueCache.get(key);
}

// ---------- adapter API ----------
function toJob(site, j) {
  const jobId = String(j.jobId || j.reqId || '').trim();
  const url = jobId ? `${site.base}/${site.site}/job/${jobId}/${slugify(j.title)}` : '';
  return normalizeJob({
    source: name,
    sourceId: jobId ? `${site.key}-${jobId}` : '',
    title: j.title,
    company: site.company || j.companyName || site.key,
    location: locationText(j),
    url,
    applyUrl: cleanApplyUrl(j.applyUrl),
    postedAt: j.postedDate || j.dateCreated,
    workType: workTypeOf(j),
    summary: j.descriptionTeaser || j.ai_summary || '',
    description: j.description || undefined,
    tags: [...new Set([j.category, j.subCategory, ...(j.multi_category || []), ...(j.ml_skills || []).slice(0, 8)].filter(Boolean).map(String))],
    raw: {
      site: site.key, jobSeqNo: j.jobSeqNo, reqId: j.reqId, city: j.city, state: j.state, country: j.country,
      type: j.type, dateCreated: j.dateCreated, portal: (() => { try { return new URL(decodeEntities(j.applyUrl)).host; } catch { return undefined; } })(),
    },
  });
}

/**
 * search({query, location, prefs}) → Job[] from every configured Phenom site.
 * Jobs are kept when they sit in the site's configured countries (Australia, any city) OR match the hunt `location` text.
 */
export async function search({ query = '', location = '', prefs } = {}) {
  const sites = await loadSites();
  const out = [];
  if (!sites.length) { process.stderr.write('  [phenom] no enabled sites in sources/config/phenom-sites.json — returning []\n'); return out; }
  const locTokens = locationTokens(location);
  const q = String(query || '').trim();
  for (const site of sites) {
    const countries = Array.isArray(site.countries) ? site.countries : [];
    // A non-Australian hunt location (e.g. "Singapore") widens the server query to the whole tenant; the local filter narrows it.
    const serverCountries = looksAustralian(location) ? countries : [];
    const seen = new Map(); // jobId -> raw
    const add = (j) => { const id = String(j?.jobId || j?.reqId || ''); if (id && !seen.has(id)) seen.set(id, j); };
    try {
      if (q) for (const j of await widgetsSearch(site, q, serverCountries)) add(j);
      // union with a local stem match over the in-country catalogue ("consultant" must also find "Consulting (Graduate)")
      const all = q ? await catalogue(site, serverCountries) : await widgetsSearch(site, '', serverCountries);
      for (const j of all) if (!q || localMatch(q, j)) add(j);
    } catch (e) {
      process.stderr.write(`  [phenom:${site.key}] /widgets failed (${String(e.message).slice(0, 100)}); trying search-results HTML fallback\n`);
      let fb;
      try { fb = await htmlSearch(site, q); } catch (e2) { throw new Error(`phenom:${site.key} unreachable — widgets: ${e.message.slice(0, 80)}; html: ${e2.message.slice(0, 80)}`); }
      for (const j of fb) if (!q || localMatch(q, j)) add(j);
    }
    for (const j of seen.values()) {
      try {
        const cs = countriesOf(j);
        const inCountry = !countries.length || countries.some((c) => cs.has(String(c).toLowerCase()));
        const locText = locationText(j).toLowerCase();
        const locHit = locTokens.length > 0 && locTokens.some((t) => locText.includes(t));
        if (!inCountry && !locHit) continue;
        out.push(toJob(site, j));
      } catch { /* skip malformed record */ }
    }
  }
  return out;
}

/** Full description + clean apply link from the job page's inline phApp.ddo (the visible HTML is a decoy). */
export async function details(job) {
  if (!job?.url) return {};
  const sites = await loadSites();
  const site = sites.find((s) => s.key === job.raw?.site) || sites.find((s) => job.url.startsWith(s.base)) || {};
  const r = await fetchText(job.url, { minGapMs: site.minGapMs || 1500, retries: 2, cacheTtlMs: 24 * 3600 * 1000, headers: { accept: 'text/html,application/xhtml+xml' } });
  const ddo = extractDdo(r.text);
  const jd = ddo?.jobDetail;
  if (!jd) {
    if (r.status === 404 || r.status === 410) return { notFound: true, raw: { ...(job.raw || {}), status: `http ${r.status}` } };
    if (r.status >= 400) throw new Error(`phenom details HTTP ${r.status}`);
    throw new Error(`phenom details: no phApp.ddo in ${job.url} (status ${r.status})`);
  }
  const j = jd.data?.job;
  if (!j || Number(jd.hits ?? 0) === 0) return { notFound: true, raw: { ...(job.raw || {}), status: 'closed', checkedAt: new Date().toISOString().slice(0, 10) } };
  const deleted = Date.parse(j.jobDeletedOn || '') || 0, reopened = Date.parse(j.jobReopenedOn || '') || 0;
  const status = deleted && deleted > reopened ? 'closed' : 'open';
  const out = {
    description: (j.description || j.description2) ? stripHtml(j.description || j.description2) : undefined,
    applyUrl: cleanApplyUrl(j.applyUrl) || job.applyUrl,
    raw: { ...(job.raw || {}), status, checkedAt: new Date().toISOString().slice(0, 10), jobUpdatedDate: j.jobUpdatedDate, jobReopenedOn: j.jobReopenedOn, jobDeletedOn: j.jobDeletedOn },
  };
  const loc = locationText(j); if (loc) out.location = loc;
  if (j.postedDate) out.postedAt = toIsoDate(j.postedDate);
  const tags = [...new Set([...(job.tags || []), j.category, j.subCategory, ...(j.ml_skills || []).slice(0, 8)].filter(Boolean).map(String))];
  if (tags.length) out.tags = tags;
  return out;
}
