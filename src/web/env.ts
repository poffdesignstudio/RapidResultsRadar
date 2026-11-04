/** What the deployment is missing. The pages show these instead of failing silently. */
export interface ConfigCheck {
  name: string
  ok: boolean
  required: boolean
  fix: string
}

export function configChecks(): ConfigCheck[] {
  return [
    {
      name: 'ADMIN_PASSWORD',
      ok: !!process.env.ADMIN_PASSWORD,
      required: true,
      fix: 'In Vercel: Project → Settings → Environment Variables, add ADMIN_PASSWORD with the password you want to log in with, then redeploy.',
    },
    {
      name: 'DATABASE_URL',
      ok: !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
      required: true,
      fix: 'In Vercel: Project → Storage → Create Database → Neon (Postgres, free plan) → connect it to this project. That adds DATABASE_URL. Then redeploy.',
    },
  ]
}

export const missingRequired = () => configChecks().filter((c) => c.required && !c.ok)
