---
name: decide
description: Research and reason through a career decision (should I take this path, switch lanes, stay or go, accept this offer vs that one) with live evidence, source grading, a 20-year view, and kill criteria. Use when the candidate asks "should I", "which is better", "what would you do", "is this a good jump", "deep research on my career", "/decide".
---

# /decide <the decision>

Produces `reports/career-decision-<today>.md` and appends the verdict to `profile/decisions.md`. This is the agent's heaviest thinking task: do it properly or say why you can't.

## 0. Frame the decision first (do not skip)
Write down, before any research: the options as they actually exist (with links to live postings where they are jobs), the horizon the candidate cares about, the criteria that matter to him (from `profile/career-context.md` and `preferences.json → priority_model`), and what he has already decided that this must respect (for example the years-as-preference rule, stay/go factors, confidentiality). If an option is imaginary ("maybe an AI startup"), say so and treat it separately from live options.

## 1. Research, in parallel, with numbers
Run 6 to 10 targeted WebSearch queries covering:
- **Demand** for each path (posting volumes, growth rates, talent shortage ratios; prefer analyses of large posting datasets).
- **The industry's own health** (revenue, headcount, layoffs, government or client spend — company disclosures and news outlets beat vendor blogs).
- **Automation exposure** by level and task, not by job title. The useful question is "which half of this job automates first".
- **Pay** at 1–3, 5 and 10 years for each path, in Australia, with the role titles actually advertised.
- **Local market** (the home city specialisation, employer set, whether the work is here or interstate).
- **The strongest counter-case** to the answer you expect. Search for it deliberately.
Run `node tools/signals.mjs` for the candidate's own market data: what the hunt has actually seen, which beats any national statistic for "what can I get locally this month".

## 2. Grade the sources, out loud
In the report, include a short **source-quality warning**: which findings come from recruiters, staffing firms or salary aggregators (commercial interest, soft magnitudes), which come from company disclosures, regulators, news outlets or academic work (harder), and where they disagree. Never present an aggregator's average as a fact the candidate can plan around. If the evidence is thin, say the direction is reliable and the magnitude is not.

## 3. Score the options
A table: rows = criteria (demand durability, automation exposure, optionality at 35, earnings at 5/10 years, local fit, uses what he already has, personal fit); columns = options. Prose in the cells, not scores out of ten — a fake number is worse than a sentence. Then the **trajectory table**: where each path puts him at 2, 5 and 10 years, in title, skills and pay.

## 4. Decide
State a recommendation in one sentence, then the case for it in one paragraph, then what it means concretely over the next 12 months as numbered actions tied to real things (live postings, a project, a certification, a conversation). Hedging is allowed only where it is honest: name the thing you genuinely cannot know.

## 5. Kill criteria and the human question
- **Kill criteria:** the specific, observable events that would reverse the recommendation. Where possible make them *measurable from this repo* (see `tools/signals.mjs`) so the agent can watch them rather than the candidate having to remember.
- **The human question:** end with what the analysis cannot answer and the cheapest experiment that would.

## 6. Record it
Append to `profile/decisions.md`: date, the decision, the recommendation, the two or three facts it rests on, the kill criteria, and a review date. On later runs, read that file first and say explicitly what has changed since the last decision — a decision log is only useful if it is revisited.

## Hard rules
- Never invent a statistic or a salary band. Cite or omit.
- Never let a recruiter's number stand unqualified.
- Say what you would do, and why, when asked. A refusal to answer is not neutrality; it is just less useful.
- The goal is a decision the candidate can act on this week, not a survey of considerations.
