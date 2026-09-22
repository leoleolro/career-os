# Career OS — instructions for Claude Code

This folder is a career agent. You (Claude Code) are the reasoning half; the Node scripts are the deterministic half. Read this file first in every session, then `profile/career-context.md`.

## Ground rules
1. **Never invent facts about the candidate.** Every resume bullet, cover-letter claim and interview answer must trace to `profile/`. Ask when something is missing.
2. **Never submit an application, send a message, or accept terms on the candidate's behalf.** `/apply` prepares everything and drives the browser up to the final submit; the candidate clicks. Emails and LinkedIn messages are drafted, never sent.
3. **Tailored files are derived.** Edit `profile/master-resume.md`, then regenerate with `/tailor`. One folder per job under `jobs/<slug>/`.
4. **A plain fetch that says "position has been filled" is usually a decoy** (JS-rendered ATS sites serve a static fallback). Verify in the Browser pane or via the adapter's `details()` before calling a role closed.
5. Free/local tooling only by default. No paid APIs required.
6. **No em dashes (—) or en dashes (–) in anything the candidate will send.** Commas, colons, full stops, "to" for ranges.
7. Respect `profile/career-context.md → Confidentiality` (for example: describe clients by sector, never by name).

## Layout
```
profile/        master-resume.md · preferences.json (search prefs + priority_model) · certifications.md · story-bank.md · career-context.md · achievements.md · study/
sources/        one adapter per job source + config/ (seek, linkedin, phenom, oracle-orc, greenhouse, lever, ashby, gradconnection, mckinsey [browser], wagov [WA Government], apsjobs [browser], adzuna, indeed [browser])
lib/            schema.mjs (Job, normalizeJob, dedupe, closingDate) · http.mjs (polite fetch, cache) · store.mjs · score.mjs (prescore + upside/priority) · insights.mjs · md.mjs
hunt.mjs        sources × queries → data/jobs.json + reports/hunt-<date>.md   (--source, --query, --location, --new-only, --details N, --dry, --top)
tools/          render.mjs (resume.md → PDF/DOCX; --compact for one page; --merge for one-file applications) · dashboard.mjs · track.mjs · details.mjs · rescore.mjs · insights.mjs · shortlist.mjs · recheck.mjs · refresh.sh · setup.mjs · test.mjs
jobs/<slug>/    jd.md · brief.md · resume.md · cover-letter.md · interview-prep.md · research.md · network.md · notes.md · outputs/
data/           jobs.json · pipeline.json · cache/ · secrets.json (optional API keys)
reports/        hunt-<date>.md · shortlist-<date>.md · market-insights-<date>.md · career-path-<date>.md · dashboard.html
inbox/          drop JDs, transcripts, offer letters, question banks here for ingestion
.claude/skills/ the slash commands below
```

## Slash commands
`/hunt` (fetch, rate fit, shortlist by priority) · `/tailor <url|jobs/slug>` (JD → brief + resume + cover letter → PDF/DOCX) · `/interview-prep <slug> [mock]` · `/career-path` · `/network` · `/offer-review` · `/log <what you did>` · `/apply <slug>` (stops before submit) · `/track` · `/weekly` · `/prefs` · `/inbox` (Gmail, draft only) · `/research <company>` · `/decide <question>` (deep career decision: live research, graded sources, kill criteria, decision log) · `/study`

## Concepts
- **Fit** (Strong / Good / Stretch / Skip) = can the candidate get it. Rated by Claude from full descriptions. A "N+ years" line is a preference, not a wall; only 8+ years, principal/staff/manager titles, wrong domain or a true hard gate (citizenship, clearance) make a Skip.
- **Priority** (P1 / P2 / P3) = is it worth the effort. Computed by `lib/score.mjs upside()` from `preferences.json → priority_model`: brand direction vs current employer, interest alignment, pay, contract penalty. Never set by hand; edit the tiers instead.
- **One page** for MBB and graduate programs (`--compact`); two pages for industry roles. No profile paragraph on MBB/graduate CVs.

## Running things
```
npm run setup                               # first run: creates profile/* from examples, runs offline tests
node hunt.mjs --new-only --details 15       # daily fetch
node tools/details.mjs --top 40             # full descriptions before rating
node tools/rescore.mjs && node tools/insights.mjs && node tools/shortlist.mjs && node tools/dashboard.mjs
node tools/render.mjs jobs/<slug> --compact # one-page PDF + DOCX
bash tools/refresh.sh                       # the whole chain (what a scheduler runs)
npm test                                    # unit + live adapter smoke tests
```
Scheduling options are in README.md (local desktop task, launchd, cron, or a cloud routine over a private git repo).
