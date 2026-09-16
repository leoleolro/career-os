---
name: tailor
description: Produce a job-specific resume + cover letter (PDF/DOCX) derived from the master resume, for a job URL or an existing jobs/<slug> folder. Use when the candidate says "tailor", "make a resume for", "apply to this", "cover letter for", or pastes a job link.
---

# /tailor <job url | jobs/<slug>>

## 1. Get the JD (verify it is open)
- If a `jobs/<slug>/jd.md` exists, read it. Otherwise fetch the posting. **Do not trust WebFetch on ATS sites** — Phenom (BCG), Workday, Oracle ORC serve a "has been filled" decoy to plain fetches. Use the Browser pane (`navigate` → wait 3s → `get_page_text`) or the matching adapter: `node -e 'import("./sources/index.mjs").then(async m=>{const s=m.getSource("phenom");console.log(JSON.stringify(await s.details({sourceId:"bcg-57792",url:"<url>"})))})'`.
- Create `jobs/<company-jobid-short-title>/` and write `jd.md`: header (title, company, job id, source URL, apply URL, location, posted/closing dates, status + how verified), "What you'll do", "What you'll bring" (verbatim requirement bullets), and **Fit notes**: each requirement → the candidate's evidence from `profile/master-resume.md`, or "GAP".

## 2. Inputs (read all)
`profile/master-resume.md` (only source of facts), `profile/certifications.md` (what is obtained vs in progress), `profile/preferences.json`, `profile/story-bank.md`, `profile/achievements.md` (recent work not yet in master).

## 3. Write `resume.md` (ATS rules)
- **No em dashes (—) or en dashes (–) anywhere in resumes or cover letters, ever** (the candidate, 2026-09-16: they read as AI-written). Use commas, colons, full stops, "to" for ranges, and "|" as the header/certs separator. Run `grep -n '—\|–' jobs/<slug>/*.md` before rendering; it must return nothing.
- Each role gets its own heading, even internships (never combine two employers under one heading).
- Certifications: list obtained ones; an exam that is booked may be listed as "(exam booked)"; the candidate's call (2026-09-16) is that an exam scheduled within the week of applying is listed as obtained, and the resume is regenerated the same day if the date slips.
- Header: name, city, phone, email, LinkedIn as plain text (not a link); add `github.com/<you>` as plain text on engineering/AI resumes only, never on consulting ones. No photo, no columns, no tables, no icons.
- **One page for MBB (McKinsey/BCG/Bain) and graduate programs — render with `--compact`; two pages max for Australian industry / Big 4 lateral roles.** Check the printed page count; cut, don't shrink below --compact. Headline line under the name mirrors the JD's title vocabulary truthfully (e.g. "Technology Consultant | Oracle EPM & Applied AI").
- Summary/Profile: **omit for MBB and graduate programs** (not the convention — evidence only); for Australian industry / Seek / Big 4 roles keep a 3-line keyword-dense summary, no first person.
- Skills block first for technical roles; Experience first for consulting roles.
- Bullets: verb + what + tool + outcome/number. Reorder and reword master bullets to mirror JD language; **never add a claim not in master**. If the JD wants a number the candidate doesn't have, ask them — don't invent.
- Certifications: list obtained ones with year; in-progress ones as "in progress (exam <date>)" — see certifications.md. Never present an unpassed exam as passed.
- Consulting roles: include Leadership & Community (society leadership, volunteering). Graduate roles (BCG X): include extra-curricular/interests — ask the candidate if `master-resume.md` still says TODO.
- Australian English. Client names: generalise ("ASX200 mining client") unless the candidate has said they can name them.

## 4. Write `cover-letter.md`
≤ 1 page, 4 paragraphs: (1) role + why this firm specifically (cite something real from the JD/company), (2) two proof points matching their top requirements, (3) the AI angle — what the candidate builds outside work, (4) availability, location/relocation, close. No clichés ("I am writing to…"). Date, addressed to the recruiter named in the JD if any (BCG ANZ: recruitmentinANZ@bcg.com).

## 4b. Write `brief.md` (the advice layer shown on the dashboard's Job packs tab)
Sections, in this order, grounded in the JD, `profile/career-context.md`, `profile/preferences.json → priority_model` (tiers, interest, stay_go_factors) and `reports/market-insights-<latest>.md`:
1. Title line: `# Brief — <role> · <P1/P2/P3> · <rating>` then **Verdict:** one sentence (apply / apply with eyes open / skip) and why.
2. **Does it suit you?** For / Against / Net — honest, specific to the candidate.
3. **Priority reasoning** — brand direction vs the current employer (step up / lateral / step down), interest, pay (stated or "verify"), your current employer stay-vs-go context (scandal/restructure) and the neutral interview line.
4. **How to position yourself** — which stories lead (story-bank numbers), what to de-emphasise, how to handle the years line, what to prepare/build before the screen.
5. **Trajectory of this role** — title ladder at that company, typical timing, exit options.
6. **The company, briefly** — what is known; mark anything unverified and point to `/research <company>`.
7. **Process to expect** — stages, assessments; mark "typical — verify".
8. **Risks and unknowns** · 9. **Pack** — links to resume/cover letter/interview-prep/research/network files.
Never state salary figures as fact — give a band with "verify" or say unknown.

## 5. Render
```bash
export PATH="$HOME/.local/lib/node/bin:$PATH"
cd "$CAREER_OS"   # your career-os folder
node tools/render.mjs jobs/<slug> --name Resume_LeoLong_<Company>
# graduate programs that want one PDF (BCG X): add the transcript
node tools/render.mjs jobs/<slug> --name Application_LeoLong_<Company> --merge inbox/UWA_transcript.pdf
```
Check the printed page count and text-extraction line. Open the PDF (Read tool) and eyeball page 1.

## 6. Hand over
List the output files, the 3 biggest changes vs the Seek resume and why, any GAPs left, and what the candidate must confirm before applying. Then add to the pipeline: `node tools/track.mjs add <url> --status shortlisted --company … --title … --next "Review + apply"`. **Do not apply** — that is `/apply`, and the candidate clicks submit.
