---
name: hunt
description: Run the job hunt across all sources, rate real fit for every new posting, and shortlist. Use when the candidate says "hunt", "find jobs", "any new jobs", "what's out there", "/hunt", or "hunt review".
---

# /hunt

## 1. Run the fetch (deterministic)
```bash
export PATH="$HOME/.local/lib/node/bin:$PATH"
cd "$CAREER_OS"   # your career-os folder
node hunt.mjs --new-only --details 15 --min-score 40 2>&1 | tail -60
```
Takes ~3–5 minutes (sources run in parallel; each is paced per host). If `tools/daily.sh` already ran today (see data/logs/), skip straight to reading the report. If the candidate said `hunt review`, skip the run and just read today's report.
If a source logs `429`/`blocked`, note it and continue — LinkedIn and Seek can be searched manually with the Browser pane (`https://www.linkedin.com/jobs/search/?keywords=…&location=Perth` / `https://www.seek.com.au/…-jobs/in-Perth-WA`) when the adapter is rate-limited.

## 1b. Browser-only sources (2 minutes)
McKinsey renders only in a real browser (Akamai). Open `https://www.mckinsey.com/careers/search-jobs?countries=Australia` in the Browser pane, `get_page_text`, and compare the Consulting titles against `data/jobs.json` (currently tracked: Business Analyst 15136, Experienced Junior Associate 101796, Associate 15264). Record any new ANZ consulting role with a small node script using `normalizeJob` + `mergeJobs` (see sources/mckinsey.mjs header for field shapes). APSJobs (federal government, Salesforce app): open `https://www.apsjobs.gov.au/s/job-search?keyword=<query>` in the Browser pane and record relevant roles the same way; JobsWA (state) is covered by the `wagov` adapter. Bain and Indeed are the other browser-only checks when the candidate asks.

## 2. Read the report
`reports/hunt-<today>.md` — the "New since last run" section. Also read `profile/preferences.json` (gates) and `profile/master-resume.md` (what the candidate can honestly claim).

## 3. Rate the jobs that matter (you, not the prescore)
Scope — do NOT try to rate hundreds: (a) every job in the report's "New AI / Oracle / consulting roles in your country" section, (b) the top 20 of "Other new postings", (c) any dream-company job. First pull their full descriptions: `node tools/details.mjs --top 40` (fetches for the highest-prescore jobs lacking one; Seek/LinkedIn/BCG/ORC/boards all supported). Then assign:
- **Strong** — the candidate meets the stated requirements; role advances a target path (AI engineer / FDE / AI consultant, Oracle EPM, consulting, data). Apply this week.
- **Good** — apply. One bridgeable gap, including a "3–5+ years" line: **years asked are a preference, not a wall** (the candidate's rule, 2026-09-15; 66 of 121 AU AI ads don't even state one).
- **Stretch** — apply if time allows, and network: 5–7 years asked, or 2+ real gaps, or a dream company above the candidate's level.
- **Skip** — 8+ years, principal/staff/manager titles, wrong domain, or a true hard gate (citizenship/clearance/degree field).
Human factor: rate what the candidate could plausibly *do*, not what the ad's HR template says. Mining-sector, AI-delivery and consulting evidence can outweigh a years line.

**Priority is separate from fit.** `priority` (P1/P2/P3, computed by lib/score.mjs `upside()` from `preferences.json → priority_model`) answers "is it worth the candidate's effort": brand direction vs the current employer (MBB/AI-native = up; Big 4 peers = lateral; Perth MSPs/boutiques = down), interest (AI/FDE/agentic, MBB consulting = high; generic BA/analyst = low), pay vs current package, contract penalty. the candidate already has a stable job — a same-pay, less prestigious, less interesting role is P3 even if it is a Strong fit. When you shortlist, order by priority then rating, and say in one line why a P2/P3 Strong is still (or isn't) worth applying to. If the tiers misclassify a company, edit `company_tiers` rather than overriding by hand.

Hard gates: graduate programs → work rights (the candidate is an Australian citizen — OK) and "graduated within N years" (Dec 2023). Location: Perth preferred; Sydney/Melbourne/Brisbane/Canberra/Adelaide acceptable (the candidate will relocate for the right role); overseas only for dream companies (Anthropic, OpenAI) and only if the posting doesn't require local work rights. Never rate a job Strong on the title alone — read the description (`--details` fetched it into `data/jobs.json`).

## 4. Write ratings back
Update `data/jobs.json`: for each rated job set `rating` ("Strong"|"Good"|"Stretch"|"Skip") and `fit` (one sentence: the reason). Use a short python3/node snippet; keep all other fields.

## 4b. Refresh derived views
`node tools/rescore.mjs && node tools/insights.mjs && node tools/shortlist.mjs && node tools/dashboard.mjs` — insights (reports/market-insights-<today>.md) shows what the market asks for vs the candidate's resume; mention any new gap that crosses 20% of AU AI ads.

## 5. Report to the candidate (compact)
- Sources health (fetched/errors per source, from the report header).
- Top 5 shortlist ordered by priority: `P1` title — company — location — link — rating — one-line why — recommended next action (`/tailor <url>`, "network first", "wait for 2027 intake").
- Anything time-sensitive (closing dates, "posted today").
- Then ask which to `/tailor`. Do not tailor, apply, or contact anyone without being asked.

## Hard stops
- WebFetch of ATS pages (Phenom/BCG, Workday, Oracle ORC) often returns a "position has been filled" decoy. Verify with the Browser pane or the adapter's `details()` before telling the candidate a role is closed.
- Never fabricate a posting. Every link you give must come from the report or a page you opened.
