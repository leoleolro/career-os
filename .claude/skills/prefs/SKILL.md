---
name: prefs
description: Change job-search preferences conversationally (locations, target roles, queries, companies, seniority, salary floor). Use when the candidate says "prefs", "also look for", "stop showing", "add company", "I'd move to", "/prefs".
---

# /prefs

1. Read `profile/preferences.json` and show the relevant block(s) in a short table.
2. Translate the candidate's request into concrete edits (e.g. "also look for solutions architect roles" → add to `target_roles` and `search_queries`; "no more contract roles" → note in `hard_exclude_titles` or a new `exclude_work_types`). Show the diff; apply with python3/node keeping 2-space JSON formatting; keep `_comment` fields.
3. If the change affects scoring (`lib/score.mjs` reads `keywords_boost`, `keywords_penalty`, `locations`, `dream_companies`, `max_days_old`), say so and offer a `--dry` run to preview: `node hunt.mjs --dry --source seek --query "<new query>" --location "Perth WA" --limit 10`.
4. Facts about the candidate himself (work rights, notice period, salary expectation, graduation date) live in `candidate` — update there and mirror to `profile/master-resume.md` header if it's resume-relevant.
