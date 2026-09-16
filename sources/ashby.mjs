// Ashby Job Posting API — public, no key. Fetches each configured company board ONCE (whole board, descriptions and
// compensation included) and filters locally by title (target roles) and location (Australia / remote / APAC unless `anyLocation`).
// Verified 2026-09-12:
//   list : GET https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
//          → { apiVersion, jobs: [{ id (uuid), title, department, team, employmentType (FullTime|Contract|Intern),
//               location, secondaryLocations[{location}], address:{postalAddress:{addressLocality, addressRegion, addressCountry}},
//               isRemote, workplaceType (Remote|Hybrid|OnSite|null), isListed, publishedAt (ISO), jobUrl, applyUrl,
//               descriptionHtml, descriptionPlain, compensation:{ compensationTierSummary, scrapeableCompensationSalarySummary } }] }
//   No per-job endpoint in the public posting API — details() re-reads the (cached) board and picks the id.
//   Unknown board → 404 "Not Found"; a board with no public postings answers 200 {jobs:[]} (e.g. "vercel").
//   Slugs can contain a dot ("mistral.ai"). Big boards are ~14 MB (OpenAI 795 jobs).
// Boards live in sources/config/ats-companies.json (see its _comment). Responses are cached 30 min by lib/http.mjs.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchJson } from '../lib/http.mjs';
import { normalizeJob } from '../lib/schema.mjs';

export const name = 'ashby';
export const description = 'Ashby job boards (OpenAI, Cohere, Xero, Airwallex, Mistral, ...) via api.ashbyhq.com/posting-api; boards in sources/config/ats-companies.json';
export const queryless = true;

const CONFIG_PATH = fileURLToPath(new URL('./config/ats-companies.json', import.meta.url));
const PREFS_PATH = fileURLToPath(new URL('../profile/preferences.json', import.meta.url));
const API = 'https://api.ashbyhq.com/posting-api/job-board/';
const MAX_DESC = 20000;

// ---------- config + filters (kept in-file so the adapter stays self-contained) ----------
const DEFAULT_TITLE_WORDS = ['engineer', 'consultant', 'analyst', 'scientist', 'solutions', 'forward deployed', 'developer', 'ai', 'llm', 'genai', 'agentic', 'machine learning', 'graduate'];
const DEFAULT_AU = ['australia', 'aus', 'au', 'perth', 'sydney', 'melbourne', 'brisbane', 'adelaide', 'canberra', 'nsw', 'vic', 'wa', 'qld', 'apac', 'anz'];
const DEFAULT_REMOTE_NOISE = ['remote', 'friendly', 'travel', 'required', 'anywhere', 'worldwide', 'global', 'fully', 'hybrid', 'or', 'from', 'in', 'the', 'work', 'home', 'wfh'];
const DEFAULT_REJECT = ['united states', 'usa', 'us', 'united kingdom', 'uk', 'gb', 'london', 'canada', 'europe', 'eu', 'emea', 'india', 'japan', 'singapore', 'new york', 'san francisco', 'seattle', 'washington'];
const REMOTE_RE = /remote|anywhere|work from home|wfh/i;

let configPromise;
async function loadConfig() {
  if (!configPromise) {
    configPromise = (async () => {
      const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
      const boards = (cfg[name] || []).filter((b) => b && b.board && b.enabled !== false);
      return { boards, filters: cfg.filters || {} };
    })();
  }
  return configPromise;
}

async function loadPrefs(prefs) {
  if (prefs) return prefs;
  try { return JSON.parse(await readFile(PREFS_PATH, 'utf8')); } catch { return {}; }
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word/phrase alternation; lookarounds instead of \b so entries like "u.s." or "head," work. */
function wordsRe(list) {
  const items = [...new Set(list.map((w) => String(w || '').toLowerCase().trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  return items.length ? new RegExp(`(?<![a-z0-9])(?:${items.map(esc).join('|')})(?![a-z0-9])`, 'i') : /$^/;
}

/** Title filter derived from prefs.target_roles (whole phrase or head noun) + config title_words, minus senior/exec titles. */
function buildTitleFilter(prefs, filters) {
  const roles = (prefs.target_roles || []).map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  const heads = roles.map((r) => r.split(/\s+/).pop()).filter((w) => w && w.length > 2);
  const keepRe = wordsRe([...roles, ...heads, ...(filters.title_words || DEFAULT_TITLE_WORDS)]);
  const hard = wordsRe(prefs.hard_exclude_titles || []);
  const drop = filters.drop_senior_titles === false ? /$^/ : wordsRe([...(prefs.keywords_penalty || []), ...(filters.drop_title_words || [])]);
  return (title) => keepRe.test(title) && !hard.test(title) && !drop.test(title);
}

/**
 * Location filter over the posting's location parts (one per office). A part passes when it names no rejected place AND
 * either mentions Australia/APAC, or is "bare remote" — remote/anywhere with no other place name once noise words are removed
 * ("Remote", "Remote-Friendly (Travel-Required)", "Remote - Anywhere" pass; "Remote - California", "Remote in the US" do not).
 */
function buildLocationFilter(filters) {
  const loc = filters.location || {};
  const au = wordsRe(loc.au || DEFAULT_AU);
  const reject = wordsRe(loc.reject || DEFAULT_REJECT);
  const auG = new RegExp(au.source, 'gi');
  const noise = new Set((loc.remote_noise || DEFAULT_REMOTE_NOISE).map((w) => String(w).toLowerCase()));
  const bareRemote = (p) => REMOTE_RE.test(p) && p.toLowerCase().replace(auG, ' ').split(/[^a-z]+/).filter((w) => w && !noise.has(w)).length === 0;
  return (parts) => parts.some((p) => p && !reject.test(p) && (au.test(p) || bareRemote(p)));
}

/** hunt.mjs collapses same company+title postings and keeps the FIRST seen — so emit Perth, then other AU/remote, then the rest. */
function localRank(parts, locationOk) {
  if (/perth|western australia/i.test(parts.join(' '))) return 2;
  return locationOk(parts) ? 1 : 0;
}

const WORKPLACE = { remote: 'remote', hybrid: 'hybrid', onsite: 'onsite' };
const EMPLOYMENT = { fulltime: 'Full time', parttime: 'Part time', contract: 'Contract', intern: 'Internship', temporary: 'Temporary' };

async function fetchBoard(slug, cacheTtlMs = 30 * 60 * 1000) {
  const d = await fetchJson(`${API}${encodeURIComponent(slug)}?includeCompensation=true`, { minGapMs: 1000, cacheTtlMs, timeoutMs: 45000 });
  return Array.isArray(d?.jobs) ? d.jobs : [];
}

function locationParts(j) {
  const country = String(j.address?.postalAddress?.addressCountry || '').trim();
  const primary = String(j.location || '').trim();
  const secondaries = (j.secondaryLocations || []).map((s) => String(s?.location || '').trim()).filter(Boolean);
  const mention = (p) => (country && !p.toLowerCase().includes(country.toLowerCase()) ? `${p}, ${country}` : p);
  const remote = j.isRemote === true || String(j.workplaceType).toLowerCase() === 'remote';
  const display = [primary, ...secondaries].filter(Boolean);
  // a remote posting is still tied to its listed places ("Middle East" + isRemote), so tag each part rather than adding a bare "Remote"
  const filter = display.map((p) => `${mention(p)}${remote ? ' (Remote)' : ''}`);
  if (!filter.length && remote) filter.push(country ? `Remote, ${country}` : 'Remote');
  return { display: display.join('; ') || (remote ? (country ? `Remote, ${country}` : 'Remote') : country), filter, country };
}

function toJob(j, board) {
  const loc = locationParts(j);
  const comp = j.compensation || {};
  const wp = String(j.workplaceType || '').toLowerCase();
  return normalizeJob({
    source: name,
    sourceId: `${board.board}/${j.id}`,
    title: j.title,
    company: board.company || board.board,
    location: loc.display,
    url: j.jobUrl || `https://jobs.ashbyhq.com/${board.board}/${j.id}`,
    applyUrl: j.applyUrl || undefined,
    postedAt: j.publishedAt,
    salary: comp.compensationTierSummary || comp.scrapeableCompensationSalarySummary || undefined,
    workType: EMPLOYMENT[String(j.employmentType || '').toLowerCase()] || j.employmentType || undefined,
    remote: WORKPLACE[wp] || (j.isRemote ? 'remote' : undefined),
    description: j.descriptionPlain ? String(j.descriptionPlain).slice(0, MAX_DESC) : (j.descriptionHtml ? String(j.descriptionHtml).slice(0, MAX_DESC) : undefined),
    tags: [j.department, j.team].filter(Boolean),
    raw: { board: board.board, id: j.id, department: j.department, team: j.team, employmentType: j.employmentType, workplaceType: j.workplaceType, isRemote: j.isRemote, country: loc.country, publishedAt: j.publishedAt },
  });
}

/**
 * search({prefs}) → Job[] across every configured Ashby board. `query`/`location` are ignored (queryless).
 * A board that fails logs one stderr line and is skipped; throws only if every board failed.
 */
export async function search({ prefs } = {}) {
  const { boards, filters } = await loadConfig();
  if (!boards.length) { console.error(`[${name}] no boards configured in sources/config/ats-companies.json`); return []; }
  const p = await loadPrefs(prefs);
  const titleOk = buildTitleFilter(p, filters);
  const locationOk = buildLocationFilter(filters);
  const out = []; // [{ rank, job }]
  const summary = [];
  let failed = 0, lastErr;
  for (const board of boards) {
    let jobs;
    try {
      jobs = await fetchBoard(board.board);
    } catch (e) {
      failed++; lastErr = e;
      console.error(`[${name}] ${board.board}: ${String(e.message).slice(0, 140)}`);
      continue;
    }
    let kept = 0;
    for (const j of jobs) {
      try {
        if (!j?.title || j.isListed === false || !titleOk(j.title)) continue;
        const rank = localRank(locationParts(j).filter, locationOk);
        if (!board.anyLocation && rank === 0) continue;
        // anyLocation boards (Anthropic, OpenAI) are huge: keep only client-facing / deployment / graduate roles unless the role is in AU/remote
        if (board.anyLocation && rank === 0 && filters.anyLocation_title_re && !new RegExp(filters.anyLocation_title_re, 'i').test(j.title || j.text || '')) continue;
        out.push({ rank, job: toJob(j, board) });
        kept++;
      } catch { /* skip malformed record */ }
    }
    summary.push(`${board.board} ${jobs.length}→${kept}`);
  }
  if (failed && failed === boards.length) throw new Error(`all ${boards.length} Ashby boards failed: ${lastErr?.message}`);
  if (summary.length) console.error(`[${name}] ${summary.join(', ')}`);
  return out.sort((a, b) => b.rank - a.rank).map((x) => x.job);
}

/** Full description for one posting: re-read the (cached) board and pick the id (no per-job public endpoint). */
export async function details(job) {
  const m = String(job.sourceId || '').match(/^(.+)\/([0-9a-f-]{20,})$/i);
  if (!m) return {};
  const { boards } = await loadConfig();
  const board = boards.find((b) => b.board === m[1]) || { board: m[1] };
  const j = (await fetchBoard(m[1])).find((x) => x.id === m[2]);
  if (!j) return {};
  const full = toJob(j, board);
  return { description: full.description, tags: full.tags, salary: full.salary || job.salary, workType: full.workType || job.workType };
}
