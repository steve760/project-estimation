# Project cost estimation

A web app for estimating cost, revenue, and profitability of consulting projects. Built with React, TypeScript, Vite, MUI, and Supabase.

## Features

- **Clients** – Manage clients and view all their projects
- **Projects** – Per client: add projects with phases and activities
- **Phases & activities** – Break down each project into phases and activities
- **Consultants** – Define consultants with cost per hour and charge-out rate
- **Assignments** – Assign one or more consultants to each activity with hours
- **Financials** – Automatic calculation of cost, revenue, profit, and margin at activity, project, and client level

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod
- **UI:** Material UI (MUI), MUI X Data Grid
- **Backend:** Supabase (Postgres, RLS, JS client)

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Supabase**

   - Create a project at [supabase.com](https://supabase.com).
   - In the SQL editor, run the migration: `supabase/migrations/001_initial_schema.sql`
   - In Project Settings → API, copy the project URL and anon key.

3. **Environment**

   Create a `.env` file in the project root (see `.env.example`):

   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

4. **Run**

   ```bash
   npm run dev
   ```

   Open the app, sign up or sign in (Supabase Auth), then add consultants, clients, and projects.

## Scripts

- `npm run dev` – Start dev server
- `npm run build` – Production build
- `npm run preview` – Preview production build
- `npm run lint` – Run ESLint

## Data model

- **Cost** = sum over all activity assignments of `hours × consultant.cost_per_hour`
- **Revenue** = sum over all activity assignments of `hours × consultant.charge_out_rate`
- **Profit** = revenue − cost
- **Margin** = (profit / revenue) × 100 when revenue &gt; 0
