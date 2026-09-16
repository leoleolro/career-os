// LinkedIn — public "guest" job search endpoint (no login, returns HTML cards). Rate-limit gently.
// Verified 2026-09-12: GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=..&location=..&start=0
// Note: LinkedIn may return 429 under heavy use; http.mjs backs off. Keep maxPages small.
import { fetchText } from '../lib/http.mjs';
import { normalizeJob, stripHtml } from '../lib/schema.mjs';

export const name = 'linkedin';
export const description = 'LinkedIn guest job search (public HTML endpoint, no login)';

const pick = (s, re) => { const m = s.match(re); return m ? stripHtml(m[1]).trim() : ''; };

export async function search({ query, location = 'Perth, Western Australia, Australia', maxPages = 2, sinceDays = 30 }) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const u = new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
    u.searchParams.set('keywords', query);
    u.searchParams.set('location', location);
    u.searchParams.set('start', String(page * 25));
    if (sinceDays) u.searchParams.set('f_TPR', `r${sinceDays * 86400}`);
    const r = await fetchText(u.toString(), { minGapMs: 2500, retries: 2, cacheTtlMs: 30 * 60 * 1000 });
    if (r.status !== 200 || !r.text.trim()) break;
    const cards = r.text.split(/<li>\s*(?=<div class="base-card)/).slice(1);
    if (!cards.length) break;
    for (const c of cards) {
      const url = pick(c, /href="(https:\/\/[a-z.]*linkedin\.com\/jobs\/view\/[^"]+)"/i).replace(/&amp;/g, '&');
      const title = pick(c, /class="base-search-card__title">([\s\S]*?)<\/h3>/i);
      const company = pick(c, /class="base-search-card__subtitle">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) || pick(c, /class="base-search-card__subtitle">([\s\S]*?)<\/h4>/i);
      const loc = pick(c, /class="job-search-card__location">([\s\S]*?)<\/span>/i);
      const posted = pick(c, /datetime="([^"]+)"/i);
      const idm = url.match(/-(\d{6,})\?|\/view\/(\d{6,})/);
      if (!url || !title) continue;
      try {
        out.push(normalizeJob({
          source: name, sourceId: idm ? (idm[1] || idm[2]) : '', title, company, location: loc,
          url: url.split('?')[0], postedAt: posted, summary: '',
        }));
      } catch { /* skip */ }
    }
    if (cards.length < 25) break;
  }
  return out;
}

/** Full posting text via guest endpoint. */
export async function details(job) {
  if (!job.sourceId) return {};
  const r = await fetchText(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${job.sourceId}`, { minGapMs: 2500, retries: 2, cacheTtlMs: 24 * 3600 * 1000 });
  if (r.status !== 200) return {};
  const desc = pick(r.text, /class="show-more-less-html__markup[^"]*">([\s\S]*?)<\/div>/i);
  const crit = [...r.text.matchAll(/description__job-criteria-subheader">([\s\S]*?)<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => `${stripHtml(m[1])}: ${stripHtml(m[2])}`);
  return { description: desc, tags: crit };
}
