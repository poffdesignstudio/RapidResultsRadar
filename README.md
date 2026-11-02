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

## Web app (Stage 2)

A Next.js app for Vercel: log in, run a search, watch it progress, and work the results in a
spreadsheet-style table. Setup is in `docs/DEPLOY-VERCEL.md`.

- **Search**: niche, city and state or ZIP, radius, and which sources to use. Save the form as a
  profile to rerun it later. A search runs in short steps (area, each source, matching, website
  crawl in batches of 12, finalize) and saves progress after each, so it fits Vercel's time limits
  and continues if the page is closed and reopened.
- **Results**: sort, filter, page through, and click any cell to edit it. Edited cells are kept when
  a later search finds the same business. Left-out businesses are listed with the reason.
- **Export / import**: CSV export in the shared schema. Importing Leia's CSV matches rows on
  `lead_id` and changes only the cells she filled in; blank cells never erase data. Every change is logged.
- **Do-not-contact & suppression**: upload the existing-client list and unsubscribed addresses.
  Both apply during every search and again at every export.
- **Sources & calls**: an on/off switch for every source, and per-search and per-month call caps
  plus this month's call count and estimated cost for each paid source.

Run it locally: `npm install`, set `DATABASE_URL` and `ADMIN_PASSWORD`, then `npm run dev`.
The Stage 1 command line still works: `npm run dig -- --niche "home care" --city Charlotte --state NC --radius 30`.

## How Stage 1 works

1. **Area.** City and state (or ZIP) to a center point and the ZIP codes and towns inside the
   radius, from the Census Gazetteer files.
2. **Sources.** Google Places Text Search (basic fields, capped), Overture Maps places (free),
   and for home care and home health also NPPES, CMS Home Health Agencies, and CMS owners
   joined through CMS enrollments.
3. **Matching.** Records are grouped into one business by CCN, phone, website, or ZIP plus street
   plus a similar name. Near-misses are flagged as possible duplicates instead of merged.
4. **Website crawl.** Up to 5 pages per site (home, team/about, contact, careers), robots.txt
   respected, cached for 30 days. Finds names, titles, emails and hiring signals.
5. **Contact and email.** The highest-ranked decision maker across all sources, their email if
   found, else one built from a pattern seen on the site, else a low-confidence guess, else the
   generic inbox. Mail-server (MX) check on the domain.
6. **Exclusions.** Do-not-contact list, suppression list, and businesses Google lists as closed.
7. **Output.** CSV, report, spot-check sample, left-out list, field provenance.

## Layout

```
config/default.json   default caps, on/off flags, crawl limits
src/app/              the web app: pages, API routes, components
src/web/              web app server code: database, search job steps, leads, login
src/pipeline.ts       the search steps shared by the web app and the command line
src/data/             the franchise and chain brand list
src/providers/        one file per source, each with search(), normalize(), estimateCost()
src/enrich/           website crawler, contact extraction, email patterns, MX check
src/match/            matching, franchise detection, do-not-contact, suppression
src/leads/            lead building, contact choice, scoring, lead ID ledger
src/export/           report
test/                 npm test
```

`email_status` values: `unverified` (a personal address found or built, not yet checked by a
verifier), `generic` (info@ style), `risky` and `verified` (not used until Stage 4 adds a
verifier). `email_source` says how the address was found: `website:found_on_page`,
`overture:listed`, `pattern_from_site:<pattern>`, or `pattern_guess:first`.
