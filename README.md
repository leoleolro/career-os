# Career OS

A job-hunting agent that runs inside [Claude Code](https://claude.com/claude-code). It finds openings across 11 sources every day, rates each one for fit and for whether it's worth your effort, keeps your master resume as the single source of truth, tailors one-page or two-page resumes and cover letters to PDF/DOCX, builds interview packs, and shows everything on a local dashboard. Free and local: no paid APIs, no hosting.

Built by [Leo Long](https://github.com/leoleolro) while running his own search. Australian defaults (Seek, LinkedIn AU, WA/AU boards); the geography is configurable.

## What it does
| Layer | What |
|---|---|
| **Hunt** | Seek's JSON API, LinkedIn's guest endpoint, BCG (Phenom), Oracle Recruiting Cloud tenants, Greenhouse/Lever/Ashby boards (Anthropic, OpenAI, Atlassian…), GradConnection, McKinsey (browser check), Adzuna (free key), Indeed (browser only). Polite per-host pacing, on-disk cache, parallel sources, dedupe across sources with company aliasing. |
| **Score** | `prescore` (title match, keywords, location, freshness, years asked) orders the queue. Claude then rates **fit**. `upside()` computes **priority** from your own tiers: brand direction vs your current employer, interest, pay. |
| **Tailor** | `profile/master-resume.md` → job-specific `resume.md` + `cover-letter.md` → PDF (headless Chrome) + DOCX. `--compact` for one page; `--merge` to append a transcript for one-file applications. Hard rule: no em dashes. |
| **Prepare** | `brief.md` per job (verdict, suits-you, positioning, trajectory, company, process, risks), interview packs with predicted questions and STAR answers from your story bank, company research, networking drafts (never sent). |
| **Track** | Pipeline CLI (shortlisted → applied → screening → interview → offer → closed), follow-ups, closing dates, "still open?" rechecks that never close a job on a network failure. |
| **See** | `reports/dashboard.html`: overview tiles, kanban, filterable jobs table, market-insight charts (skills demanded vs your resume), rendered reports, job packs, profile. |

## Install
Requires Node 22+ and, for PDFs, Google Chrome. Python 3 with `pypdf` is used for PDF checks and merging.
```bash
git clone https://github.com/leoleolro/career-os.git && cd career-os
npm install            # only dependency: docx (DOCX output)
npm run setup          # creates profile/*.json|md from the examples and runs the offline tests
```
Then edit `profile/preferences.json` (what to search, where, your tiers) and `profile/master-resume.md` (everything true about you). Open the folder in Claude Code and type `/hunt`.

## Daily use
```bash
bash tools/refresh.sh                # hunt → descriptions → rescore → insights → shortlist → dashboard
open reports/dashboard.html
```
In Claude Code: `/hunt review` rates the new roles; `/tailor <job url>` builds a pack; `/interview-prep jobs/<slug> mock` runs a mock interview.

## Scheduling
- **Claude desktop app:** create a scheduled task that runs `bash tools/refresh.sh` then rates the new roles (needs the app open).
- **launchd / cron:** run `tools/refresh.sh`. On macOS, folders under `~/Desktop` need a Files-and-Folders grant for background agents.
- **Cloud routine (Claude Code):** keep your copy in a *private* git repo; the routine clones, runs `tools/refresh.sh`, commits `data/` and `reports/` back. Note: cloud environments may need job-site hosts added to their network allowlist.

## Adding a source
Copy `sources/seek.mjs`. Export `name`, `description`, optional `queryless`, `search({query, location, prefs})` returning `normalizeJob(...)` records, and optional `details(job)`. Drop it in `sources/` and add its name to the optional list in `sources/index.mjs`. Test: `node hunt.mjs --dry --source <name> --query "AI" --location "Perth WA"`.

## Privacy
Your profile, jobs, reports and data are git-ignored here. Keep your real copy in a private repository. The skills never send, submit or accept anything on your behalf.

## License
MIT
