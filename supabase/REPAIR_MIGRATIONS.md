# Mark existing migrations as applied (run once if your DB was set up manually)

If your database already has the schema (e.g. you ran SQL in the dashboard or an older setup), the CLI has no record of applied migrations. Mark 001 through 006 as applied so `db push` only runs 007–010.

From the project root, run **one** of these:

**Option A – Mark 001 only** (if only the initial schema exists):
```bash
npx supabase migration repair 001 --status applied --linked
```
Then run `npm run db:push`. If you get another "already exists" error, mark that version too (e.g. `002`, `003`, …) and push again.

**Option B – Mark 001 through 006** (if you’ve already applied everything up to 006):
```bash
npx supabase migration repair 001 --status applied --linked
npx supabase migration repair 002 --status applied --linked
npx supabase migration repair 003 --status applied --linked
npx supabase migration repair 004 --status applied --linked
npx supabase migration repair 005 --status applied --linked
npx supabase migration repair 006 --status applied --linked
```
Then:
```bash
npm run db:push
```
Only 007, 008, 009, and 010 will be applied.

Use your **database password** when prompted. Check status with:
```bash
npm run db:status
```
