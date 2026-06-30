# OT-Agent Leaderboard

Web-based leaderboard for displaying and comparing LLM agent benchmark evaluation results, backed by Supabase.

It reads aggregated evaluation results from a Supabase `leaderboard_results` view and renders them in a pivoted, filterable table where each row is a `(model, agent)` pair and each benchmark is a column showing `accuracy% ± standard_error` plus an improvement signal versus the base model.

## Features

- 🗂️ **Tabbed Views** — ~20 preset tabs (`All Models`, `Base Models`, `A1`–`G1`, `OOD`, `WAR`, `Table 1`, `Scaling`, `8B RL`, `Baseline Data`, `Missing Eval`, `Guardrail`, `Filtered View`, `Active`, `Blacklisted`) that scope which models/benchmarks are shown (see [Tabbed Views](#tabbed-views))
- 🔍 **Search** — Real-time filtering by model, agent, benchmark, or base model name
- 🎯 **Filter** — Multi-select dropdowns (with in-dropdown search) for models, agents, base models, and benchmarks
- 📊 **View Modes** — On `Filtered View`: Top N Performers by a chosen benchmark, plus N Most Recently Added / N Most Recently Eval'd
- ↕️ **Sort** — Click any column header to sort; per-benchmark toggle between accuracy (`Acc`) and improvement (`Imp`)
- 📈 **Improvement Metrics** — Per-benchmark improvement (pp) relative to the base model, with duplicate-aware comparison against canonical models/benchmarks
- 🧬 **Duplicate Handling** — Hide/show duplicate models and benchmarks; results merge intelligently into canonical rows/columns
- 🚫 **Blacklist & Exclusions** — Blacklisted models (`config/blacklistedModels.ts`) and problematic benchmarks (`config/benchmarkConfig.ts`) are hidden, with visual indicators
- ⚠️ **Guardrail Flags** — Incomplete / High-Error eval detection surfaced on the `Guardrail` tab
- 🧮 **Merge-then-Threshold Selection** — The view merges a canonical benchmark with its duplicates, then prefers the first result above the accuracy threshold to deprioritize glitchy 0% runs; selection mode is also switchable in the UI
- 🕐 **Job Timestamps** — Model-added and eval-ended times in ISO format, globally sortable
- 🏷️ **Metadata Badges** — Training type, model size, and snapshot/eval-config metadata
- 📌 **Frozen Columns + Dual Scrollbars** — Model column stays pinned; horizontal scrollbars at top and bottom
- 📱 **Responsive** — Separate mobile and desktop table layouts
- 📤 **Export** — Export the visible table to TXT
- 📧 **Email Notifications** — Supabase Edge Function (`notify-new-model`) emails on new model registration via Resend
- 🎨 **Theme** — Dark/light mode toggle
- 📖 **Built-in Legend** — Explains metrics, sorting modes, trace links, timestamps, and excluded benchmarks

## Prerequisites

1. **Node.js** — Version 20 or higher
2. **Supabase Account** — With a configured project
3. **Database Setup** — Supabase database with:
   - Core tables: `agents`, `models`, `benchmarks`
   - Evaluation tables: `sandbox_jobs`, `sandbox_trials`, `sandbox_tasks`
   - View: `leaderboard_results` (see [Database View Setup](#2-database-view-setup))

## Installation

```bash
# Install dependencies
npm install
```

## Configuration

### 1. Environment Variables

Create a `.env` file in the project root:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co/
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**Get your Supabase credentials:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Settings** → **API**
4. Copy the **Project URL** and **API Keys**

> The Edge Function (`supabase/functions/notify-new-model`) additionally requires `RESEND_API_KEY` to be set as a Supabase secret — it is **not** read from this `.env`.

### 2. Database View Setup

The leaderboard requires the `leaderboard_results` view to aggregate evaluation results. Run the SQL in `create_leaderboard_view.sql`:

```sql
-- Supabase Dashboard → SQL Editor → New Query
-- Paste the contents of create_leaderboard_view.sql and run it.
-- The script DROPs and recreates the view safely (CASCADE).
```

**Selection logic (merge-then-threshold):** For each `(model, agent, canonical_benchmark)`, results from the canonical benchmark **and all its duplicates** are merged into one pool. From that pool the first evaluation with `accuracy > 1.0%` is selected (deprioritizing glitchy 0% runs); if none qualify, the earliest evaluation is shown as a fallback.

The view exposes (among others):
- `model_id`, `model_name`, `model_duplicate_of`, canonical model name
- `agent_id`, `agent_name`
- `benchmark_id`, `benchmark_name` (canonical), `source_benchmark_name`, `benchmark_duplicate_of`
- `base_model_id`, `base_model_name`
- `accuracy`, `standard_error`, `hf_traces_link`
- `ended_at` / `created_at` timestamps
- Four base-model accuracy values used for duplicate-aware improvement (surfaced by the API as `baseModelAccuracy`, `canonicalBenchmarkBaseModelAccuracy`, `canonicalBaseModelAccuracy`, `canonicalBothBaseModelAccuracy`), selected based on the duplicate checkboxes

> Note: the deployed view is maintained directly in Supabase and may be ahead of `create_leaderboard_view.sql` in this repo. When changing columns, update both.

**Verify:**
```sql
SELECT COUNT(*) FROM leaderboard_results;
```

## Running the Server

### Development Mode (hot reload)

```bash
npm run dev
```

Starts on **http://localhost:5000** (override with `PORT`). In development, Vite provides HMR for the React frontend via Express middleware.

```bash
# If port 5000 is in use
PORT=5001 npm run dev
```

### Production Build

```bash
npm run build   # Vite builds the client to dist/public; esbuild bundles the server to dist/index.js
npm start       # Runs dist/index.js
```

### Other Scripts

```bash
npm run check   # Type-check only (tsc, no emit)
npm run db:push # Drizzle schema push (legacy; data flows through Supabase, not Drizzle)
```

## Tabbed Views

The leaderboard is organized into preset tabs, each pre-filtering rows and/or columns. The general groups:

| Tab | Purpose |
|-----|---------|
| **All Models** | Every model/agent pair (duplicates and blacklisted hidden by default) |
| **Base Models** | Only base (untrained-on) models |
| **A1 … G1** | Curated experiment/pipeline groups |
| **OOD** | Out-of-distribution benchmark set |
| **WAR** | Curated headline comparison — a fixed, sectioned ordering of key models |
| **Table 1** | Paper Table-1 model sections |
| **Scaling** | Scaling-study rungs |
| **8B RL** | An 8B base model plus everything RL-trained on top of it |
| **Baseline Data** | Baseline reference data |
| **Missing Eval** | Models still missing expected evaluations (computed after duplicate merge) |
| **Guardrail** | Evals flagged Incomplete or High-Error |
| **Filtered View** | Free-form search/filter + Top-N / Most-Recent view modes |
| **Active** | Currently active (non-blacklisted) models |
| **Blacklisted** | Blacklisted models only |

Benchmark groupings (Core vs OOD vs other) and the default visible set live in `client/src/config/benchmarkConfig.ts`; the blacklist lives in `client/src/config/blacklistedModels.ts`.

## Usage

1. **Open** http://localhost:5000
2. **Pick a tab** to scope the view
3. **Search / Filter** by model, agent, base model, or benchmark
4. **Sort** by clicking column headers; toggle `Acc`/`Imp` per benchmark
5. **Toggle duplicates** with the "Show duplicate models / benchmarks" checkboxes
6. **Refresh** to fetch the latest data (data is cached with infinite stale time)

## Data Upload

Evaluation results are written by the `dcagents-leaderboard/unified_db` Python package, not this repo:

```python
from unified_db import upload_eval_results

result = upload_eval_results(
    job_dir="path/to/evaluation/results",
    username="your-email@example.com",
    error_mode="rollback_on_error",
    register_benchmark=True  # Auto-register benchmarks/tasks
)
```

See the `unified_db` README for detailed upload instructions.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  React Frontend (Vite, port 5000)                    │
│  - Tabbed views, search/filter/sort, improvement UI  │
│  - TanStack Query (infinite stale time)              │
│  - All filtering/sorting happens client-side         │
└───────────────────────┬──────────────────────────────┘
                        │ GET /api/leaderboard-pivoted-with-improvement
                        ↓
┌──────────────────────────────────────────────────────┐
│  Express Server (server/index.ts → routes.ts)        │
│  - Pivots flat view rows into (model, agent) rows    │
│  - storage.ts (DbStorage) wraps Supabase queries     │
└───────────────────────┬──────────────────────────────┘
                        │ Query leaderboard_results view
                        ↓
┌──────────────────────────────────────────────────────┐
│  Supabase (PostgreSQL)                               │
│  - leaderboard_results VIEW (merge-then-threshold)   │
│  - sandbox_jobs, agents, models, benchmarks, …       │
│  - Edge Function: notify-new-model (Resend email)    │
└──────────────────────────────────────────────────────┘
```

**Path aliases:** `@/` → `client/src/`, `@shared/` → `shared/`, `@db` → `server/db.ts`.

### API Endpoints

All endpoints are under `/api` and query the `leaderboard_results` view:

- `GET /api/leaderboard-pivoted-with-improvement` — **Primary endpoint.** Pivoted rows with improvement metrics and duplicate/canonical metadata (used by the frontend)
- `GET /api/leaderboard-pivoted` — Pivoted rows without improvement metrics
- `GET /api/benchmark-results`, `GET /api/benchmark-results/:id` — Flat results (legacy)

## Project Structure

```
OT-Agent-Leaderboard/
├── client/                              # React + TypeScript + Vite frontend
│   └── src/
│       ├── components/
│       │   ├── LeaderboardTableWithImprovement.tsx   # Main table (improvement, duplicate merge, sort)
│       │   ├── LeaderboardTable.tsx                  # Simpler pivoted table (legacy)
│       │   ├── FilterControlsWithBaseModel.tsx       # Filter dropdowns
│       │   ├── SearchBarWithBaseModel.tsx            # Search inputs
│       │   ├── FilterControls.tsx / SearchBar.tsx    # Earlier variants
│       │   ├── ViewModeControls.tsx                  # Top-N / Most-Recent controls
│       │   ├── ThemeToggle.tsx
│       │   └── ui/                                   # shadcn/ui primitives
│       ├── pages/
│       │   ├── Leaderboard.tsx                       # Main page: tabs, state, filters
│       │   └── not-found.tsx
│       ├── config/
│       │   ├── benchmarkConfig.ts                    # Core/OOD groups, default visible, exclusions
│       │   └── blacklistedModels.ts                  # Blacklisted model list
│       ├── lib/        (queryClient.ts, utils.ts)
│       └── hooks/      (use-mobile.tsx, use-toast.ts)
├── server/                              # Express + TypeScript backend
│   ├── index.ts                         # Server entry point
│   ├── routes.ts                        # API endpoints + pivoting logic
│   ├── storage.ts                       # DbStorage / Supabase queries + interfaces
│   ├── db.ts                            # Supabase client
│   └── vite.ts                          # Vite middleware (dev)
├── shared/
│   └── schema.ts                        # Shared types + Zod/Drizzle schemas
├── supabase/
│   └── functions/notify-new-model/      # Edge Function: email on new model (Resend)
├── scripts/                             # Maintenance/analysis scripts
├── migrations/                          # Drizzle migrations (legacy)
├── create_leaderboard_view.sql          # Supabase view definition
├── design_guidelines.md                 # UI/design principles
├── PROGRESS.md                          # Development changelog
├── CLAUDE.md                            # Architecture & development guide
├── SUPABASE_SETUP.md                    # Detailed Supabase setup
├── .env                                 # Environment variables (create this; gitignored)
└── package.json
```

### Adding New Features

**Add a new metric/field to the table** (the recurring 5-file pattern):
1. Expose it in `create_leaderboard_view.sql`
2. Add it to the interfaces in `server/storage.ts`
3. Include it in the API response in `server/routes.ts`
4. Render it in `client/src/components/LeaderboardTableWithImprovement.tsx`
5. Update shared types in `shared/schema.ts` if needed

**Change sorting/filtering:**
- Sorting/duplicate-merge → `LeaderboardTableWithImprovement.tsx`
- Filter UI → `FilterControlsWithBaseModel.tsx` / `SearchBarWithBaseModel.tsx`
- Tab/filter state → `Leaderboard.tsx`

**Add/adjust a benchmark group or default columns:** `client/src/config/benchmarkConfig.ts`.

## Troubleshooting

### "SUPABASE_URL must be set"
- Ensure `.env` exists in the project root and `SUPABASE_URL` is set
- Restart the dev server after editing `.env`

### "relation 'leaderboard_results' does not exist"
- Run `create_leaderboard_view.sql` in the Supabase SQL Editor
- Verify: `SELECT * FROM leaderboard_results LIMIT 1;`

### "cannot change name of view column" when updating the view
- `create_leaderboard_view.sql` already includes `DROP VIEW IF EXISTS leaderboard_results CASCADE;` — just run the whole script

### "No results found" in the leaderboard
- `SELECT COUNT(*) FROM sandbox_jobs WHERE metrics IS NOT NULL;`
- Verify metrics shape: `SELECT metrics FROM sandbox_jobs WHERE metrics IS NOT NULL LIMIT 1;` (array of `{name, value}`)
- Ensure jobs link to agents, models, and benchmarks via foreign keys

### Port already in use
- `PORT=5001 npm run dev`, or `lsof -ti:5000 | xargs kill`

### npm install issues (macOS ARM64)
If you see `Cannot find module @rollup/rollup-darwin-arm64`:

```bash
rm -rf node_modules package-lock.json
npm install
```

If it persists, `yarn install` handles optional native deps more reliably than npm on ARM64.

## Changelog

See [`PROGRESS.md`](PROGRESS.md) for the full development log. Recent themes (2026):

- **Feb 2026** — Default-benchmark changes, training-time vs eval-time agent display, merge-then-threshold selection logic, result-selection info section, "show models without evaluations"
- **Jan 2026** — Duplicate benchmark & model handling, duplicate-aware improvement signal, configurable "Top N Performers by benchmark", full-width layout
- **Nov 2025** — Improvement metrics, frozen columns + dual scrollbars, timestamp & legend enhancements, benchmark exclusion system
- **Oct–Nov 2025** — Initial Supabase integration and data aggregation

Additional tabs (Scaling rungs, **8B RL**) and benchmark groupings have been added on top of the logged history.

## Documentation

- **Architecture & Dev Guide** — [`CLAUDE.md`](CLAUDE.md)
- **Supabase Setup** — [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md)
- **Changelog** — [`PROGRESS.md`](PROGRESS.md)
- **View SQL** — [`create_leaderboard_view.sql`](create_leaderboard_view.sql)
- **Design Principles** — [`design_guidelines.md`](design_guidelines.md)

## License

MIT
