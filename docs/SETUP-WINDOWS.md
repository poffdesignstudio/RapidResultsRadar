# Running Lead Digger on Windows

## One-time setup

1. Install **Node.js 22 LTS** from https://nodejs.org (the Windows Installer). Accept the defaults.
2. Install **Git for Windows** from https://git-scm.com/download/win. Accept the defaults.
3. Open **PowerShell** and run these, one at a time:

   ```
   cd $HOME\Documents
   git clone https://github.com/poffdesignstudio/RapidResultsRadar.git
   cd RapidResultsRadar
   git checkout stage-1
   npm install
   copy .env.example .env
   notepad .env
   ```

   GitHub will ask you to sign in the first time, because the repository is private.
   In Notepad, paste your key after `GOOGLE_PLACES_API_KEY=`, save and close.
   Leave it blank to run on the free sources only.

4. Put the do-not-contact list at `data\do_not_contact.csv`. It is never uploaded anywhere
   except this repo, and only if you commit it.

## Each time

From the `RapidResultsRadar` folder in PowerShell:

```
.\check-sources
```
Makes one real call to every source (one Google call if a key is set) and saves the results to
`output\source_check_MM-DD-YYYY.txt`. Run it first and send me that file.

```
.\dig --niche "home care" --city Charlotte --state NC --radius 30
```
Runs the search. Other forms: `--zip 28202` instead of city and state, `--no-google` for free
sources only, `--max-google 20` to allow fewer Google calls this run, `--max-sites 25` to crawl
only 25 websites for a quick test, `--no-crawl` to skip websites.

A full Charlotte run takes about 15 to 20 minutes, mostly the website crawl. Crawled sites and
downloaded government files are saved in `state\`, so a second run is much faster.

## What it writes to `output\`

| File | What it is |
|---|---|
| `leads_<area>_<niche>_<date>.csv` | The lead list in the shared CSV schema. Opens in Excel. |
| `report_<...>.txt` | The run report: counts, where each field came from, Google calls and cost, Google-only fields. |
| `spotcheck_<...>.csv` | 10 random rows with the pages crawled and where the contact came from, for the 10-row spot-check. |
| `review_left_out_<...>.csv` | Businesses left out (existing clients, suppressed, closed) and why. |
| `provenance_<...>.json` | Source and confidence for every field of every lead. |

`state\` holds the call counter (`usage.json`), the permanent lead ID list (`lead_ledger.csv`)
and caches. Do not delete `lead_ledger.csv`: it keeps each business on the same `lead_id`.

## Updating

```
git pull
npm install
```
