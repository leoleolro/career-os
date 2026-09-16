---
name: apply
description: Pre-flight an application and drive the browser to the employer's form, filling it from the profile and uploading the tailored files — stopping before submit. Use when the candidate says "apply", "submit the application", "fill in the form", "/apply".
---

# /apply <jobs/<slug>>

## 0. Rules (non-negotiable)
- **the candidate clicks Submit.** Also the candidate: any "Agree to terms/privacy" checkbox, account creation, password entry, and any payment. If the site requires creating a candidate account, stop and hand over.
- Fill only from `profile/preferences.json` (candidate block), `profile/master-resume.md`, and the job folder. Never guess an answer to a screening question — ask the candidate.
- Use the Browser pane (`mcp__Claude_Browser__*`) unless the candidate explicitly asks for their own Chrome (`claude-in-chrome`, which has their logged-in sessions).

## 1. Pre-flight checklist (print it, tick each)
- `jobs/<slug>/outputs/` has the final PDF(s); the candidate has said the resume/cover letter are approved.
- JD still open — reopen the apply URL in the Browser pane (WebFetch decoys are not evidence). Check the closing date.
- Graduate programs: transcript merged (`--merge`) if they require one PDF; work rights (Australian citizen) and graduation-window rules met.
- Work-rights, notice period (ask if unknown), salary expectation (ask — never invent), references (ask before naming anyone).
- Pipeline entry exists: `node tools/track.mjs list`.

## 2. Drive the form
1. `navigate` to the apply URL → wait → `read_page` (filter interactive).
2. Fill text fields with `form_input`; use `find` to locate fields; upload files with the file input (`form_input` with the absolute path to the PDF) — if the site's uploader needs a native dialog, stop and tell the candidate which file to pick.
3. For each screening question, show the candidate the question and the answer you intend to give from the profile; if it isn't in the profile, ask.
4. Take a screenshot before the final step. Summarise every field value entered.
5. **Stop at the review/submit page.** Tell the candidate exactly what to click. If the Browser pane is not visible to them, say so and hand over the URL + field summary instead.

## 3. After the candidate confirms they submitted
`node tools/track.mjs move <id> applied --note "submitted <date> via <portal>" --due <today+10d> --next "Follow up if no response"` and note any confirmation number in `jobs/<slug>/notes.md`.
