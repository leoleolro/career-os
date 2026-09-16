// Oracle Recruiting Cloud (Fusion HCM "Candidate Experience") career sites — Oracle itself plus any tenant listed in
// sources/config/orc-sites.json (Westpac, Suncorp, Wood, Downer, CIMIC, GHD, WSP, ...). Public REST, no auth.
// Verified 2026-09-12 against eeho.fa.us2.oraclecloud.com (Oracle, CX_45001) and seven Australian tenants:
//   search : GET https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions
//              ?onlyData=true&expand=requisitionList.secondaryLocations
//              &finder=findReqs;siteNumber={site},limit=50,offset=0,sortBy=POSTING_DATES_DESC,keyword={q},selectedLocationsFacet={id}
//            → items[0] { TotalJobsCount, Offset, Limit, requisitionList[] { Id, Title, PrimaryLocation, PrimaryLocationCountry,
//              PostedDate, ShortDescriptionStr, WorkplaceTypeCode, JobSchedule, WorkerType, ContractType, secondaryLocations[{Name}] } }
//            requisitionList is ONLY present when the expand parameter is sent. limit up to 200 works; offset paginates.
//            Keyword search is fuzzy, stemmed and covers descriptions ("consult" ≈ "consultant" ≈ "consulting").
//   facet  : ...finder=findReqs;siteNumber={site},facetsList=LOCATIONS,limit=1,userTargetFacetName=LOCATIONS,userTargetFacetInputTerm=Australia
//            → items[0].locationsFacet[] {Id, Name, TotalCount} — the country's geography Id differs per tenant, so it is looked up
//            once per site per process and passed as selectedLocationsFacet (also matches jobs whose *secondary* location is in AU).
//   details: GET .../recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="{Id}",siteNumber={site}
//            → items[0] { ExternalDescriptionStr, ExternalResponsibilitiesStr, ExternalQualificationsStr, Category, JobFamily,
//              ExternalPostedStartDate, requisitionFlexFields[{Prompt, Value}], skills[] }
//   job URL: {urlBase}/en/sites/{siteUrlName || site}/job/{Id}   (urlBase defaults to https://{host}/hcmUI/CandidateExperience)
// Location rule: jobs are restricted server-side to the site's country (default Australia), then client-side to the hunt
// location (Perth / WA / nationwide / remote). Dream companies (prefs.dream_companies or config dream:true) keep every job in-country.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchJson } from '../lib/http.mjs';
import { normalizeJob, stripHtml, toIsoDate } from '../lib/schema.mjs';

export const name = 'oracle-orc';
export const description = 'Oracle Recruiting Cloud career sites (Oracle, Westpac, Suncorp, Wood, Downer, CIMIC, GHD, WSP, ...) via the public recruitingCEJobRequisitions REST API; tenants in sources/config/orc-sites.json';
export const queryless = false;

const CONFIG_PATH = fileURLToPath(new URL('./config/orc-sites.json', import.meta.url));
const AU_STATES = { wa: 'western australia', nsw: 'new south wales', vic: 'victoria', qld: 'queensland', sa: 'south australia', tas: 'tasmania', act: 'australian capital territory', nt: 'northern territory' };
const STOP = new Set(['and', 'or', 'the', 'of', 'in', 'for', 'a', 'an', 'to', 'with', 'remote', 'australia', 'metro', 'area', 'region']);
const PAGE_SIZE = 50;
const MAX_PAGES = 2;

let configCache; // parsed orc-sites.json
const facetCache = new Map(); // `${host}|${site}|${country}` -> geography Id (or null when the site has no jobs there)

async function loadSites() {
  if (!configCache) {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.sites || [];
    configCache = list
      .filter((s) => s && s.host && s.site && s.enabled !== false)
      .map((s) => ({
        country: 'Australia',
        ...s,
        host: String(s.host).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
        urlBase: (s.urlBase || `https://${String(s.host).replace(/^https?:\/\//, '').replace(/\/+$/, '')}/hcmUI/CandidateExperience`).replace(/\/+$/, ''),
        name: s.name || String(s.company || s.host).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      }));
  }
  return configCache;
}

// ---------- helpers ----------
const restBase = (site) => `https://${site.host}/hcmRestApi/resources/latest`;
const jobUrl = (site, id) => `${site.urlBase}/en/sites/${site.siteUrlName || site.site}/job/${id}`;

/** Finder values are `;`/`,` delimited — strip delimiters from free text before encoding. */
const finderValue = (s) => encodeURIComponent(String(s || '').replace(/[;,"]+/g, ' ').replace(/\s+/g, ' ').trim());

/** "PERTH, WESTERN AUSTRALIA, Australia" → "Perth, Western Australia, Australia" (leave short codes like WA/NSW alone). */
function tidyLocation(s) {
  return String(s || '').split(',').map((seg) => {
    const t = seg.trim();
    if (t.length > 3 && t === t.toUpperCase() && /[A-Z]/.test(t)) return t.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
    return t;
  }).filter(Boolean).join(', ');
}

/** All location strings for a requisition (primary first, then secondaries). */
function locationsOf(j) {
  const list = [j.PrimaryLocation, ...(Array.isArray(j.secondaryLocations) ? j.secondaryLocations.map((s) => s?.Name) : [])];
  return [...new Set(list.map((l) => String(l || '').trim()).filter(Boolean))];
}

/** Tokens of a hunt location ("Perth WA" → ["perth", "wa", "western australia"]). Empty for "Remote Australia". */
function locationTokens(location) {
  const out = new Set();
  for (const t of String(location || '').toLowerCase().split(/[\s,/]+/)) {
    if (!t || STOP.has(t)) continue;
    if (AU_STATES[t]) { out.add(t); out.add(AU_STATES[t]); } else if (t.length >= 3) out.add(t);
  }
  return [...out];
}

function tokenMatches(token, locLower) {
  return token.length <= 3 ? new RegExp(`\\b${token}\\b`).test(locLower) : locLower.includes(token);
}

function isDream(site, prefs) {
  if (site.dream === true) return true;
  const comp = String(site.company || '').toLowerCase();
  return (prefs?.dream_companies || []).some((c) => comp.includes(String(c).toLowerCase()));
}

/** Keep the job if it sits in the hunt location, is nationwide/remote, or the company is a dream company (country-wide). */
function keepJob(j, { site, tokens, dream }) {
  const locs = locationsOf(j);
  const country = String(site.country || 'Australia').toLowerCase();
  const inCountry = locs.some((l) => l.toLowerCase().includes(country)) || String(j.PrimaryLocationCountry || '').toUpperCase() === 'AU';
  if (!inCountry) return false;
  if (dream) return true;
  const lower = locs.map((l) => l.toLowerCase());
  const remote = j.WorkplaceTypeCode === 'ORA_REMOTE' || lower.some((l) => /\bremote\b/.test(l));
  if (remote) return true;
  const nationwide = lower.length > 0 && lower.every((l) => l.split(',').map((s) => s.trim()).filter(Boolean).length === 1 && l.includes(country));
  if (nationwide) return true;
  // "Remote Australia" yields no tokens, so only dream/remote/nationwide jobs survive for that hunt location.
  return tokens.length > 0 && lower.some((l) => tokens.some((t) => tokenMatches(t, l)));
}

function workTypeOf(j) {
  if (/\b(graduate|intern(ship)?|vacationer|cadet)\b/i.test(j.Title || '')) return 'Graduate';
  const t = `${j.JobSchedule || ''} ${j.WorkerType || ''} ${j.ContractType || ''} ${j.JobType || ''}`.toLowerCase();
  if (/full/.test(t)) return 'Full time';
  if (/part/.test(t)) return 'Part time';
  if (/contract|fixed|temp|casual/.test(t)) return 'Contract';
  return '';
}

function remoteOf(j) {
  const code = String(j.WorkplaceTypeCode || '');
  if (code === 'ORA_REMOTE') return 'remote';
  if (code === 'ORA_HYBRID') return 'hybrid';
  if (code === 'ORA_ON_SITE') return 'onsite';
  return undefined;
}

/** Geography Id of the site's country (cached per process + 24h on disk). null when the site lists no jobs there. */
async function countryFacetId(site) {
  const key = `${site.host}|${site.site}|${site.country}`;
  if (facetCache.has(key)) return facetCache.get(key);
  let id = null;
  try {
    const u = `${restBase(site)}/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=${site.site},facetsList=LOCATIONS,limit=1,userTargetFacetName=LOCATIONS,userTargetFacetInputTerm=${finderValue(site.country)}`;
    const d = await fetchJson(u, { minGapMs: site.minGapMs || 1200, cacheTtlMs: 24 * 3600 * 1000 });
    const want = String(site.country).toLowerCase();
    const facets = d.items?.[0]?.locationsFacet || [];
    const hit = facets.find((f) => String(f.Name || '').trim().toLowerCase() === want) || facets.find((f) => String(f.Name || '').toLowerCase().includes(want));
    if (hit?.Id != null) id = String(hit.Id);
  } catch (e) {
    process.stderr.write(`  [oracle-orc] ${site.name}: country facet lookup failed (${e.message.slice(0, 80)}) — filtering client-side\n`);
    id = undefined; // unknown → search unfiltered, rely on keepJob()
  }
  facetCache.set(key, id);
  return id;
}

function toJob(j, site) {
  const locs = locationsOf(j).map(tidyLocation);
  return normalizeJob({
    source: name,
    sourceId: `${site.name}:${j.Id}`,
    title: j.Title,
    company: site.company || site.name,
    location: locs.join('; '),
    url: jobUrl(site, j.Id),
    postedAt: j.PostedDate || j.ExternalPostedStartDate,
    workType: workTypeOf(j),
    remote: remoteOf(j),
    summary: j.ShortDescriptionStr || '',
    tags: [j.JobFamily, j.JobFunction, j.Organization, j.Department].filter(Boolean).map(String),
    raw: { host: site.host, site: site.site, siteName: site.name, workplaceType: j.WorkplaceTypeCode || undefined, primaryCountry: j.PrimaryLocationCountry || undefined },
  });
}

// ---------- adapter API ----------
export async function search({ query, location = 'Perth WA', prefs, maxPages = MAX_PAGES, pageSize = PAGE_SIZE }) {
  const sites = await loadSites();
  if (!sites.length) { process.stderr.write('  [oracle-orc] no enabled sites in sources/config/orc-sites.json\n'); return []; }
  const q = String(query || '').trim();
  if (!q) return []; // queryless=false: an empty keyword would return the whole catalogue
  const tokens = locationTokens(location);
  const out = new Map();
  const failures = [];

  for (const site of sites) {
    const dream = isDream(site, prefs);
    try {
      const facetId = await countryFacetId(site);
      if (facetId === null) continue; // site has no jobs in-country right now
      let offset = 0;
      for (let page = 0; page < maxPages; page++) {
        const finder = [`siteNumber=${site.site}`, `limit=${pageSize}`, `offset=${offset}`, 'sortBy=POSTING_DATES_DESC', `keyword=${finderValue(q)}`, facetId ? `selectedLocationsFacet=${facetId}` : ''].filter(Boolean).join(',');
        const u = `${restBase(site)}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;${finder}`;
        const d = await fetchJson(u, { minGapMs: site.minGapMs || 1200, cacheTtlMs: 30 * 60 * 1000 });
        const it = d.items?.[0] || {};
        const list = Array.isArray(it.requisitionList) ? it.requisitionList : [];
        for (const j of list) {
          try {
            if (!j?.Id || !j?.Title) continue;
            if (!keepJob(j, { site, tokens, dream })) continue;
            const job = toJob(j, site);
            if (!out.has(job.id)) out.set(job.id, job);
          } catch { /* skip malformed record */ }
        }
        offset += list.length;
        const total = Number(it.TotalJobsCount || 0);
        if (!list.length || list.length < pageSize || offset >= total) break;
      }
    } catch (e) {
      failures.push(`${site.name}: ${e.message.slice(0, 120)}`);
      process.stderr.write(`  [oracle-orc] ${site.name} failed: ${e.message.slice(0, 120)}\n`);
    }
  }
  if (failures.length && failures.length === sites.length) throw new Error(`all ${sites.length} ORC sites failed — ${failures.join(' | ')}`);
  return [...out.values()];
}

/** Full description (+ responsibilities/qualifications), category tags and posting date for one job. */
export async function details(job) {
  const sites = await loadSites();
  const raw = job.raw || {};
  const idPart = String(job.sourceId || '').split(':').pop() || String(job.url || '').match(/\/job\/([^/?#]+)/)?.[1];
  let site = sites.find((s) => s.host === raw.host && s.site === raw.site) || sites.find((s) => s.name === raw.siteName);
  if (!site) {
    try { const u = new URL(job.url); site = sites.find((s) => u.href.startsWith(s.urlBase) || u.host === s.host); } catch { /* ignore */ }
  }
  if (!site && raw.host && raw.site) site = { host: raw.host, site: raw.site, name: raw.siteName || raw.host };
  if (!site || !idPart) return {};

  const u = `${restBase(site)}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="${encodeURIComponent(idPart)}",siteNumber=${site.site}`;
  const d = await fetchJson(u, { minGapMs: site.minGapMs || 1200, cacheTtlMs: 24 * 3600 * 1000 });
  const j = d.items?.[0];
  if (!j) return { notFound: true }; // REST answered but the requisition no longer exists

  const parts = [];
  if (j.ExternalDescriptionStr) parts.push(stripHtml(j.ExternalDescriptionStr));
  if (j.ExternalResponsibilitiesStr) parts.push(`Responsibilities\n${stripHtml(j.ExternalResponsibilitiesStr)}`);
  if (j.ExternalQualificationsStr) parts.push(`Qualifications\n${stripHtml(j.ExternalQualificationsStr)}`);
  const description = parts.join('\n\n').trim() || undefined;

  const flex = (Array.isArray(j.requisitionFlexFields) ? j.requisitionFlexFields : [])
    .filter((f) => f?.Prompt && f?.Value != null && String(f.Value).trim())
    .map((f) => `${f.Prompt}: ${String(f.Value).trim()}`)
    .filter((t) => t.length <= 80) // drop legal boilerplate flex fields
    .slice(0, 8);
  const skills = (Array.isArray(j.skills) ? j.skills : []).map((s) => (typeof s === 'string' ? s : s?.Skill || s?.Name || s?.SkillName)).filter(Boolean).slice(0, 15);
  const tags = [...new Set([j.Category, j.JobFamily, j.JobFunction, j.Organization, j.Department, ...(job.tags || []), ...flex, ...skills].filter(Boolean).map(String))];

  const out = { description, tags };
  const posted = toIsoDate(j.ExternalPostedStartDate);
  if (posted) out.postedAt = posted;
  const wt = workTypeOf({ ...j, Title: j.Title || job.title });
  if (wt) out.workType = wt;
  const rem = remoteOf(j);
  if (rem) out.remote = rem;
  return out;
}
