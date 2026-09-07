# MinePulse

MinePulse is an Expo and React Native mobile application for mining compliance
operations. It helps inspectors capture field inspections, observations, evidence,
and corrective actions while giving managers and compliance teams a clear view of
deadlines, risk, and escalations.

The application uses Supabase for authentication and PostgreSQL data storage. It
also supports optional advisory insights from Google Gemini through a Supabase Edge
Function.

## Features

- Role-based dashboards for:
  - Administrators
  - Mine Managers
  - Inspectors
  - Regulatory Authorities
  - Corporate Management
  - Corrective-Action Owners
  - Verifiers and Approvers
- Compliance requirement management
- Inspection workflow management:
  - Create, start, pause, resume, and submit inspections
  - Select mines and versioned inspection templates
  - Configure frequency, due dates, evidence type, severity, and notes
- Inspection template administration with sections, questions, response types,
  guidance, evidence rules, and published versions
- Observation and violation management with severity, status, containment,
  ownership, location, and audit history
- Corrective-action lifecycle:
  - Open
  - Assigned
  - In Progress
  - Resolved
  - Verified
  - Closed
- Explainable, deterministic mine-risk scoring
- In-app deadline reminders and escalation notifications
- Supabase Row Level Security (RLS) for organization, mine, portfolio, and role
  scoping
- Demo mode when Supabase is not configured

## Technology

- Expo SDK 57
- React Native 0.86
- React 19
- TypeScript
- Supabase PostgreSQL and Auth
- Supabase Edge Functions
- Google Gemini API (server-side only)

## Project structure

```text
.
├── App.tsx                         # Main mobile app and screen workflows
├── riskEngine.js                   # Explainable deterministic risk scoring
├── src/
│   ├── data/demo.ts                # Demo-mode records
│   ├── lib/supabase.ts             # Supabase data-access functions
│   ├── lib/gemini.ts               # Gemini Edge Function client
│   └── types.ts                    # Shared domain types
├── supabase/
│   ├── migrations/
│   │   ├── 001_prd_alignment.sql  # Product schema and workflow rules
│   │   └── 002_least_privilege_rls.sql
│   ├── schema.sql                  # Clean baseline schema
│   ├── seeds/                      # Optional sample data
│   └── functions/
│       └── gemini-insights/        # Server-side Gemini proxy
├── .env.example                    # Safe environment-variable template
└── package.json
```

## Prerequisites

- Node.js 20 or newer
- npm
- An Expo-compatible development environment
- A Supabase project
- A Google Gemini API key if AI insights are enabled

## Getting started

### 1. Install dependencies

```powershell
npm install
```

### 2. Configure environment variables

Copy the example file:

```powershell
Copy-Item .env.example .env
```

Set the following values in `.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
EXPO_PUBLIC_GEMINI_FUNCTION_URL=https://your-project.supabase.co/functions/v1/gemini-insights
```

The `.env` file is ignored by Git. Never commit database passwords, service-role
keys, or Gemini API keys.

### 3. Set up Supabase

For a new database, apply:

```text
supabase/schema.sql
supabase/migrations/001_prd_alignment.sql
supabase/migrations/002_least_privilege_rls.sql
```

For an existing MinePulse database, apply the migrations in order:

1. `supabase/migrations/001_prd_alignment.sql`
2. `supabase/migrations/002_least_privilege_rls.sql`

The migrations are designed to preserve existing MVP data and add the compliance,
inspection, observation, corrective-action, risk, notification, audit, and access
control structures.

After applying the migrations:

- Create the organization, subsidiary, mine, and department hierarchy.
- Create or update authenticated user profiles.
- Assign users the correct role.
- Add `user_scopes` records where organization, subsidiary, mine, or regulatory
  portfolio scoping is required.
- Confirm RLS access with a non-admin test account before production use.

### 4. Deploy the Gemini Edge Function (optional)

Deploy `supabase/functions/gemini-insights/index.ts` using the Supabase CLI or the
Supabase dashboard. Store the Gemini key as an Edge Function secret:

```text
GEMINI_API_KEY=your-gemini-api-key
```

The Gemini key must remain server-side. The mobile app calls the Edge Function and
does not include the secret in the application bundle.

### 5. Start the app

```powershell
npx expo start
```

Useful alternatives:

```powershell
npm run android
npm run ios
npm run web
```

If Supabase environment variables are absent, the app starts in demo mode with
local sample records.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run start` | Start the Expo development server |
| `npm run android` | Start Expo for Android |
| `npm run ios` | Start Expo for iOS |
| `npm run web` | Start the web target |
| `npm run typecheck` | Run the TypeScript compiler without emitting files |
| `npm run test:risk` | Run a smoke test for the risk engine |

## Security notes

- Rotate any credentials that have previously been shared in chat, source files,
  screenshots, or public repositories.
- Do not commit `.env`, Supabase service-role keys, database passwords, or Gemini
  keys.
- Use the Supabase anon key only in the client application.
- Keep service-role operations and Gemini credentials in Supabase Edge Functions
  or another trusted server environment.
- RLS is the authoritative access-control layer. Client-side role checks only
  improve the user experience.
- Location-bearing data should be accessed through the safe views and policies
  provided by the migrations.

## Current limitations

The following capabilities are planned but are not complete in the current
repository:

- Durable encrypted offline storage and conflict-resolution UI
- Offline evidence-file persistence and upload synchronization
- Native camera and GPS capture wrappers
- Push notifications through `expo-notifications`
- Persistence of individual checklist responses for every template question

The current inspection and observation screens expose synchronization state fields,
but a production offline queue should not be considered complete until encrypted
storage, retry handling, conflict detection, and explicit user resolution are
implemented.

## Contributing

1. Create a feature branch.
2. Keep secrets in local environment variables only.
3. Make focused changes that preserve RLS and workflow constraints.
4. Run the relevant checks:

```powershell
npm run typecheck
npm run test:risk
```

5. Open a pull request with a clear description of database or migration changes.

## GitHub publishing checklist

Before pushing this project:

- Confirm `.env` is ignored and is not already tracked.
- Search the repository for exposed API keys, passwords, and service-role tokens.
- Rotate any credential that was previously exposed.
- Add screenshots or a short demo video if the repository is intended for
  presentation.
- Document any required Supabase migration order in the pull request.
- Run `npm run typecheck` successfully.

## License

No license has been selected yet. Add a `LICENSE` file before accepting external
contributions or distributing the project publicly.
