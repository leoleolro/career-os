// Seek (seek.com.au) — uses the public JSON search API the Seek front-end itself calls. No auth.
// Verified 2026-09-12: GET https://www.seek.com.au/api/jobsearch/v5/search?siteKey=AU-Main&where=Perth+WA&keywords=...&page=1&pageSize=100&sortmode=ListedDate
import { fetchJson } from '../lib/http.mjs';
import { normalizeJob } from '../lib/schema.mjs';

export const name = 'seek';
export const description = 'Seek Australia job search API (public, no key)';

export async function search({ query, location = 'Perth WA', maxPages = 2, pageSize = 100 }) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = new URL('https://www.seek.com.au/api/jobsearch/v5/search');
    u.searchParams.set('siteKey', 'AU-Main');
    u.searchParams.set('where', location);
    u.searchParams.set('keywords', query);
    u.searchParams.set('page', String(page));
    u.searchParams.set('pageSize', String(pageSize));
    u.searchParams.set('sortmode', 'ListedDate');
    u.searchParams.set('locale', 'en-AU');
    const d = await fetchJson(u.toString(), { minGapMs: 1500, cacheTtlMs: 30 * 60 * 1000 });
    const items = d.data || [];
    for (const j of items) {
      try {
        out.push(normalizeJob({
          source: name,
          sourceId: String(j.id),
          title: j.title,
          company: j.advertiser?.description || j.companyName || '',
          location: (j.locations || []).map((l) => l.label).join('; ') || j.jobLocation?.label || '',
          url: `https://www.seek.com.au/job/${j.id}`,
          postedAt: j.listingDate,
          salary: j.salaryLabel || undefined,
          workType: (j.workTypes || []).join(', '),
          remote: (j.workArrangements?.data || []).map((w) => (w.label?.text || w.label || '')).join(' ').toLowerCase().includes('remote') ? 'remote' : undefined,
          summary: [j.teaser, ...(j.bulletPoints || [])].filter(Boolean).join(' • '),
          tags: (j.classifications || []).flatMap((c) => [c.classification?.description, c.subclassification?.description]).filter(Boolean),
        }));
      } catch (e) { /* skip malformed */ }
    }
    if (items.length < pageSize || (d.totalCount && page * pageSize >= d.totalCount)) break;
  }
  return out;
}

/** Full description via Seek's GraphQL (the job HTML page is Cloudflare-challenged; this endpoint is not). Verified 2026-09-15. */
export async function details(job) {
  const { fetchText } = await import('../lib/http.mjs');
  const id = job.sourceId || (job.url.match(/\/job\/(\d+)/) || [])[1];
  if (!id) return {};
  const body = JSON.stringify({
    operationName: 'jobDetails',
    variables: { jobId: String(id), locale: 'en-AU' },
    query: 'query jobDetails($jobId: ID!, $locale: Locale!) { jobDetails(id: $jobId) { job { id title content(platform: WEB) advertiser { name } location { label(locale: $locale, type: LONG) } salary { label } workTypes { label(locale: $locale) } listedAt { dateTimeUtc } } } }',
  });
  const r = await fetchText('https://www.seek.com.au/graphql', {
    method: 'POST', body, minGapMs: 1200,
    headers: { 'content-type': 'application/json', origin: 'https://www.seek.com.au', referer: job.url },
  });
  if (r.status !== 200) throw new Error(`seek graphql HTTP ${r.status}`);
  let j; try { j = JSON.parse(r.text)?.data?.jobDetails?.job; } catch { throw new Error('seek graphql: non-JSON'); }
  if (j === null) return { notFound: true }; // GraphQL answers 200 with job:null for expired/removed ads
  if (!j?.content) return {};
  return { description: j.content, salary: j.salary?.label || undefined, workType: (Array.isArray(j.workTypes) ? j.workTypes.map((w) => w.label) : [j.workTypes?.label]).filter(Boolean).join(', ') || undefined, location: j.location?.label || undefined };
}
