---
name: log
description: Log something the candidate did or learned at work into the achievements file and turn it into a resume bullet. Use when the candidate says "log", "I did X today", "add to my resume", "I learned", "I built", "/log".
---

# /log <what happened>

1. Ask at most 2 clarifying questions if the impact or scale is missing (who was it for, what changed, any number: hours saved, users, records, revenue, defects). Skip if they gave enough.
2. Append to `profile/achievements.md` under the current year:
   `- <YYYY-MM-DD> — <what> — impact: <…> — skills: <…> — client: <generalised>`
3. Propose **one** resume bullet (verb + what + tool + outcome; ≤ 2 lines; no jargon they can't defend in an interview) and say which section of `profile/master-resume.md` it belongs in and whether it should replace a weaker bullet there.
4. Only after the candidate says yes: edit `master-resume.md`. If the bullet touches a skill not yet listed, add it to the Skills block too. If it's a new cert, update `profile/certifications.md` as well.
5. If the achievement is a good interview story, add a stub to `profile/story-bank.md` (STAR skeleton with `[FILL]` markers).

Never embellish. If the candidate describes something small, log it small — the file is a diary, not a brochure; `/tailor` chooses what to surface.
