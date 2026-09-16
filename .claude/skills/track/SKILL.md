---
name: track
description: Show or update the application pipeline and regenerate the dashboard. Use when the candidate says "track", "pipeline", "status", "where am I with", "mark as applied/interview/offer", "/track".
---

# /track [list | add | move | note | due]

```bash
export PATH="$HOME/.local/lib/node/bin:$PATH"
cd "$CAREER_OS"   # your career-os folder
node tools/track.mjs list [--status shortlisted|applied|screening|interview|offer|closed]
node tools/track.mjs add <jobId-or-url> --status shortlisted --company "…" --title "…" [--note "…"] [--due YYYY-MM-DD] [--next "…"]
node tools/track.mjs move <id> <status> [--note "…"] [--due YYYY-MM-DD] [--next "…"]
node tools/track.mjs note <id> "text"
node tools/track.mjs due
node tools/dashboard.mjs        # regenerates reports/dashboard.html
```
Statuses: shortlisted → applied → screening → interview → offer → closed. Always add a note with a date when moving. After any change run `node tools/dashboard.mjs` and offer to open `reports/dashboard.html` (`open reports/dashboard.html`).

When the candidate describes an event in prose ("BCG emailed me for a screening call Thursday"), translate it: `move` to the right status, `--due` the date, `--next` the preparation step, and suggest `/interview-prep` if it's an interview. Don't change statuses they didn't mention.

## Calendar (Google Calendar connector is available)
When an interview, assessment or deadline has a fixed date/time: offer to create a calendar event (load the Calendar connector's create_event via ToolSearch `+calendar create`). Ask before creating; title `Interview — <Company> (<role>)`, Perth time (Australia/Perth), 15-minute reminder plus a separate 90-minute prep block the day before titled `Prep: <Company>`. Never create events for tentative dates — put them in `--due` instead.
