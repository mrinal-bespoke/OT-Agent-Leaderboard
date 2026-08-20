# Leaderboard taxonomy — design

Status: **design only, nothing implemented**
Branch: `feat/non-agentic-tabs`
Policy: marin-community/marin#7958 (Marin Eval Policy)
Supabase: read-only for verification. No schema, view, or row changes proposed for V1.

---

## 0. What the database actually contains

Verified read-only against the DC Agent project. This grounds every decision below.

**20 canonical benchmarks carry jobs:**

| Canonical name | Jobs | Metrics present |
| --- | --- | --- |
| `swebench-verified-random-100-folders` | 2592 | accuracy, accuracy_stderr, (+drop_ei variants) |
| `terminal_bench_2` | 2127 | accuracy, accuracy_stderr, (+drop_ei variants) |
| `dev_set_71_tasks` | 1486 | accuracy, accuracy_stderr |
| `dev_set_v2` | 1333 | accuracy, accuracy_stderr, (+drop_ei variants) |
| `bfcl-parity` | 819 | accuracy, accuracy_stderr |
| `medagentbench` | 190 | accuracy, accuracy_stderr |
| `aider_polyglot` | 178 | accuracy, accuracy_stderr |
| `gaia_127` | 148 | accuracy, accuracy_stderr |
| `financeagent_terminal` | 141 | accuracy, accuracy_stderr |
| `swebench-verified` | 104 | accuracy, accuracy_stderr |
| `clean-sandboxes-tasks-eval-set` | 88 | accuracy, accuracy_stderr |
| `evoeval` | 8 | accuracy, accuracy_stderr |
| `autocodebench` | 5 | accuracy, accuracy_stderr |
| `deveval` | 2 | accuracy |
| `codepde` | 2 | accuracy, accuracy_stderr |
| `financeagent` | 1 | accuracy |
| `IFEval` | 1 | accuracy, accuracy_stderr, prompt/inst × strict/loose |
| `MATH500` | 1 | accuracy **only** |
| `tb2_smoke3` | 1 | accuracy, accuracy_stderr |
| `0c553bd6d05d451907afb8db31dba84759ccc993` | 1 | accuracy |

**Aliasing is heavy and load-bearing.** `swebench-verified-random-100-folders` has 25 aliases,
`terminal_bench_2` has 22, `dev_set_v2` has 15. Aliases include raw SHAs, per-run names, and
`_2.0x` / `_16.0x` timeout-multiplier variants that are merged into the canonical benchmark.
Canonicalization already happens upstream of the UI and must not be duplicated or bypassed.

**Status mix is real:** `dev_set_v2` alone is 1281 Finished / 22 Started / 23 Failed / 7 Pending.
Any design that assumes "a row has a score" is wrong.

### Resolution (decided)

**The Agentic tab does not change at all.** It keeps every benchmark it shows today, including
the seven non-core ones, and keeps its existing columns, tab strip, filters and defaults.
Non-agentic becomes a genuinely new, additive tab.

This is compatible with "Agentic must show exactly these three" read as a rule about the
*canonical headline set* rather than a mandate to remove 3,166 jobs of live data. If removal
was actually intended, that is a separate, deliberate deprecation — not something to smuggle
into a taxonomy change.

The exclusion bug is still fixed, by a different route: instead of *deriving* Agentic as
"everything left over", the registry **enumerates** it, seeded from exactly what the Agentic
tab renders today. Display is byte-identical; the difference is that an unrecognised benchmark
no longer silently joins it.

**The trade this makes, stated plainly.** Under exclusion, a newly added *agentic* benchmark
appears automatically and a newly added *non-agentic* one is silently misrouted onto the
Agentic board (today's bug).

Under an enumerated registry, **any** unregistered benchmark — agentic or non-agentic —
becomes visibly `unclassified` until someone adds a registry row. It is *not* auto-classified
into the right track; nothing infers a track from a name. That is the intended behaviour: the
registry is the only source of track membership, and an unrecognised name means "nobody has
said where this goes yet", not "guess".

So the trade is a silent wrong answer swapped for a visible missing one. That is acceptable
*only because* unclassified benchmarks carry a visible count (§4): a new benchmark of either
kind shows up as `1 unclassified` within a sweep, prompting registration. Without that counter
this trade would be a bad one.

---

## 1. Information architecture

Two orthogonal axes. They must not be flattened into one tab strip — the current page already
has ~20 tabs mixing filters, cohorts, reports and quality lenses, and it scrolls horizontally.

```
Track      (2)   Agentic | Non-agentic          <- evaluation protocol
Capability (n)   view within the selected track  <- what is being measured
```

Everything else already on the page (model cohorts, Guardrail, Missing Eval, blacklist,
search, filters) is a **filter over models** and stays exactly where it is.

### Wireframe

```
┌────────────────────────────────────────────────────────────────────────────┐
│ LLM Agent Benchmark                              [Refresh] [◐]             │
├────────────────────────────────────────────────────────────────────────────┤
│ Track:  ( Agentic )  ( Non-agentic )                                       │
├────────────────────────────────────────────────────────────────────────────┤
│ AGENTIC  — unchanged from today                                            │
│   Result Selection: (Oldest)(Latest)(Highest)(All)                         │
│   …existing tab strip, filters, checkboxes, columns, all untouched…        │
│                                                                            │
│ NON-AGENTIC — new                                                          │
│   View: [Overview][Math][Code][Knowledge][Instruction][Long ctx][Domain]   │
│   # │ MODEL │ PARAMS │ <benchmarks of selected capability> │ COVERAGE │    │
└────────────────────────────────────────────────────────────────────────────┘
```

Only one control is added to the existing page: the two-way `Track` toggle. Everything below
it on the Agentic side is exactly what ships today. The capability chips exist solely inside
the new Non-agentic track, so the ~20-tab strip is not made worse and is not reorganised as
part of this change.

## 2. Benchmark → capability mapping (from #7958)

Names are the **policy spelling**. Where the database currently disagrees, that is called out
as a reconciliation item, not silently aliased.

### Agentic track — enumerated from what renders today

The registry is **seeded from the current display**, not from #7958. Every canonical benchmark
that the Agentic tab shows today gets `track: 'agentic'`, so the rendered result is unchanged.

| Group | Benchmarks (canonical DB name) | Today |
| --- | --- | --- |
| policy core | `dev_set_v2`, `swebench-verified-random-100-folders`, `terminal_bench_2` | shown |
| existing OOD | `swebench-verified`, `bfcl-parity`, `aider_polyglot`, `gaia_127`, `medagentbench`, `financeagent_terminal` | shown |
| other existing | `dev_set_71_tasks`, `clean-sandboxes-tasks-eval-set`, `evoeval`, `autocodebench`, `deveval`, `codepde`, `financeagent` | shown |
| policy, not yet present | SimpleQA, DS-1000, τ³-Banking | absent |

`CORE_BENCHMARKS` and `OOD_BENCHMARKS` in `client/src/config/benchmarkConfig.ts` stay exactly
as they are and continue to drive Agentic column selection. The registry does not replace them
in V1; it only decides *track membership*, which is the part that was broken.

### Non-agentic track

| Capability | Benchmarks | Source | In DB |
| --- | --- | --- | --- |
| `math` | `MATH500`, `AIME24`, `gsm8k` | evalchemy + lm-eval | MATH500 only |
| `code` | `HumanEvalPlus`, `MBPPPlus`, `CruxEval` | evalchemy | no |
| `knowledge` | `MMLU-Pro`, `GPQA Diamond`, `OlympiadBench`, `mmlu`, `hellaswag`, `arc_challenge`, `arc_easy`, `piqa`, `winogrande`, `openbookqa`, `boolq`, `truthfulqa_mc2`, `lambada_openai`, `triviaqa`, `nq_open`, `drop` | evalchemy + lm-eval | no |
| `instruction` | `IFEval`, `IFBench` | evalchemy | `IFEval` only (`IFBench` has no rows yet) |
| `longcontext` | `MRCR` | evalchemy | no |
| `domain` | `FinanceBench` | evalchemy | no |
| `passk` | derived view, not a benchmark set | — | — |

**Reconciliation items (human decisions, not code):**

1. `IFEval` and `IFBench` are **distinct benchmarks, not spellings of one**. Both sit under
   Instruction following and both get their own registry row: `IFEval` as `off-policy` (we run
   it; #7958 does not name it) and `IFBench` as `development` per #7958. Neither aliases the
   other, and a future `IFBench` import must not be merged into the existing `IFEval` rows.
2. `dev_set_71_tasks` (1,486 jobs) is not in #7958 at all. Mapped to agentic `ood`,
   `policyStatus: 'legacy'`.
3. `tb2_smoke3`, `financeagent` (1 job), and the SHA-named benchmark are noise. They land in
   `unclassified` and become visible for cleanup rather than silently joining a real tab.

---

## 3. The benchmark registry

One shared, static, hand-maintained table. **No database table** — the registry is policy, and
policy belongs in reviewed source, not in mutable rows.

```ts
// shared/benchmark-registry.ts

export type Track = 'agentic' | 'non-agentic' | 'unclassified';

export type Capability =
  | 'core' | 'ood'                                            // agentic
  | 'math' | 'code' | 'knowledge' | 'instruction'
  | 'longcontext' | 'domain' | 'passk'                        // non-agentic
  | 'unclassified';

export type PolicyStatus =
  | 'policy'       // named in #7958 as an active benchmark
  | 'development'  // named in #7958, marked development (e.g. IFBench)
  | 'off-policy'   // real eval we run, not named in #7958 (e.g. IFEval)
  | 'legacy'       // predates the policy, kept for history
  | 'noise';       // smoke tests, SHA names — surface for cleanup

export interface BenchmarkEntry {
  /** Canonical DB name. The join key. */
  canonicalName: string;
  /** Short column header, e.g. 'SWE-100'. */
  displayName: string;
  /**
   * Extra spellings NOT already merged by benchmarks.duplicate_of.
   * Normally empty: duplicate_of is the source of truth and this is only for
   * names that must map without a DB write.
   */
  aliases: readonly string[];
  track: Track;
  capability: Capability;
  /** Metric key used as the headline. Defaults to 'accuracy'. */
  primaryMetric: string;
  /** Optional stderr key. Absent means the cell shows no ± at all. */
  stderrMetric?: string;
  policyStatus: PolicyStatus;
  /** Column order within its capability. Lower first. */
  order: number;
  /** Protocol, for the badge and for refusing to average across protocols. */
  protocol?: { seeds?: number; shots?: number; temperature?: number };
  /** pass@k values this benchmark can report. Empty = pass@1 only. */
  passAtK?: readonly number[];
}

export const BENCHMARK_REGISTRY: readonly BenchmarkEntry[];

/** Registry lookup. Unknown -> undefined, never a guessed default. */
export function lookupBenchmark(canonicalName: string): BenchmarkEntry | undefined;

/** Track for a name. Unknown -> 'unclassified'. NEVER 'agentic'. */
export function trackOf(canonicalName: string): Track;

export function capabilityOf(canonicalName: string): Capability;
```

Illustrative rows:

```ts
{ canonicalName: 'swebench-verified-random-100-folders', displayName: 'SWE-100',
  aliases: [], track: 'agentic', capability: 'core',
  primaryMetric: 'accuracy', stderrMetric: 'accuracy_stderr',
  policyStatus: 'policy', order: 20 },

{ canonicalName: 'MATH500', displayName: 'MATH500',
  aliases: [], track: 'non-agentic', capability: 'math',
  primaryMetric: 'accuracy',            // no stderrMetric: none is reported
  policyStatus: 'policy', order: 10,
  protocol: { seeds: 1, shots: 0, temperature: 0.7 } },

// IFEval and IFBench are DIFFERENT benchmarks that share a capability.
// Both are registered; neither aliases the other.
{ canonicalName: 'IFEval', displayName: 'IFEval',
  aliases: [], track: 'non-agentic', capability: 'instruction',
  primaryMetric: 'prompt_level_strict_acc', stderrMetric: 'accuracy_stderr',
  policyStatus: 'off-policy', order: 10 },

{ canonicalName: 'IFBench', displayName: 'IFBench',
  aliases: [], track: 'non-agentic', capability: 'instruction',
  primaryMetric: 'accuracy', stderrMetric: 'accuracy_stderr',
  policyStatus: 'development', order: 20 },   // no rows yet
```

Note `IFEval.primaryMetric` names `prompt_level_strict_acc` **explicitly** rather than relying
on `accuracy` happening to equal it. That equality is an importer convention today; naming the
metric makes the headline correct by construction.

---

## 4. Unknown benchmark names

The current rule — agentic by exclusion — is the defect. It is silent, and it puts unknown
things in the most visible place.

**Rule: unknown ⇒ `track: 'unclassified'`, `capability: 'unclassified'`. Never agentic.**

- Neither top-level track renders unclassified benchmarks.
- The count is surfaced: a muted `3 unclassified benchmarks` line with a hover listing names.
  Visible enough to fix, quiet enough not to mislead.
- Rows are never dropped from the database or from the API — only from the two curated tracks.
- A `?track=unclassified` view exists for maintainers.

This converts every future IFEval-class incident from a silent misclassification into a visible
to-do, which is the whole point of the change.

---

## 5. Agentic table — unchanged

No column, ordering, row-identity or default change. The table that ships today is the table
that ships after V1.

- **Columns:** exactly as today, driven by `benchmarkConfig.ts` and the existing benchmark
  filter. `DEV / SWE-100 / TB2` remain the default visible set via `DEFAULT_VISIBLE_BENCHMARKS`.
- **Row identity:** `(canonicalAgentId, modelId)` — untouched, so dedup, base-model
  improvement, trace links, guardrail flags and the selection modes are unaffected.
- **`ID mean` / `ID SE`:** the policy asks for them, but adding columns would change the
  Agentic tab. Deferred to V3 and only with explicit sign-off.

The only behavioural difference is invisible: track membership now comes from an enumerated
registry rather than from "not in the math/nlp lists". For every benchmark that exists today
these give identical answers — which is exactly what the V1 gate asserts (§10).

## 6. Non-agentic table

**Columns:** `# | MODEL | PARAMS | <capability benchmarks> | COVERAGE | TRAINING TYPE | LATEST EVAL`

- `PARAMS` maps to the existing `modelSizeB` (policy says `params`; the field already exists).
- `AGENT` is dropped — it is always the harness (`evalchemy`) and carries no signal here.
  It stays available as a filter.
- `COVERAGE` is `n_scored / n_benchmarks_in_capability`, e.g. `1/3`. Without it a model
  evaluated on one of three math benchmarks looks comparable to one evaluated on all three.

**Capability switching** re-fetches (`?track=&capability=`) rather than filtering client-side,
because selection/dedup/improvement must be computed within the visible set — the same reason
the current family filter runs server-side before pools are built.

**Row identity: `(modelId)`** for non-agentic, since the harness is constant. This differs from
agentic by design and must be stated explicitly in the code, or someone will "unify" them and
silently merge rows.

**Overview** is a capability view whose columns are one representative benchmark per capability
(registry `order: 10` within each), plus coverage. It is a reading aid, not a new aggregate —
**no composite score in V1.** A mean over incomparable benchmarks is worse than no number.

---

## 7. Result states

| State | Detection | Display |
| --- | --- | --- |
| **Missing** | no job for (model, benchmark) | empty cell — never `0`, never `—` styled as a score |
| **Zero** | Finished, `accuracy == 0` | `0.0%` as a real score, visually identical to any other |
| **Running** | `job_status` Started/Pending | existing progress treatment, unchanged |
| **Partial** | `is_overlong`, or guardrail `isIncomplete` | existing red/bold + Incomplete flag, unchanged |
| **Failed** | `job_status = 'Failed'` | excluded from selection (already true), counted in coverage denominator as unscored |
| **No stderr** | `stderrMetric` absent or metric null | render **no ±** at all |
| **Mixed protocol** | rows differing in seeds/shots/temperature | show the winning row's badge; never average across protocols |

Two notes.

`accuracy == 0` and "no result" must remain visually distinct. The current `?? 0` in
`server/storage.ts` collapses a missing standard error into `±0.00`, which asserts perfect
precision — MATH500 shows this today. Fixing it requires widening `standardError` to
`number | null`, which is inherited as `notNull()` from the **dead legacy Drizzle table** in
`shared/schema.ts`, so it needs `Omit<BenchmarkResult, 'standardError'>`. Small but not
one-character. **Scheduled in V2**, not V1: it is the only proposed change that could alter an
Agentic cell, and V1 is a strict zero-diff release.

Mixed protocol is already live: `_2.0x` and `_16.0x` timeout variants are merged into their
canonical benchmark by `duplicate_of`. That merging is existing behavior and V1 does not change
it — but the registry's `protocol` field exists so a later version can separate them.

---

## 8. Is `accuracy` / `standardError` enough for V1?

**Yes for the agentic track, and yes for non-agentic V1 — with one fix and one caveat.**

- All three agentic benchmarks report `accuracy` + `accuracy_stderr` on every job. No change.
- 18 of 20 canonical benchmarks report `accuracy`; 16 also report `accuracy_stderr`.
- `MATH500` reports **`accuracy` only** ⇒ the `?? 0` fix in §7 is required before the
  Non-agentic tab is visible, or every stderr-less benchmark claims `±0.00`. Scheduled in
  **V2**, alongside the tab itself, so V1 stays a strict Agentic zero-diff.
- `IFEval` reports six metrics. V1 shows `prompt_level_strict_acc` as the headline via
  `primaryMetric`; the other five stay in the database untouched and unshown.

**Not sufficient for pass@k or multi-metric display.** Neither the SQL view nor
`RawLeaderboardRow` carries the raw `metrics` array — both project it down to two numbers. Any
pass@k or metric-picker UI needs that array plumbed through. That is V4, and it is a
*plumbing* change (add `metrics` to the row type), not a schema change.

---

## 9. API and SQL views

**API — one parameter change, backward compatible:**

```
GET /api/leaderboard-pivoted-with-improvement
      ?mode=…&hideNoTraceLink=…
      &track=agentic|non-agentic|unclassified     (default: agentic)
      &capability=core|ood|math|…                 (default: track's first view)
```

`family` is replaced by `track` + `capability`. Keep `family` accepted for one release mapping
`math`/`nlp` → `non-agentic` + capability, then remove. No other endpoint changes.

**SQL views — keep everything. Delete nothing.**

`create_standard_leaderboard_views.sql` (`math_leaderboard_results`, `nlp_leaderboard_results`)
stays in the branch and stays installed wherever it already is. It is unused by the runtime —
classification happens in TypeScript over names the server already has — but deleting a view is
an irreversible action against a shared database whose only benefit is tidiness. An unused view
costs nothing and preserves the zero-diff guarantee absolutely.

It should be marked superseded in a comment so nobody edits it expecting an effect, and
retired later as a deliberate cleanup, separate from this change.

`create_leaderboard_view.sql` also stays — it still holds the stable-id fix.

`create_leaderboard_view.sql` **stays** — it still holds the stable-id fix, which is needed
whenever `LEADERBOARD_DATA_SOURCE` returns to `view`.

**No Supabase writes in V1.** No new table, no re-registration, no row edits.

---

## 10. Backward compatibility and rollout

**Invariant: the three agentic benchmarks are score-for-score unchanged.**

They are unaffected by construction — same data path, same row identity, same selection logic;
only the column set is chosen differently. The V1 gate is a byte-comparison, not an assertion.

Rollout:

1. Land the taxonomy fix (§12 V1) behind the existing default (`track=agentic`,
   `capability=core`). Default response is identical to today's agentic response.
2. Capture the current agentic payload, deploy, re-capture, `diff`. Any difference in the three
   benchmarks is a **rollback**, not a discussion.
3. Non-agentic ships hidden until it has real data beyond the two seeded rows — an empty public
   tab invites "the leaderboard is broken" more than it invites contributions.
4. `family` stays accepted for one release so any saved link keeps working.

Rollback is a redeploy; there is no migration to reverse.

---

## 11. Regression tests

Extending `tests/leaderboard-row-builder.test.ts` and a new `tests/benchmark-registry.test.ts`.

**Taxonomy**
- every registry entry has a unique `canonicalName`
- every `canonicalName` and alias is unique across the whole registry
- unknown name ⇒ `unclassified`, and explicitly **not** `agentic` (the IFEval regression)
- an unregistered *non-agentic-looking* name is also `unclassified` — nothing infers a track
  from a name, in either direction
- `IFEval` and `IFBench` resolve to two distinct entries, both `instruction`; neither is an
  alias of the other, and merging them fails the test
- misspellings (`MATH-500`, `ifeval`, `Terminal_Bench_2`) ⇒ `unclassified`
- the SHA-named benchmark and `tb2_smoke3` ⇒ `unclassified`
- every benchmark with jobs in the DB is either in the registry or intentionally unclassified
  (a fixture list, so a new benchmark appearing in production fails a test rather than a tab)

**Agentic invariant**
- `capability: 'core'` yields exactly the three, in DEV / SWE-100 / TB2 order
- no non-agentic benchmark can enter the agentic track for any input
- a fixed fixture of agentic rows produces byte-identical output before and after the change

**Non-agentic**
- IFEval headline is `prompt_level_strict_acc`, and is below both loose (36.97%) and
  instruction-level (45.56%) — already covered, keep
- MATH500 with no stderr renders **no ±**, not `±0.00`
- coverage counts scored benchmarks, not rows
- a model with zero benchmarks in a capability does not appear in that view

**States**
- Failed excluded from selection but counted in coverage denominator
- `accuracy == 0` is distinguishable from missing
- Pending/Started carry no score

---

## 12. Staged plan

### V1 — taxonomy fix (required; additive only; Agentic renders identically)
1. Add `shared/benchmark-registry.ts`, **seeded from what Agentic shows today** (§2) plus the
   non-agentic entries.
2. Replace exclusion-based `inFamily` with registry lookup; unknown ⇒ `unclassified`,
   never agentic.
3. Server filters by `track` (+ `capability` for non-agentic) before pools are built, as
   `family` does today.
4. Leave every SQL view and view definition in place, including the unused Math/NLP views.
   V1 performs no Supabase action of any kind.
5. Tests per §11.
6. **Gate: the Agentic payload is byte-identical before and after.**

V1 deliberately contains **no change that can alter an Agentic cell**. The
`standardError ?? 0` fix is excluded for exactly that reason — see V2.

### V2 — the new Non-agentic tab
Two-way Track toggle. Agentic side untouched. Non-agentic ships with the capability chips and
whatever data exists; hidden by default until it has more than the seeded rows.

Also lands here: **fix `standardError ?? 0` ⇒ `null`** (§7), so a benchmark reporting no
standard error shows no `±` instead of claiming `±0.00`. Moved out of V1 to keep that release
a strict Agentic zero-diff.

The ordering works out: `MATH500` is the only current row without a stderr, and it is only
user-visible once this tab ships — so the wart and its fix arrive in the same release. It does
mean that if the Non-agentic tab is ever demoed from a V1 build, MATH500 will read
`71.0% ±0.00`; that figure is an artefact, not a measurement.

### V3 — non-agentic capability views, fully populated
Overview / Math / Code / Knowledge / Instruction / Long-context / Domain, `COVERAGE`, `PARAMS`.
Lands with the importer. Agentic `ID mean` / `ID SE` may land here **only** with explicit
sign-off, since it is the first change to the Agentic table.

### V4 — rich metrics and pass@k
Plumb the raw `metrics` array through `RawLeaderboardRow`; metric picker; pass@k view driven by
`passAtK`. First stage needing a data-shape change (still no schema change).

### V5 — AA-II coverage
The remaining #7958 benchmarks as they are imported: HumanEvalPlus, MBPPPlus, OlympiadBench,
MMLU-Pro, GPQA Diamond, CruxEval, FinanceBench, IFBench, MRCR, SimpleQA, DS-1000, τ³-Banking.
Each is a registry row plus a test — no code change, which is the point of the registry.

## Open decisions for a human

1. ~~`IFEval` vs `IFBench`~~ — **decided: distinct benchmarks, both Instruction following.
   `IFEval` = `off-policy`, `IFBench` = `development` per #7958. Separate registry rows,
   never aliased to each other.**
2. ~~The 7 non-core agentic benchmarks~~ — **decided: Agentic keeps everything it shows
   today; Non-agentic is a new additive tab.**
3. **`ID mean` / `ID SE`** — confirm the z-score definition matches the policy's intent before
   V3 implements it. Deferred; it would be the first change to the Agentic table.
4. ~~Noise rows~~ — **decided: never touched in Supabase. Surfaced only through the audit
   count, never deleted or re-registered.**
