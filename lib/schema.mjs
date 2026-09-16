// Canonical Job record. Every source adapter must return objects in this shape via normalizeJob().
// Keep this file dependency-free — it is imported by adapters, hunt.mjs, tools and skills.
import { createHash } from 'node:crypto';

/**
 * @typedef {Object} Job
 * @property {string} id            stable id: `${source}:${sourceId}` — or sha1 of url when no sourceId
 * @property {string} source        adapter name (seek, linkedin, phenom-bcg, workday, greenhouse, ...)
 * @property {string} sourceId      id inside the source system (may be '')
 * @property {string} title
 * @property {string} company
 * @property {string} location      free text, e.g. "Perth WA" / "Perth, Western Australia, Australia" / "Remote - Australia"
 * @property {string} url           canonical URL a human can open and apply from
 * @property {string} [applyUrl]    direct apply link if different from url
 * @property {string} [postedAt]    ISO date (YYYY-MM-DD or full ISO) if known
 * @property {string} [salary]      free text if the source gives it
 * @property {string} [workType]    "Full time" | "Part time" | "Contract" | "Graduate" | ""
 * @property {string} [remote]      "remote" | "hybrid" | "onsite" | ""
 * @property {string} [summary]     teaser / first ~500 chars of description
 * @property {string} [description] full plain-text description when the adapter fetched it
 * @property {string[]} [tags]      any classifications/categories from the source
 * @property {Record<string, any>} [raw] optional small extract of source data for debugging (keep < 2KB)
 */

export function sha1(s) {
  return createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
}

export function stripHtml(html = '') {
  return String(html)
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function canonicalUrl(url = '') {
  try {
    const u = new URL(url);
    // drop tracking params
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|ref|refId|trackingId|position|pageNum|source|src|tracking|_ga|gclid|fbclid)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/** Build a normalized Job. Throws if required fields are missing. */
export function normalizeJob(partial) {
  const source = String(partial.source || '').trim();
  const title = String(partial.title || '').replace(/\s+/g, ' ').trim();
  const company = String(partial.company || '').replace(/\s+/g, ' ').trim();
  const url = canonicalUrl(String(partial.url || '').trim());
  if (!source) throw new Error('normalizeJob: source required');
  if (!title) throw new Error(`normalizeJob(${source}): title required`);
  if (!url) throw new Error(`normalizeJob(${source}): url required for "${title}"`);
  const sourceId = String(partial.sourceId ?? '').trim();
  const id = sourceId ? `${source}:${sourceId}` : `${source}:${sha1(url)}`;
  const postedAt = partial.postedAt ? toIsoDate(partial.postedAt) : undefined;
  const description = partial.description ? stripHtml(partial.description) : undefined;
  const summary = (partial.summary ? stripHtml(partial.summary) : description ? description.slice(0, 500) : '').trim();
  return {
    id,
    source,
    sourceId,
    title,
    company: company || '(unknown company)',
    location: String(partial.location || '').replace(/\s+/g, ' ').trim(),
    url,
    applyUrl: partial.applyUrl ? canonicalUrl(String(partial.applyUrl)) : undefined,
    postedAt,
    salary: partial.salary ? String(partial.salary).trim() : undefined,
    workType: partial.workType ? String(partial.workType).trim() : undefined,
    remote: partial.remote || inferRemote(`${title} ${partial.location || ''} ${summary}`),
    summary,
    description,
    tags: Array.isArray(partial.tags) ? partial.tags.filter(Boolean).map(String) : [],
    raw: partial.raw,
  };
}

export function toIsoDate(d) {
  if (!d) return undefined;
  if (d instanceof Date) return isNaN(d) ? undefined : d.toISOString().slice(0, 10);
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{10,13}$/.test(s)) return new Date(Number(s.length === 10 ? s * 1000 : s)).toISOString().slice(0, 10);
  const t = Date.parse(s);
  return isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

export function inferRemote(text = '') {
  const t = text.toLowerCase();
  if (/\bremote\b/.test(t) && !/not remote|no remote/.test(t)) return 'remote';
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  return '';
}

/** Key used to collapse the same posting seen across sources (title + company, with acronym aliasing + city). */
const COMPANY_ALIASES = { 'boston consulting group': 'bcg', 'bcg x': 'bcg', 'amazon web services': 'aws', 'tata consultancy services': 'tcs', 'commonwealth bank of australia': 'cba', 'commonwealth bank': 'cba', 'national australia bank': 'nab', 'pricewaterhousecoopers': 'pwc', 'ernst & young': 'ey', 'ernst young': 'ey' };
export function normalizeCompany(c) {
  const raw = String(c || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9&]+/g, ' ').trim();
  if (COMPANY_ALIASES[raw]) return COMPANY_ALIASES[raw];
  const words = raw.split(' ').filter(Boolean);
  if (words.length >= 3) { const acr = words.map((w) => w[0]).join(''); if (Object.values(COMPANY_ALIASES).includes(acr)) return acr; }
  return raw.replace(/\b(pty|ltd|limited|inc|llc|plc|australia|group|corporation|corp|co)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
export function dedupeKey(job) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const city = (String(job.location || '').match(/perth|sydney|melbourne|brisbane|canberra|adelaide|hobart|darwin|remote/i) || [''])[0].toLowerCase();
  return `${normalizeCompany(job.company)}|${norm(job.title)}|${city}`;
}

/** Best-effort "applications close" date from posting text → YYYY-MM-DD or undefined. */
export function closingDate(text = '') {
  const t = String(text).replace(/\s+/g, ' ');
  const m = t.match(/(?:applications?\s+(?:close|closing|must be (?:submitted|received))|closing date|closes?\s+(?:on|at)?|apply by|deadline)[^.\n]{0,40}?(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i);
  if (!m) return undefined;
  const raw = m[1].replace(/(\d)(st|nd|rd|th)/gi, '$1').replace(/,/g, '');
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const dmy = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (dmy) { const y = dmy[3].length === 2 ? '20' + dmy[3] : dmy[3]; return `${y}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`; }
  const dMonY = raw.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/i);
  const monDY = raw.match(/^([a-z]+)\.?\s+(\d{1,2})\s+(\d{4})$/i);
  const parts = dMonY ? [dMonY[3], dMonY[2], dMonY[1]] : monDY ? [monDY[3], monDY[1], monDY[2]] : null;
  if (!parts) return undefined;
  const mo = MON[parts[1].toLowerCase().slice(0, 4)] || MON[parts[1].toLowerCase().slice(0, 3)];
  return mo ? `${parts[0]}-${String(mo).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}` : undefined;
}
