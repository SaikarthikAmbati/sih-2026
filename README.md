# MinePulse mobile

Expo/React Native MVP for Indian coal-mine compliance inspections, corrective actions, explainable risk scoring, evidence workflows, and advisory Gemini insights.

## Run locally

1. Rotate the Supabase database password and Gemini key that were shared in chat.
2. Create a Supabase project and copy `.env.example` to `.env`.
3. Set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and the deployed Edge Function URL.
4. Run:

```powershell
npm install
npx expo start
```

Apply `supabase/schema.sql` to a new project, or apply `supabase/migrations/001_prd_alignment.sql` followed by `supabase/migrations/002_least_privilege_rls.sql` to the existing MVP database. Migration 002 replaces permissive policies with server-enforced scope/role policies across business tables, adds regulatory portfolios, and provides `inspections_safe` / `observations_safe` views for GPS masking. Authenticated clients should use those views for location-bearing reads; direct coordinate-column access is revoked. Deploy `supabase/functions/gemini-insights` with `GEMINI_API_KEY` stored as a Supabase secret; never put the Gemini key in the mobile bundle.

For an existing database, apply the migration in the Supabase SQL editor or with the Supabase CLI. It does not delete existing rows. Before creating new production records, create the organization/subsidiary hierarchy and assign each authenticated user a `user_scopes` row; existing MVP mines and profiles are intentionally left unassigned so they are not silently placed in the wrong tenant.

The app starts in demo mode until Supabase variables are configured. `riskEngine.js` remains the source of truth for deterministic, explainable risk scoring.
