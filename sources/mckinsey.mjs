// McKinsey & Company careers (mckinsey.com/careers/search-jobs) — server-rendered HTML, no API key.
// Behind Akamai Bot Manager: plain HTTP (curl/Node) gets a 200 app shell with no cards; only a real browser renders the list.
// Verified in a real browser 2026-09-15: search page lists cards (function eyebrow, <h2><a href="/careers/search-jobs/jobs/<slug>-<id>">, description, <li> cities);
// job pages carry "Job ID: <n>", a city list, and the full text. NOTE: mckinsey.com sits behind Akamai and rejects the Claude Code sandbox's
// network path (HTTP/2 INTERNAL_ERROR) — this adapter works from a normal shell (tools/daily.sh) but returns [] with a warning inside the sandbox.
import { fetchText } from '../lib/http.mjs';
import { normalizeJob, stripHtml } from '../lib/schema.mjs';

export const name = 'mckinsey';
export const description = 'McKinsey careers search (HTML, Australia filter)';
export const queryless = true; // one page lists every AU role; title filtering happens via prefs.target_roles in hunt scoring

const BASE = 'https://www.mckinsey.com';
const AU = /perth|sydney|melbourne|brisbane|canberra|auckland/i;

export async function search({ prefs }) {
  let html;
  try {
    const r = await fetchText(`${BASE}/careers/search-jobs?countries=Australia`, { minGapMs: 2000, retries: 1, cacheTtlMs: 6 * 3600 * 1000, headers: { accept: 'text/html' } });
    if (r.status !== 200 || !r.text) throw new Error(`HTTP ${r.status}`);
    html = r.text;
  } catch (e) {
    process.stderr.write(`[mckinsey] unreachable from this network (${e.message.slice(0, 60)}) — works outside the sandbox; the three ANZ consulting roles are tracked in data/jobs.json\n`);
    return [];
  }
  const out = [];
  const cards = html.split(/JobsList_mck-c-jobs-list__jobs/).slice(1);
  if (!cards.length) {
    process.stderr.write('[mckinsey] Akamai served the app shell (no job cards) — McKinsey only renders for a real browser. Check https://www.mckinsey.com/careers/search-jobs?countries=Australia in the Browser pane (see /hunt step 1b); the 3 ANZ consulting roles are tracked in data/jobs.json.\n');
    return [];
  }
  for (const c of cards) {
    try {
      const href = (c.match(/href="(\/careers\/search-jobs\/jobs\/[^"]+)"/) || [])[1];
      const title = stripHtml((c.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '');
      const fn = stripHtml((c.match(/mck-c-eyebrow[^>]*><span>([\s\S]*?)<\/span>/) || [])[1] || '');
      const desc = stripHtml((c.match(/mck-c-generic-item__description[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '');
      const cities = [...c.matchAll(/<li(?![^>]*show-more)[^>]*>([^<]{2,40})<\/li>/g)].map((m) => m[1].trim());
      if (!href || !title) continue;
      const id = (href.match(/-(\d+)$/) || [])[1] || '';
      const auCities = cities.filter((x) => AU.test(x));
      out.push(normalizeJob({
        source: name, sourceId: id, title, company: 'McKinsey & Company',
        location: (auCities.length ? auCities : ['Australia']).join('; ') + (cities.length > auCities.length ? ' (+ other offices)' : ''),
        url: BASE + href, applyUrl: BASE + href, summary: desc, tags: [fn].filter(Boolean), workType: 'Full time',
      }));
    } catch { /* skip card */ }
  }
  return out;
}

export async function details(job) {
  const r = await fetchText(job.url, { minGapMs: 2000, retries: 1, cacheTtlMs: 24 * 3600 * 1000, headers: { accept: 'text/html' } });
  if (r.status !== 200) return {};
  const main = (r.text.match(/<main[\s\S]*?<\/main>/) || [r.text])[0];
  const text = stripHtml(main);
  const cities = [...main.matchAll(/<li[^>]*>([^<]{2,40})<\/li>/g)].map((m) => m[1].trim()).filter((x) => AU.test(x));
  return { description: text.slice(0, 12000), location: cities.length ? cities.join('; ') : undefined };
}
