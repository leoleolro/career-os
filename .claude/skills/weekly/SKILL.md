---
name: weekly
description: Weekly career review — hunt stats, pipeline movement, follow-ups due, learning progress, next week's 3 actions. Use when the candidate says "weekly", "review my week", "what's the plan", or on a Sunday/Monday check-in. "/weekly".
---

# /weekly

1. Run a fresh hunt if the last run is > 2 days old (`zsh tools/daily.sh` does hunt → details → rescore → insights → dashboard), then `node tools/track.mjs due`.
2. Read: this week's `reports/hunt-*.md`, `data/pipeline.json` (history entries this week), `profile/achievements.md` (new lines), `profile/certifications.md` (exam dates), `profile/career-context.md`.
3. Write `reports/weekly-<today>.md` (one page):
   - **Pipeline movement** — what changed, what's stuck > 14 days, follow-ups overdue.
   - **Market this week** — new Strong/Good jobs, sources that failed, anything closing soon.
   - **Learning** — cert progress (EDMCS → Claude Architect), achievements logged, what's missing from the resume.
   - **Applications sent vs target** (ask the candidate for their weekly target once; store it in `preferences.json` as `weekly_application_target`).
   - **Next week: 3 actions** — concrete, each with the slash command that does it.
4. Summarise in chat in ≤ 12 lines. Ask nothing unless a decision is blocking.
