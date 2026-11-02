# Putting Rapid Radar on Vercel

The app deploys from the `main` branch of `poffdesignstudio/RapidResultsRadar`. It needs two
settings to work and one more to use Google. Nothing else.

| Setting | Needed? | What it is |
|---|---|---|
| `ADMIN_PASSWORD` | Yes | The password you log in with. You choose it. |
| `DATABASE_URL` | Yes | The Postgres database. Vercel adds it for you in step 3. |
| `GOOGLE_PLACES_API_KEY` | Optional | Your Google key. Without it, searches use the free sources only. |
| `SESSION_SECRET` | Optional | Any long random text. If set, it signs the login cookie instead of the password. |

## 1. Import the project (once)

1. Go to https://vercel.com/new and sign in with GitHub.
2. Find **RapidResultsRadar** and click **Import**. If it is not listed, click "Adjust GitHub App
   Permissions" and give Vercel access to that repository.
3. Project name: `rapidresultsradar` (this gives the address rapidresultsradar.vercel.app).
   Framework: Next.js (detected). Leave the build settings as they are.
4. Click **Deploy**. The first deploy works but shows "Missing setting" until steps 2 and 3 are done.

## 2. Add the settings

Project → **Settings** → **Environment Variables**. Add each as `Name` and `Value`, for all environments:

- `ADMIN_PASSWORD` = the password you want
- `GOOGLE_PLACES_API_KEY` = your Google key

## 3. Add the database (free)

Project → **Storage** → **Create Database** → **Neon** (Serverless Postgres) → free plan →
**Connect** it to this project. That adds `DATABASE_URL` automatically. The app creates its own
tables the first time it runs.

## 4. Redeploy

Project → **Deployments** → the latest one → **⋯** → **Redeploy**. Settings only take effect after a redeploy.

## Checking it

- https://rapidresultsradar.vercel.app/api/health lists each setting as ok or missing (never its value)
  and says whether the database is connected.
- Log in, run a search, and keep the page open while it runs. Progress is saved after every step.

## Limits to know

- Each step of a search may run up to 300 seconds. That needs Vercel's "Fluid compute", which is on
  by default for new projects (Project → Settings → Functions). If a deploy fails with a
  maxDuration error, turn Fluid compute on.
- The monthly Google call counter lives in the database, so it starts at 0 on a new database.
  Calls made from earlier test sessions are not in it; Google's own quota page has the true total.
