# Applying migrations (Supabase CLI)

Apply all SQL migrations to your Supabase project without pasting into the dashboard.

## One-time setup

1. **Install Supabase CLI** (if needed):
   ```bash
   npm install -g supabase
   ```
   Or use `npx supabase` so you don’t install globally.

2. **Initialize** (only if the project has no `supabase/config.toml` yet):
   ```bash
   npx supabase init
   ```
   This creates `supabase/config.toml`. You can keep the defaults.

3. **Link to your Supabase project**:
   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```
   Get **Project ref** from: Supabase Dashboard → Project Settings → General → Reference ID.  
   When prompted, enter your database password.

## Apply migrations

From the project root:

```bash
npm run db:push
```

Or:

```bash
npx supabase db push
```

This applies every migration in `supabase/migrations/` that hasn’t been applied yet (in filename order).

## Check what’s applied

```bash
npm run db:status
```

Or:

```bash
npx supabase migration list
```

Shows which migrations have been applied on the linked project.

## CI / automation

- Run `supabase link --project-ref $SUPABASE_PROJECT_REF` with `SUPABASE_DB_PASSWORD` set (or use a service-role key).
- Then run `supabase db push` in the same environment so migrations run on deploy or on a schedule.
