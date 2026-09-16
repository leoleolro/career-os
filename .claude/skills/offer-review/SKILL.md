---
name: offer-review
description: Decode and benchmark a job offer (Australian employment specifics), compare against current role and other offers, and script the negotiation. Use when the candidate says "offer", "they offered", "should I accept", "negotiate", "review this contract", "/offer-review".
---

# /offer-review <file in inbox/ | pasted terms>

## 1. Extract the terms into a table
Base salary (ex/inc super — AU super guarantee is 12% from 1 July 2025; confirm which the letter means), bonus (target %, discretionary?), equity/RSUs (vesting, cliff), sign-on, relocation, allowances, leave (annual/personal/parental), probation, notice period (both directions), restraint of trade / non-compete / non-solicit (duration, geography — enforceability in AU is limited but still matters), IP/moonlighting clauses (matters if you have side projects or a business), remote/hybrid terms, start date, title/level, review cycle, training budget, visa/citizenship clauses (n/a — Australian citizen), any clawbacks.
Flag anything missing or ambiguous as a question for the employer.

## 2. Benchmark
- Compare to the candidate's current package (ask if not in `profile/career-context.md`) and any other live offers in `data/pipeline.json`.
- Market: use WebSearch for AU salary guides (Hays, Robert Half, Michael Page, Glassdoor/Levels.fyi for AI roles) for the title + city + years; cite sources; give a range, not a point.
- Total-comp view over 12 and 36 months (base + super + expected bonus + equity at conservative value − relocation costs).
- Non-money: path fit (`/career-path`), learning, brand, manager quality, exit options.

## 3. Negotiation script
- Decide the ask: base first (a specific number, anchored on the benchmark and a competing offer/current package), then sign-on/relocation, then start date/leave. One ask per message.
- Draft the email/call script in the candidate's voice, polite and firm, with fallbacks. Note timing (respond within the stated window; ask for it in writing).
- What not to say (don't invent competing offers; don't accept verbally before the letter).

## 4. Decision aid
A one-page `reports/offer-<company>-<today>.md`: terms table, benchmark, red flags, the ask, and a plain recommendation with the reasoning. the candidate decides; record the outcome with `node tools/track.mjs move <id> offer|closed --note "…"`.

This is general information, not legal advice — for restraint or IP clauses that worry them, suggest a 30-minute employment-lawyer review (often free via union/professional association).
