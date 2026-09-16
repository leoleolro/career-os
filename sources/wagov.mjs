// JobsWA (search.jobs.wa.gov.au) — Western Australian Government vacancies. Server-rendered HTML, no key.
// Verified 2026-09-17: GET https://search.jobs.wa.gov.au/jobs/search?keywords=<q>&page=<n> → 20 <article class="... job-search-results-card-col"> per page;
// each card has aria-labelled fields (Department, Employment type, Level, Salary range, Location Description, Occupation). Job page has "Closing at: <date>".
import { fetchText } from '../lib/http.mjs';
import { normalizeJob, stripHtml } from '../lib/schema.mjs';

export const name = 'wagov';
export const description = 'WA Government jobs board (JobsWA)';

const field = (card, label) => { const m = card.match(new RegExp(`aria-label="${label}"[^>]*></i>\\s*<span[^>]*>\\s*([^<]*?)\\s*</span>`, 'i')); return m ? stripHtml(m[1]) : ''; };

export async function search({ query, maxPages = 2 }) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = `https://search.jobs.wa.gov.au/jobs/search?keywords=${encodeURIComponent(query)}&page=${page}`;
    const r = await fetchText(u, { minGapMs: 1500, retries: 1, cacheTtlMs: 30 * 60 * 1000, headers: { accept: 'text/html' } });
    if (r.status !== 200) break;
    const cards = r.text.match(/<article class="col-12 job-search-results-card-col"[\s\S]*?<\/article>/g) || [];
    for (const c of cards) {
      try {
        const m = c.match(/<h3[^>]*job-search-results-card-title[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!m) continue;
        const [, url, rawTitle] = m; const title = stripHtml(rawTitle);
        const dept = field(c, 'Department'); const type = field(c, 'Employment type'); const level = field(c, 'Level'); const salary = field(c, 'Salary range'); const loc = field(c, 'Location Description'); const occ = field(c, 'Occupation'); const branch = field(c, 'Branch');
        out.push(normalizeJob({
          source: name, sourceId: url.split('/jobs/')[1] || '', title, company: dept || 'WA Government', location: loc ? `${loc}, WA` : 'Western Australia', url,
          salary: salary || undefined, workType: type || undefined, summary: [level, branch, occ].filter(Boolean).join(' | '), tags: [occ, level, 'government'].filter(Boolean),
        }));
      } catch { /* skip card */ }
    }
    if (cards.length < 20) break;
  }
  return out;
}

export async function details(job) {
  const r = await fetchText(job.url, { minGapMs: 1500, retries: 1, cacheTtlMs: 24 * 3600 * 1000, headers: { accept: 'text/html' } });
  if (r.status === 404) return { notFound: true };
  if (r.status !== 200) throw new Error(`wagov details HTTP ${r.status}`);
  const text = stripHtml(r.text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''));
  const closing = text.match(/Closing at:\s*([A-Z][a-z]{2} \d{1,2} \d{4})/);
  let closesAt; if (closing) { const d = Date.parse(closing[1] + ' UTC'); if (!isNaN(d)) closesAt = new Date(d).toISOString().slice(0, 10); }
  const start = text.search(/Apply Now|Job Description|About the role|Position Profile|Job description/i);
  const description = (start > 0 ? text.slice(start) : text).slice(0, 12000);
  return { description, closesAt };
}
