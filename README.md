# Rapid Results Radar

Rapid Radar's first module, **Lead Digger**, finds businesses by niche and area, then finds
the right person to contact at each one (usually the owner or top executive), a usable email
for that person, and a phone number where possible. It flags questionable data for review
and exports a CSV for Leia and the Lead Tracker.

This repo builds the search and data side only. It does not send email or track campaigns.

## Rules this code follows

- Every data source is a swappable Provider with `search()`, `normalize()` and `estimateCost()`.
- Google Places is the only paid source in Stage 1, behind a per-run and per-month call cap.
- Every field keeps its source and confidence. Every lead keeps a permanent `lead_id`.
- Secrets live in `.env` only. The website crawler respects robots.txt. No LinkedIn automation.
- Every date shown or exported is MM-DD-YYYY.

See `docs/SETUP-WINDOWS.md` for setup and how to run it.
