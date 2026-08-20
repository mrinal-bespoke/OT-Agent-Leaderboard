import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ExternalLink, AlertCircle, AlertTriangle, Download, StickyNote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BLACKLISTED_MODELS } from '@/config/blacklistedModels';
import { DEFAULT_VISIBLE_BENCHMARKS, compareBenchmarks, classifyBenchmark } from '@/config/benchmarkConfig';

// Hide scrollbar while keeping scroll functionality
const scrollbarHidingStyles = `
  .hide-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .hide-scrollbar::-webkit-scrollbar {
    display: none;
  }
`;

export interface PivotedLeaderboardRowWithImprovement {
  modelName: string;
  agentName: string;
  trainingAgentName: string;
  isNoEval: boolean;
  firstEvalEndedAt?: string;
  latestEvalEndedAt?: string;
  modelCreatedAt?: string;
  modelId: string;
  baseModelName: string;
  // Training type
  trainingType?: string;
  // Model size in billions
  modelSizeB?: number;
  // Duplicate tracking fields
  modelDuplicateOf: string | null;
  canonicalModelName: string;
  agentDuplicateOf: string | null;
  canonicalAgentName: string;
  canonicalBaseModelName: string;
  benchmarks: Record<string, {
    accuracy: number | null;
    standardError: number | null;
    hfTracesLink?: string;
    baseModelAccuracy?: number;
    improvement?: number;
    // Additional accuracy values for duplicate-aware improvement recalculation
    canonicalBenchmarkBaseModelAccuracy?: number;
    canonicalBaseModelAccuracy?: number;
    canonicalBothBaseModelAccuracy?: number;
    // Duplicate tracking for benchmarks
    benchmarkDuplicateOf: string | null;
    canonicalBenchmarkName: string;
    // Source benchmark (tracks which actual benchmark the result came from)
    sourceBenchmarkName?: string;
    sourceBenchmarkId?: string;
    // Eval config metadata
    timeoutMultiplier?: number;
    daytonaOverrideCpus?: number;
    daytonaOverrideMemoryMb?: number;
    daytonaOverrideStorageMb?: number;
    autoSnapshot?: boolean;
    // Job status for progress tracking
    jobStatus?: string | null;
    username?: string | null;
    slurmJobId?: string | null;
    jobCreatedAt?: string;
    isOverlong?: boolean;
    isIncomplete?: boolean;
    isHighErrors?: boolean;
    invalidErrorCount?: number;
    completedTrials?: number;
    totalTrials?: number;
    // Free-text note from the job
    notes?: string;
    // "All" mode: array of all results for cycling through
    allResults?: Array<{
      accuracy: number | null;
      standardError: number | null;
      hfTracesLink?: string;
      baseModelAccuracy?: number;
      improvement?: number;
      canonicalBenchmarkBaseModelAccuracy?: number;
      canonicalBaseModelAccuracy?: number;
      canonicalBothBaseModelAccuracy?: number;
      benchmarkDuplicateOf: string | null;
      canonicalBenchmarkName: string;
      sourceBenchmarkName?: string;
      sourceBenchmarkId?: string;
      timeoutMultiplier?: number;
      daytonaOverrideCpus?: number;
      daytonaOverrideMemoryMb?: number;
      daytonaOverrideStorageMb?: number;
      autoSnapshot?: boolean;
      jobStatus?: string | null;
      username?: string | null;
      slurmJobId?: string | null;
      jobCreatedAt?: string;
      isOverlong?: boolean;
      isIncomplete?: boolean;
      isHighErrors?: boolean;
      invalidErrorCount?: number;
      completedTrials?: number;
      totalTrials?: number;
      notes?: string;
    }>;
  }>;
}

interface LeaderboardTableWithImprovementProps {
  data: PivotedLeaderboardRowWithImprovement[];
  modelSearch: string;
  agentSearch: string;
  baseModelSearch: string;
  benchmarkSearch: string;
  filters: {
    models: string[];
    agents: string[];
    trainingAgents: string[];
    baseModels: string[];
    benchmarks: string[];
    trainingTypes: string[];
    modelSizes: string[];
  };
  /**
   * Benchmark columns to render even when no row has a result for them.
   * Used by the non-agentic track so an unevaluated capability shows as an
   * empty column rather than vanishing. Omit for the agentic track.
   */
  forcedBenchmarks?: string[];
  // Duplicate display controls
  showDuplicateBenchmarks: boolean;
  showDuplicateModels: boolean;
  showDuplicateAgents: boolean;
  // When true, only show models missing a finished eval on at least one default benchmark
  filterMissingEval?: boolean;
  // When true, hide blacklisted models
  hideBlacklisted?: boolean;
  // When true, hide base models (baseModelName === 'None')
  hideBaseModels?: boolean;
  // When provided, rows are sorted by this list's index (models not in the list go to the end).
  // Overrides the default sort; column sort still works if the user clicks a header.
  customOrder?: string[];
  // When provided with customOrder, a section header row is inserted when the section changes.
  // Keys are model names, values are section labels.
  sectionByModel?: Record<string, string>;
}

type SortField = 'modelName' | 'agentName' | 'baseModelName' | 'trainingType' | 'modelCreatedAt' | 'firstEvalEndedAt' | 'latestEvalEndedAt' | string; // string for dynamic benchmark names
type SortDirection = 'asc' | 'desc' | null;
type SortMode = 'accuracy' | 'improvement';

function formatModelSize(sizeB: number): string {
  return `${Math.floor(sizeB)}B`;
}

function modelSizeColor(sizeB: number): string {
  const s = Math.floor(sizeB);
  switch (s) {
    case 8: return 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300';
    case 32: return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
    case 4: return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
    case 14: return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300';
    case 7: return 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300';
    case 72: return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
    case 30: return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300';
    case 2: return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300';
    default: return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  }
}

export default function LeaderboardTableWithImprovement({
  data,
  modelSearch,
  agentSearch,
  baseModelSearch,
  benchmarkSearch,
  filters,
  forcedBenchmarks,
  showDuplicateBenchmarks,
  showDuplicateModels,
  showDuplicateAgents,
  filterMissingEval,
  hideBlacklisted,
  hideBaseModels,
  customOrder,
  sectionByModel
}: LeaderboardTableWithImprovementProps) {
  const hasCustomOrder = !!customOrder && customOrder.length > 0;
  const [sortField, setSortField] = useState<SortField>(hasCustomOrder ? 'modelName' : 'modelCreatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>(hasCustomOrder ? null : 'desc');
  // Reset sort when entering / leaving custom-order mode so the custom order takes effect on tab switch.
  const customOrderKey = hasCustomOrder ? customOrder!.join('|') : '';
  useEffect(() => {
    if (hasCustomOrder) {
      setSortField('modelName');
      setSortDirection(null);
    }
  }, [customOrderKey, hasCustomOrder]);
  const customOrderIndex = useMemo(() => {
    const map = new Map<string, number>();
    if (customOrder) customOrder.forEach((m, i) => map.set(m, i));
    return map;
  }, [customOrder]);
  const [sortModePerBenchmark, setSortModePerBenchmark] = useState<Record<string, SortMode>>({});
  // "All" mode: tracks which result index is currently displayed per cell
  const [cellResultIndex, setCellResultIndex] = useState<Record<string, number>>({});
  const tableScrollContainerRef = useRef<HTMLDivElement>(null);
  const topScrollBarRef = useRef<HTMLDivElement>(null);

  // Sync top scrollbar width with table content width
  useEffect(() => {
    const syncScrollWidth = () => {
      if (tableScrollContainerRef.current && topScrollBarRef.current) {
        const topInner = topScrollBarRef.current.children[0] as HTMLElement;
        if (topInner) {
          topInner.style.width = tableScrollContainerRef.current.scrollWidth + 'px';
        }
      }
    };

    // Use a small delay to ensure DOM is updated
    const timer = setTimeout(syncScrollWidth, 100);

    // Also sync when window resizes
    window.addEventListener('resize', syncScrollWidth);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', syncScrollWidth);
    };
  }, [data.length]);

  // Build a map of duplicate benchmark -> canonical benchmark from the data
  const benchmarkDuplicateMap = useMemo(() => {
    const map = new Map<string, string>(); // duplicateName -> canonicalName
    data.forEach(row => {
      Object.entries(row.benchmarks).forEach(([benchmarkName, benchmarkData]) => {
        if (benchmarkData.benchmarkDuplicateOf && benchmarkData.canonicalBenchmarkName) {
          map.set(benchmarkName, benchmarkData.canonicalBenchmarkName);
        }
      });
    });
    return map;
  }, [data]);

  // Helper function to recalculate improvement based on display settings
  const recalculateImprovement = (
    benchmarkData: {
      accuracy: number | null;
      baseModelAccuracy?: number;
      canonicalBenchmarkBaseModelAccuracy?: number;
      canonicalBaseModelAccuracy?: number;
      canonicalBothBaseModelAccuracy?: number;
    },
    useCanonicalBaseModel: boolean,
    useCanonicalBenchmark: boolean
  ): { baseModelAccuracy?: number; improvement?: number } => {
    // No improvement calculation for Pending/Started jobs (null accuracy)
    if (benchmarkData.accuracy === null) {
      return { baseModelAccuracy: undefined, improvement: undefined };
    }

    // Determine which base model accuracy to use based on display settings
    let newBaseModelAccuracy: number | undefined;

    if (useCanonicalBaseModel && useCanonicalBenchmark) {
      // Both duplicates hidden: use canonical base model on canonical benchmark
      newBaseModelAccuracy = benchmarkData.canonicalBothBaseModelAccuracy ?? benchmarkData.baseModelAccuracy;
    } else if (useCanonicalBaseModel) {
      // Only duplicate models hidden: use canonical base model on same benchmark
      newBaseModelAccuracy = benchmarkData.canonicalBaseModelAccuracy ?? benchmarkData.baseModelAccuracy;
    } else if (useCanonicalBenchmark) {
      // Only duplicate benchmarks hidden: use original base model on canonical benchmark
      newBaseModelAccuracy = benchmarkData.canonicalBenchmarkBaseModelAccuracy ?? benchmarkData.baseModelAccuracy;
    } else {
      // Both shown: use original values
      newBaseModelAccuracy = benchmarkData.baseModelAccuracy;
    }

    const newImprovement = newBaseModelAccuracy !== undefined
      ? benchmarkData.accuracy - newBaseModelAccuracy
      : undefined;

    return { baseModelAccuracy: newBaseModelAccuracy, improvement: newImprovement };
  };

  // Process data to handle duplicate models and recalculate improvements
  const processedData = useMemo(() => {
    let processed = data;

    // Determine flags for improvement recalculation
    const useCanonicalBaseModel = !showDuplicateModels;
    const useCanonicalBenchmark = !showDuplicateBenchmarks;

    // If not showing duplicate models, merge duplicate rows into canonical rows then filter
    if (!showDuplicateModels) {
      // Step 1: Separate canonical and duplicate rows
      const canonicalRows = new Map<string, typeof processed[0]>();
      const duplicateRows: typeof processed = [];

      for (const row of processed) {
        if (row.modelDuplicateOf === null) {
          const key = `${row.modelName}|||${row.agentName}`;
          canonicalRows.set(key, { ...row, benchmarks: { ...row.benchmarks } });
        } else {
          duplicateRows.push(row);
        }
      }

      // Step 2: Merge duplicate rows into canonical rows
      for (const dupRow of duplicateRows) {
        const canonicalKey = `${dupRow.canonicalModelName}|||${dupRow.agentName}`;
        let canonicalRow = canonicalRows.get(canonicalKey);

        // Step 3: Create orphan row if canonical doesn't exist
        if (!canonicalRow) {
          canonicalRow = {
            ...dupRow,
            modelName: dupRow.canonicalModelName,
            baseModelName: dupRow.canonicalBaseModelName,
            modelDuplicateOf: null,
            benchmarks: {}
          };
          canonicalRows.set(canonicalKey, canonicalRow);
        }

        // Merge benchmarks. When both canonical and duplicate have a result for the
        // same benchmark, concatenate their allResults arrays so every eval is visible
        // in the cell's cycle UI (sorted latest-first by jobCreatedAt). Single-eval
        // modes (latest/oldest/highest) don't populate allResults, so we wrap their
        // single entry into a 1-item array first — this also makes the cycle UI surface
        // the otherwise-shadowed duplicate eval in those modes.
        for (const [benchmarkName, benchmarkData] of Object.entries(dupRow.benchmarks)) {
          const existing = canonicalRow.benchmarks[benchmarkName];
          if (!existing) {
            canonicalRow.benchmarks[benchmarkName] = { ...benchmarkData };
          } else {
            const existingResults = existing.allResults ?? [existing];
            const dupResults = benchmarkData.allResults ?? [benchmarkData];
            const combined = [...existingResults, ...dupResults]
              .sort((a, b) => (b.jobCreatedAt ?? '').localeCompare(a.jobCreatedAt ?? ''));
            canonicalRow.benchmarks[benchmarkName] = { ...combined[0], allResults: combined };
          }
        }

        // Merge timestamps
        if (dupRow.firstEvalEndedAt && (!canonicalRow.firstEvalEndedAt || dupRow.firstEvalEndedAt < canonicalRow.firstEvalEndedAt)) {
          canonicalRow.firstEvalEndedAt = dupRow.firstEvalEndedAt;
        }
        if (dupRow.latestEvalEndedAt && (!canonicalRow.latestEvalEndedAt || dupRow.latestEvalEndedAt > canonicalRow.latestEvalEndedAt)) {
          canonicalRow.latestEvalEndedAt = dupRow.latestEvalEndedAt;
        }
      }

      // Step 4: Convert back, substitute base model names, recalculate improvements
      processed = Array.from(canonicalRows.values()).map(row => ({
        ...row,
        baseModelName: row.canonicalBaseModelName,
        benchmarks: Object.fromEntries(
          Object.entries(row.benchmarks).map(([benchmarkName, benchmarkData]) => {
            const { baseModelAccuracy, improvement } = recalculateImprovement(
              benchmarkData, useCanonicalBaseModel, useCanonicalBenchmark
            );
            return [benchmarkName, { ...benchmarkData, baseModelAccuracy, improvement }];
          })
        )
      }));

      // Step 5: Remove NO EVAL rows for models that have real eval rows
      // (duplicate models may produce orphan NO EVAL rows under the canonical name)
      const modelsWithRealEvals = new Set<string>();
      for (const row of processed) {
        if (!row.isNoEval) modelsWithRealEvals.add(row.modelName);
      }
      processed = processed.filter(row => !(row.isNoEval && modelsWithRealEvals.has(row.modelName)));
    }

    // If not showing duplicate benchmarks, merge duplicate benchmark results into canonical columns
    if (!showDuplicateBenchmarks) {
      processed = processed.map(row => {
        const newBenchmarks = { ...row.benchmarks };

        // For each duplicate benchmark, check if we should merge into canonical
        benchmarkDuplicateMap.forEach((canonicalName, duplicateName) => {
          const duplicateData = newBenchmarks[duplicateName];
          const canonicalData = newBenchmarks[canonicalName];

          // Copy duplicate data if canonical is missing or canonical is Pending/Started and duplicate is Finished
          if (duplicateData && (!canonicalData || (canonicalData.accuracy === null && duplicateData.accuracy !== null))) {
            // Recalculate improvement for merged data (comparing to canonical benchmark)
            const { baseModelAccuracy, improvement } = recalculateImprovement(
              duplicateData,
              useCanonicalBaseModel,
              true // Always use canonical benchmark since we're merging into canonical column
            );

            newBenchmarks[canonicalName] = {
              ...duplicateData,
              // Update the canonical name reference
              canonicalBenchmarkName: canonicalName,
              benchmarkDuplicateOf: null,
              // Update base model accuracy and improvement
              baseModelAccuracy,
              improvement
            };
          }
        });

        return {
          ...row,
          benchmarks: newBenchmarks
        };
      });
    }

    // If not showing duplicate agents, merge duplicate agent rows into canonical rows
    if (!showDuplicateAgents) {
      const canonicalRows = new Map<string, typeof processed[0]>();
      const duplicateRows: typeof processed = [];

      for (const row of processed) {
        if (row.agentDuplicateOf === null) {
          const key = `${row.modelName}|||${row.agentName}`;
          canonicalRows.set(key, { ...row, benchmarks: { ...row.benchmarks } });
        } else {
          duplicateRows.push(row);
        }
      }

      // Merge duplicate agent rows into canonical
      for (const dupRow of duplicateRows) {
        const canonicalKey = `${dupRow.modelName}|||${dupRow.canonicalAgentName}`;
        let canonicalRow = canonicalRows.get(canonicalKey);

        if (!canonicalRow) {
          canonicalRow = {
            ...dupRow,
            agentName: dupRow.canonicalAgentName,
            agentDuplicateOf: null,
            benchmarks: {}
          };
          canonicalRows.set(canonicalKey, canonicalRow);
        }

        // Merge benchmarks: fill gaps, prefer Finished over Pending/Started
        for (const [benchmarkName, benchmarkData] of Object.entries(dupRow.benchmarks)) {
          const existing = canonicalRow.benchmarks[benchmarkName];
          if (!existing) {
            canonicalRow.benchmarks[benchmarkName] = { ...benchmarkData };
          } else if (existing.accuracy === null && benchmarkData.accuracy !== null) {
            canonicalRow.benchmarks[benchmarkName] = { ...benchmarkData };
          }
        }

        // Merge timestamps
        if (dupRow.firstEvalEndedAt && (!canonicalRow.firstEvalEndedAt || dupRow.firstEvalEndedAt < canonicalRow.firstEvalEndedAt)) {
          canonicalRow.firstEvalEndedAt = dupRow.firstEvalEndedAt;
        }
        if (dupRow.latestEvalEndedAt && (!canonicalRow.latestEvalEndedAt || dupRow.latestEvalEndedAt > canonicalRow.latestEvalEndedAt)) {
          canonicalRow.latestEvalEndedAt = dupRow.latestEvalEndedAt;
        }
      }

      processed = Array.from(canonicalRows.values());

      // Remove NO EVAL rows for agents that have real eval rows
      const agentsWithRealEvals = new Set<string>();
      for (const row of processed) {
        if (!row.isNoEval) agentsWithRealEvals.add(`${row.modelName}|||${row.agentName}`);
      }
      processed = processed.filter(row => !(row.isNoEval && agentsWithRealEvals.has(`${row.modelName}|||${row.agentName}`)));
    }

    return processed;
  }, [data, showDuplicateModels, showDuplicateAgents, showDuplicateBenchmarks, benchmarkDuplicateMap]);

  // Get all unique benchmark names from the processed data.
  // Order: Core → OOD → Other (alphabetical within Other).
  const allBenchmarks = useMemo(() => {
    const benchmarkSet = new Set<string>();
    processedData.forEach(row => {
      Object.keys(row.benchmarks).forEach(benchmark => benchmarkSet.add(benchmark));
    });

    // Columns that must render even with no rows behind them. Without this a
    // capability nobody has evaluated yet is indistinguishable from one that
    // does not exist, because columns are otherwise derived from the data.
    // Absent (the agentic path) this is a no-op.
    forcedBenchmarks?.forEach(benchmark => benchmarkSet.add(benchmark));

    const names = Array.from(benchmarkSet);
    if (forcedBenchmarks && forcedBenchmarks.length > 0) {
      // Honour the caller's order (registry order); anything extra trails it.
      const rank = new Map(forcedBenchmarks.map((b, i) => [b, i]));
      return names.sort((a, b) => {
        const ra = rank.get(a), rb = rank.get(b);
        if (ra !== undefined && rb !== undefined) return ra - rb;
        if (ra !== undefined) return -1;
        if (rb !== undefined) return 1;
        return compareBenchmarks(a, b);
      });
    }
    return names.sort(compareBenchmarks);
  }, [processedData, forcedBenchmarks]);

  // Filter which benchmark columns to show based on search, filters, and duplicate settings
  const visibleBenchmarks = useMemo(() => {
    let visible = allBenchmarks;

    // If not showing duplicate benchmarks, filter them out (show only canonical benchmarks)
    if (!showDuplicateBenchmarks) {
      visible = visible.filter(benchmark => !benchmarkDuplicateMap.has(benchmark));
    }

    // Filter by benchmark search
    if (benchmarkSearch) {
      const query = benchmarkSearch.toLowerCase();
      visible = visible.filter(benchmark => benchmark.toLowerCase().includes(query));
    }

    // Filter by benchmark filters (if any selected, show only those)
    if (filters.benchmarks.length > 0) {
      visible = visible.filter(benchmark => filters.benchmarks.includes(benchmark));
    }

    return visible;
  }, [allBenchmarks, benchmarkSearch, filters.benchmarks, showDuplicateBenchmarks, benchmarkDuplicateMap]);

  // Benchmark names that begin a new category group (used to draw a left divider between groups).
  // Skips the very first visible column since the Agent Name cell already provides that border.
  const categoryBoundarySet = useMemo(() => {
    const boundaries = new Set<string>();
    for (let i = 1; i < visibleBenchmarks.length; i++) {
      if (classifyBenchmark(visibleBenchmarks[i]) !== classifyBenchmark(visibleBenchmarks[i - 1])) {
        boundaries.add(visibleBenchmarks[i]);
      }
    }
    return boundaries;
  }, [visibleBenchmarks]);

  // First benchmark of each Core / OOD group — labelled in the header as a category chip.
  // "Other" is intentionally left unlabelled to avoid visual clutter.
  const categoryLabelByBenchmark = useMemo(() => {
    const map = new Map<string, string>();
    let lastCategory: string | null = null;
    for (const b of visibleBenchmarks) {
      const c = classifyBenchmark(b);
      if (c !== lastCategory) {
        if (c === 'core') map.set(b, 'Core');
        else if (c === 'ood') map.set(b, 'OOD');
        lastCategory = c;
      }
    }
    return map;
  }, [visibleBenchmarks]);

  // Filter and sort the processed data (after duplicate handling)
  const filteredAndSortedData = useMemo(() => {
    let filtered = processedData;

    // Missing eval filter: only show models missing a finished eval on at least one default benchmark
    // Applied after duplicate merging so it sees the same data as the All Models view
    if (filterMissingEval) {
      const modelsWithAllBenchmarks = new Set<string>();
      const modelBenchmarkCoverage = new Map<string, Set<string>>();
      for (const row of filtered) {
        if (row.isNoEval) continue;
        let covered = modelBenchmarkCoverage.get(row.modelName);
        if (!covered) {
          covered = new Set<string>();
          modelBenchmarkCoverage.set(row.modelName, covered);
        }
        for (const bm of DEFAULT_VISIBLE_BENCHMARKS) {
          const b = row.benchmarks[bm];
          if (b && b.accuracy !== null) covered.add(bm);
        }
      }
      modelBenchmarkCoverage.forEach((covered, modelName) => {
        if (DEFAULT_VISIBLE_BENCHMARKS.every(bm => covered.has(bm))) {
          modelsWithAllBenchmarks.add(modelName);
        }
      });
      filtered = filtered.filter(row => !modelsWithAllBenchmarks.has(row.modelName));
    }

    // Hide blacklisted models
    if (hideBlacklisted) {
      filtered = filtered.filter(row => !BLACKLISTED_MODELS.has(row.modelName));
    }

    // Hide base models
    if (hideBaseModels) {
      filtered = filtered.filter(row => row.baseModelName !== 'None');
    }

    // Filter by model search
    if (modelSearch) {
      const query = modelSearch.toLowerCase();
      filtered = filtered.filter(row => row.modelName?.toLowerCase().includes(query));
    }

    // Filter by agent search (matches both eval agent and training agent)
    if (agentSearch) {
      const query = agentSearch.toLowerCase();
      filtered = filtered.filter(row =>
        row.agentName?.toLowerCase().includes(query) ||
        row.trainingAgentName?.toLowerCase().includes(query)
      );
    }

    // Filter by base model search
    if (baseModelSearch) {
      const query = baseModelSearch.toLowerCase();
      filtered = filtered.filter(row => row.baseModelName?.toLowerCase().includes(query));
    }

    // Filter by model filters
    if (filters.models.length > 0) {
      filtered = filtered.filter(row => filters.models.includes(row.modelName));
    }

    // Filter by agent filters
    if (filters.agents.length > 0) {
      filtered = filtered.filter(row => filters.agents.includes(row.agentName));
    }

    // Filter by training agent filters (check both trainingAgentName and agentName)
    if (filters.trainingAgents.length > 0) {
      filtered = filtered.filter(row =>
        filters.trainingAgents.includes(row.trainingAgentName) ||
        filters.trainingAgents.includes(row.agentName)
      );
    }

    // Filter by base model filters
    if (filters.baseModels.length > 0) {
      filtered = filtered.filter(row => filters.baseModels.includes(row.baseModelName));
    }

    // Filter by training type filters
    if (filters.trainingTypes.length > 0) {
      filtered = filtered.filter(row => filters.trainingTypes.includes(row.trainingType || 'None'));
    }

    // Filter by model size filters
    if (filters.modelSizes.length > 0) {
      filtered = filtered.filter(row => {
        const sizeLabel = row.modelSizeB != null ? `${Math.floor(row.modelSizeB)}B` : 'Unknown';
        return filters.modelSizes.includes(sizeLabel);
      });
    }

    // Custom order (used by Table 1 tab): sort by customOrder index with agent-name tiebreaker.
    // Takes effect when no user-initiated column sort is active.
    if (hasCustomOrder && !sortDirection) {
      filtered = [...filtered].sort((a, b) => {
        const ai = customOrderIndex.get(a.modelName) ?? Number.MAX_SAFE_INTEGER;
        const bi = customOrderIndex.get(b.modelName) ?? Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        if (a.modelName !== b.modelName) return a.modelName.localeCompare(b.modelName);
        return a.agentName.localeCompare(b.agentName);
      });
    }

    // Sort the data
    if (sortDirection && sortField) {
      filtered = [...filtered].sort((a, b) => {
        // Helper: final tiebreaker keeps rows for the same model adjacent,
        // then sub-ordered by agent name for deterministic order within a group.
        const groupTiebreak = () => {
          if (sortField !== 'modelName' && a.modelName !== b.modelName) {
            return a.modelName.localeCompare(b.modelName);
          }
          if (sortField !== 'agentName' && a.agentName !== b.agentName) {
            return a.agentName.localeCompare(b.agentName);
          }
          return 0;
        };
        let aVal: string | number | Date | undefined;
        let bVal: string | number | Date | undefined;

        if (sortField === 'modelName') {
          aVal = a.modelName;
          bVal = b.modelName;
        } else if (sortField === 'agentName') {
          aVal = a.agentName;
          bVal = b.agentName;
        } else if (sortField === 'baseModelName') {
          aVal = a.baseModelName;
          bVal = b.baseModelName;
        } else if (sortField === 'trainingType') {
          aVal = a.trainingType || '';
          bVal = b.trainingType || '';
        } else if (sortField === 'modelCreatedAt') {
          const ad = a.modelCreatedAt ? new Date(a.modelCreatedAt) : undefined;
          const bd = b.modelCreatedAt ? new Date(b.modelCreatedAt) : undefined;
          aVal = ad && !isNaN(ad.getTime()) ? ad : undefined;
          bVal = bd && !isNaN(bd.getTime()) ? bd : undefined;
        } else if (sortField === 'firstEvalEndedAt') {
          const ad = a.firstEvalEndedAt ? new Date(a.firstEvalEndedAt) : undefined;
          const bd = b.firstEvalEndedAt ? new Date(b.firstEvalEndedAt) : undefined;
          aVal = ad && !isNaN(ad.getTime()) ? ad : undefined;
          bVal = bd && !isNaN(bd.getTime()) ? bd : undefined;
        } else if (sortField === 'latestEvalEndedAt') {
          const ad = a.latestEvalEndedAt ? new Date(a.latestEvalEndedAt) : undefined;
          const bd = b.latestEvalEndedAt ? new Date(b.latestEvalEndedAt) : undefined;
          aVal = ad && !isNaN(ad.getTime()) ? ad : undefined;
          bVal = bd && !isNaN(bd.getTime()) ? bd : undefined;
        } else {
          // Sorting by a benchmark column
          const sortMode = sortModePerBenchmark[sortField] || 'accuracy';
          if (sortMode === 'improvement') {
            // Sort by improvement
            aVal = a.benchmarks[sortField]?.improvement;
            bVal = b.benchmarks[sortField]?.improvement;
          } else {
            // Sort by accuracy — null accuracy (Pending/Started) treated as undefined to sort to bottom
            aVal = a.benchmarks[sortField]?.accuracy ?? undefined;
            bVal = b.benchmarks[sortField]?.accuracy ?? undefined;
          }
        }

        // Handle undefined/null values (missing benchmark data, Pending/Started, or timestamp)
        if (aVal === undefined && bVal === undefined) return groupTiebreak();
        if (aVal === undefined) return 1;
        if (bVal === undefined) return -1;

        let cmp = 0;
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          cmp = sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        } else if (aVal instanceof Date && bVal instanceof Date) {
          cmp = sortDirection === 'asc' ? aVal.getTime() - bVal.getTime() : bVal.getTime() - aVal.getTime();
        }

        return cmp !== 0 ? cmp : groupTiebreak();
      });
    }

    return filtered;
  }, [processedData, modelSearch, agentSearch, baseModelSearch, filters, sortField, sortDirection, sortModePerBenchmark, filterMissingEval, hideBlacklisted, hideBaseModels, hasCustomOrder, customOrderIndex]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortDirection(null);
        setSortField('modelName');
      } else {
        setSortDirection('asc');
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleSortMode = (benchmark: string) => {
    setSortModePerBenchmark(prev => ({
      ...prev,
      [benchmark]: prev[benchmark] === 'improvement' ? 'accuracy' : 'improvement'
    }));
  };

  const handleTableScroll = () => {
    if (tableScrollContainerRef.current && topScrollBarRef.current) {
      topScrollBarRef.current.scrollLeft = tableScrollContainerRef.current.scrollLeft;
      // Ensure the top scrollbar's inner div has the same scroll width as the table
      const topInner = topScrollBarRef.current.children[0] as HTMLElement;
      if (topInner && tableScrollContainerRef.current.scrollWidth) {
        topInner.style.width = tableScrollContainerRef.current.scrollWidth + 'px';
      }
    }
  };

  const handleTopScrollBarScroll = () => {
    if (tableScrollContainerRef.current && topScrollBarRef.current) {
      tableScrollContainerRef.current.scrollLeft = topScrollBarRef.current.scrollLeft;
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ChevronsUpDown className="w-4 h-4 text-muted-foreground" />;
    }
    if (sortDirection === 'asc') {
      return <ChevronUp className="w-4 h-4 text-primary" />;
    }
    if (sortDirection === 'desc') {
      return <ChevronDown className="w-4 h-4 text-primary" />;
    }
    return <ChevronsUpDown className="w-4 h-4 text-muted-foreground" />;
  };

  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showExportMenu]);

  const handleExport = (column: string) => {
    let values: string[];
    if (column === 'modelName' || column === 'agentName' || column === 'baseModelName' || column === 'trainingType') {
      values = filteredAndSortedData.map(row => row[column] || '');
    } else {
      // Benchmark column — export accuracy per row
      values = filteredAndSortedData.map(row => {
        const acc = row.benchmarks[column]?.accuracy;
        return acc != null ? `${acc.toFixed(1)}%` : '—';
      });
    }
    const blob = new Blob([values.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${column}_export.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const handleExportFullTable = () => {
    // RFC 4180 quoting: wrap any field containing comma, double-quote, CR, or LF in
    // double quotes and double-up any internal quotes.
    const csvEscape = (raw: string): string => {
      const s = String(raw);
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    // Header row: mirror the visible columns. Full model name is repeated on every
    // row even when the rendered table collapses same-model agent groups under "↳".
    const headers = [
      'Model Name', 'Agent Name',
      ...visibleBenchmarks,
      'Base Model', 'Training Type',
      'Model Created At', 'First Eval Ended At', 'Latest Eval Ended At',
    ];
    const lines: string[] = [headers.map(csvEscape).join(',')];
    for (const row of filteredAndSortedData) {
      const cells: string[] = [
        row.modelName ?? '',
        row.agentName ?? '',
      ];
      for (const benchmark of visibleBenchmarks) {
        const cellData = row.benchmarks[benchmark];
        const allResults = cellData?.allResults;
        const hasMultiple = allResults && allResults.length > 1;
        const cellKey = `${row.modelName}|||${row.agentName}|||${benchmark}`;
        const currentIdx = cellResultIndex[cellKey] ?? 0;
        const displayData = hasMultiple ? allResults[currentIdx] : cellData;
        const acc = displayData?.accuracy;
        const se = displayData?.standardError;
        if (acc == null) {
          cells.push('—');
        } else if (se != null) {
          cells.push(`${acc.toFixed(1)}% ± ${se.toFixed(2)}`);
        } else {
          cells.push(`${acc.toFixed(1)}%`);
        }
      }
      cells.push(
        row.baseModelName ?? '',
        row.trainingType ?? '',
        row.modelCreatedAt ?? '',
        row.firstEvalEndedAt ?? '',
        row.latestEvalEndedAt ?? '',
      );
      lines.push(cells.map(csvEscape).join(','));
    }
    // UTF-8 BOM so Excel detects the encoding and renders the ± character correctly.
    const csv = '﻿' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leaderboard_table_export.csv';
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 90) return 'text-chart-2';
    if (accuracy >= 70) return 'text-chart-3';
    return 'text-foreground';
  };

  const getImprovementColor = (improvement: number | undefined) => {
    if (improvement === undefined) return 'text-muted-foreground';
    if (improvement >= 5) return 'text-green-600 dark:text-green-400';
    if (improvement >= 0) return 'text-green-500 dark:text-green-300';
    if (improvement >= -5) return 'text-orange-500 dark:text-orange-400';
    return 'text-red-600 dark:text-red-400';
  };

  const formatBenchmarkCell = (
    benchmarkData?: {
      accuracy: number | null;
      standardError: number | null;
      hfTracesLink?: string;
      baseModelAccuracy?: number;
      improvement?: number;
      timeoutMultiplier?: number;
      daytonaOverrideCpus?: number;
      daytonaOverrideMemoryMb?: number;
      daytonaOverrideStorageMb?: number;
      autoSnapshot?: boolean;
      jobStatus?: string | null;
      username?: string | null;
      slurmJobId?: string | null;
      jobCreatedAt?: string;
      isOverlong?: boolean;
      isIncomplete?: boolean;
      isHighErrors?: boolean;
      invalidErrorCount?: number;
      completedTrials?: number;
      totalTrials?: number;
      notes?: string;
    },
    benchmarkName?: string,
    rowBaseModelName?: string
  ) => {
    if (!benchmarkData) {
      return <span className="text-muted-foreground text-sm">—</span>;
    }

    // Pending/Started jobs: show status badge instead of accuracy
    const jobStatus = benchmarkData.jobStatus;
    if (jobStatus === 'Pending' || jobStatus === 'Started') {
      const isPending = jobStatus === 'Pending';
      const badgeClass = isPending
        ? 'bg-blue-500/15 text-blue-500 border-blue-500/30'
        : 'bg-amber-500/15 text-amber-500 border-amber-500/30';
      const label = isPending ? 'Pending' : 'Running';
      const tooltipParts: string[] = [];
      if (benchmarkData.username) tooltipParts.push(`User: ${benchmarkData.username}`);

      // Check if job is stale (>24h old)
      let isStale = false;
      let elapsedText = '';
      if (benchmarkData.jobCreatedAt) {
        const createdMs = new Date(benchmarkData.jobCreatedAt).getTime();
        if (!isNaN(createdMs)) {
          const elapsedMs = Date.now() - createdMs;
          const elapsedHours = elapsedMs / (1000 * 60 * 60);
          isStale = elapsedHours >= 24;
          if (isStale) {
            const days = Math.floor(elapsedHours / 24);
            const hours = Math.floor(elapsedHours % 24);
            elapsedText = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
            tooltipParts.push(`Submitted ${elapsedText} ago — may be stuck`);
          }
        }
      }

      return (
        <div className="flex items-center gap-2 justify-end">
          {/* Status badge */}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              {isStale && (
                <span title={`Submitted ${elapsedText} ago`}>
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                </span>
              )}
              <span
                className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}
                title={tooltipParts.length > 0 ? tooltipParts.join('\n') : undefined}
              >
                {label}
              </span>
            </div>
            {benchmarkData.username && (
              <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[100px]">
                {benchmarkData.username}
              </span>
            )}
            {benchmarkData.slurmJobId && (
              <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[100px]" title={`Slurm Job ID: ${benchmarkData.slurmJobId}`}>
                slurm:{benchmarkData.slurmJobId}
              </span>
            )}
            {isStale && (
              <span className="font-mono text-[10px] text-red-500">
                {elapsedText} ago
              </span>
            )}
          </div>
        </div>
      );
    }

    // Finished jobs (or legacy rows without jobStatus): show accuracy
    const isOverlong = benchmarkData.isOverlong === true;

    // Special handling for dev_set_71_tasks: show red warning flag for missing links
    const isDevSet71Tasks = benchmarkName === 'dev_set_71_tasks';

    return (
      <div className="flex items-center gap-2 justify-end">
        {benchmarkData.hfTracesLink ? (
          <a
            href={benchmarkData.hfTracesLink}
            target="_blank"
            rel="noopener noreferrer"
            title="View traces"
            className="hidden sm:inline-flex items-center justify-center w-5 h-5 rounded border-2 border-primary bg-primary/10 hover:bg-primary/20 hover:border-primary transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 text-primary" />
          </a>
        ) : isDevSet71Tasks ? (
          <div
            title="Traces link missing for dev_set_71_tasks"
            className="hidden sm:inline-flex items-center justify-center w-5 h-5 rounded border border-red-500/50 bg-red-500/10 cursor-not-allowed"
          >
            <AlertCircle className="w-3.5 h-3.5 text-red-500" />
          </div>
        ) : (
          <div
            title="Traces link not available"
            className="hidden sm:inline-flex items-center justify-center w-5 h-5 rounded border border-muted-foreground/20 bg-muted/50 cursor-not-allowed"
          >
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/40" />
          </div>
        )}
        {/* Config metadata badges — hidden on mobile to save space */}
        <div className="hidden sm:flex flex-col gap-1 items-start w-[5.5rem]">
          <span className={`font-mono text-[10px] rounded-full px-2 py-0.5 border ${
            benchmarkData.timeoutMultiplier != null
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25'
              : 'bg-muted/50 text-muted-foreground/50 border-muted-foreground/20'
          }`}>
            T:{benchmarkData.timeoutMultiplier != null ? `${benchmarkData.timeoutMultiplier}x` : 'N/A'}
          </span>
          {(() => {
            // Snapshot resource config changed on 2026-04-13. Evals run before that date
            // are flagged "snapshot_old" with a yellow stale-warning color.
            // jobCreatedAt is a PT-localised "YYYY-MM-DD HH:MM:SS" string, lexicographically comparable.
            const SNAPSHOT_CUTOFF = '2026-04-13';
            const hasOverride = benchmarkData.daytonaOverrideCpus != null
              || benchmarkData.daytonaOverrideMemoryMb != null
              || benchmarkData.daytonaOverrideStorageMb != null;
            const isOldSnapshot = !!benchmarkData.autoSnapshot
              && !!benchmarkData.jobCreatedAt
              && benchmarkData.jobCreatedAt < SNAPSHOT_CUTOFF;
            const badgeClass = isOldSnapshot
              ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30'
              : benchmarkData.autoSnapshot
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                : hasOverride
                  ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25'
                  : 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25';
            const badgeText = isOldSnapshot
              ? 'D: snapshot_old'
              : benchmarkData.autoSnapshot
                ? 'D: Snapshot'
                : hasOverride
                  ? `D: ${benchmarkData.daytonaOverrideCpus ?? 'x'}/${benchmarkData.daytonaOverrideMemoryMb != null ? (benchmarkData.daytonaOverrideMemoryMb / 1024).toFixed(0) : 'x'}/${benchmarkData.daytonaOverrideStorageMb != null ? (benchmarkData.daytonaOverrideStorageMb / 1024).toFixed(0) : 'x'}`
                  : 'D: Default';
            return (
              <span
                className={`font-mono text-[10px] rounded-full px-2 py-0.5 border whitespace-nowrap ${badgeClass}`}
                title={isOldSnapshot ? `Eval ran before snapshot config change on ${SNAPSHOT_CUTOFF}` : undefined}
              >
                {badgeText}
              </span>
            );
          })()}
          {isOverlong && (
            <span
              className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-500 border-red-500/30"
              title="Eval timed out — partial/incomplete results"
            >
              <AlertTriangle className="w-3 h-3 mr-0.5" />
              Overlong
            </span>
          )}
          {benchmarkData.isIncomplete && (
            <span
              className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold bg-orange-500/15 text-orange-500 border-orange-500/30"
              title={`Incomplete: ${benchmarkData.completedTrials ?? '?'} of ${benchmarkData.totalTrials ?? '?'} trials attempted`}
            >
              <AlertTriangle className="w-3 h-3 mr-0.5" />
              {benchmarkData.completedTrials ?? '?'}/{benchmarkData.totalTrials ?? '?'}
            </span>
          )}
          {benchmarkData.isHighErrors && (
            <span
              className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30"
              title={`${benchmarkData.invalidErrorCount} invalid errors (non-benign infra failures)`}
            >
              <AlertCircle className="w-3 h-3 mr-0.5" />
              Errors: {benchmarkData.invalidErrorCount}
            </span>
          )}
          {benchmarkData.notes && (
            <span
              className="inline-flex items-start gap-1 text-[10px] leading-snug rounded-md border px-1.5 py-1 bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30 text-left break-words max-w-[5.5rem]"
              title={benchmarkData.notes}
            >
              <StickyNote className="w-3 h-3 shrink-0 mt-[1px]" />
              <span className="break-words">{benchmarkData.notes}</span>
            </span>
          )}
        </div>
        {/* Numbers column — right-aligned, red+bold for Overlong */}
        <div className="flex flex-col items-end gap-1">
          {benchmarkData.accuracy != null ? (
            <span className={`font-mono text-sm ${isOverlong ? 'text-red-500 font-bold' : `font-semibold ${getAccuracyColor(benchmarkData.accuracy)}`}`}>
              {benchmarkData.accuracy.toFixed(1)}%
            </span>
          ) : (
            <span className="font-mono text-sm text-muted-foreground">--</span>
          )}
          {benchmarkData.standardError != null ? (
            <span className={`font-mono text-xs ${isOverlong ? 'text-red-500 font-bold' : 'text-muted-foreground'}`}>
              ±{benchmarkData.standardError.toFixed(2)}
            </span>
          ) : null}
          {benchmarkData.improvement !== undefined ? (
            <span className={`font-mono text-xs ${isOverlong ? 'text-red-500 font-bold' : `font-medium ${getImprovementColor(benchmarkData.improvement)}`}`}>
              {benchmarkData.improvement >= 0 ? '+' : ''}{benchmarkData.improvement.toFixed(2)} pp
            </span>
          ) : (
            benchmarkData.accuracy != null && rowBaseModelName && rowBaseModelName !== 'None' && (
              <span
                className="inline-flex items-center gap-0.5 font-mono text-[10px] text-amber-600 dark:text-amber-400"
                title={`No base model score — ${rowBaseModelName} has not been evaluated on this benchmark with the same agent`}
              >
                <AlertTriangle className="w-3 h-3" />
                no base
              </span>
            )
          )}
        </div>
      </div>
    );
  };

  const totalColumns = 8 + visibleBenchmarks.length; // # + model + agent + base model + trainingType + modelCreatedAt + firstEvalEndedAt + latestEvalEndedAt + benchmark columns

  return (
    <>
      <style>{scrollbarHidingStyles}</style>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">
          {filteredAndSortedData.length} result{filteredAndSortedData.length !== 1 ? 's' : ''}
        </span>
        <div className="relative" ref={exportMenuRef}>
          <button
            onClick={() => setShowExportMenu(prev => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors"
            title="Export column to TXT"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
          {showExportMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-md border border-border bg-popover shadow-md py-1 max-h-72 overflow-y-auto">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Whole Table</div>
              <button
                onClick={handleExportFullTable}
                className="w-full text-left px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                Full Table (CSV)
              </button>
              <div className="border-t border-border my-1" />
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Fields</div>
              {(['modelName', 'agentName', 'baseModelName', 'trainingType'] as const).map(field => (
                <button
                  key={field}
                  onClick={() => handleExport(field)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
                >
                  {{ modelName: 'Model Name', agentName: 'Agent Name', baseModelName: 'Base Model', trainingType: 'Training Type' }[field]}
                </button>
              ))}
              {visibleBenchmarks.length > 0 && (
                <>
                  <div className="border-t border-border my-1" />
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Benchmarks</div>
                  {visibleBenchmarks.map(benchmark => (
                    <button
                      key={benchmark}
                      onClick={() => handleExport(benchmark)}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors truncate"
                      title={benchmark}
                    >
                      {benchmark}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="border border-border rounded-md overflow-hidden">
        <div
          ref={topScrollBarRef}
          onScroll={handleTopScrollBarScroll}
          className="hidden sm:block"
          style={{
            height: '16px',
            backgroundColor: 'hsl(var(--muted))',
            borderBottom: '1px solid hsl(var(--border))',
            overflowX: 'auto',
            overflowY: 'hidden'
          }}
        >
          <div style={{ height: '1px', minWidth: '100%' }} />
        </div>
        <div
          className="overflow-x-auto"
          ref={tableScrollContainerRef}
          onScroll={handleTableScroll}
        >
          <table className="w-full">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr className="border-b border-border">
                <th className="w-8 px-1 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground sm:sticky sm:left-0 sm:z-20 sm:bg-muted/50 sm:w-12 sm:px-2 sm:py-4">#</th>
                <th className="text-left px-2 py-2 min-w-[100px] sm:sticky sm:left-12 sm:z-20 sm:bg-muted/50 sm:px-6 sm:py-4 sm:min-w-[200px]">
                  <button
                    onClick={() => handleSort('modelName')}
                    className="flex items-center gap-1 sm:gap-2 font-medium text-xs sm:text-sm uppercase tracking-wide hover-elevate active-elevate-2 -mx-1 sm:-mx-2 px-1 sm:px-2 py-1 rounded-md"
                    data-testid="button-sort-model"
                  >
                    Model Name
                    <SortIcon field="modelName" />
                  </button>
                </th>
                <th className="text-left px-2 py-2 min-w-[80px] sm:px-6 sm:py-4 sm:min-w-[200px]">
                  <button
                    onClick={() => handleSort('agentName')}
                    className="flex items-center gap-1 sm:gap-2 font-medium text-xs sm:text-sm uppercase tracking-wide hover-elevate active-elevate-2 -mx-1 sm:-mx-2 px-1 sm:px-2 py-1 rounded-md"
                    data-testid="button-sort-agent"
                  >
                    Agent Name
                    <SortIcon field="agentName" />
                  </button>
                </th>
                {visibleBenchmarks.map(benchmark => {
                  const categoryLabel = categoryLabelByBenchmark.get(benchmark);
                  return (
                  <th key={benchmark} className={`text-right px-1 py-2 min-w-[70px] sm:px-6 sm:py-4 sm:min-w-[220px] ${categoryBoundarySet.has(benchmark) ? 'border-l-4 border-muted-foreground/50' : ''}`}>
                    <div className="flex flex-col items-end gap-1 sm:gap-2">
                      {categoryLabel && (
                        <span
                          className={`self-start text-[10px] sm:text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            categoryLabel === 'Core'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300'
                          }`}
                          data-testid={`benchmark-category-${categoryLabel.toLowerCase()}`}
                        >
                          {categoryLabel}
                        </span>
                      )}
                      <button
                        onClick={() => handleSort(benchmark)}
                        className="flex items-center gap-1 sm:gap-2 font-medium text-[10px] sm:text-sm uppercase tracking-wide hover-elevate active-elevate-2 -mx-1 sm:-mx-2 px-1 sm:px-2 py-1 rounded-md"
                        data-testid={`button-sort-${benchmark}`}
                      >
                        {benchmark}
                        <SortIcon field={benchmark} />
                      </button>
                      <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                        <button
                          onClick={() => toggleSortMode(benchmark)}
                          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                            (sortModePerBenchmark[benchmark] || 'accuracy') === 'accuracy'
                              ? 'bg-primary/20 text-primary'
                              : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                          }`}
                          title="Sort by accuracy"
                        >
                          Acc
                        </button>
                        <button
                          onClick={() => toggleSortMode(benchmark)}
                          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                            (sortModePerBenchmark[benchmark] || 'accuracy') === 'improvement'
                              ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                              : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                          }`}
                          title="Sort by improvement"
                        >
                          Imp
                        </button>
                      </div>
                    </div>
                  </th>
                  );
                })}
                <th className="hidden sm:table-cell text-left px-2 sm:px-6 py-2 sm:py-4 min-w-[120px] sm:min-w-[200px]">
                  <button
                    onClick={() => handleSort('baseModelName')}
                    className="flex items-center gap-1 sm:gap-2 font-medium text-xs sm:text-sm uppercase tracking-wide hover-elevate active-elevate-2 -mx-1 sm:-mx-2 px-1 sm:px-2 py-1 rounded-md"
                    data-testid="button-sort-basemodel"
                  >
                    Base Model
                    <SortIcon field="baseModelName" />
                  </button>
                </th>
                <th className="hidden sm:table-cell text-left px-2 sm:px-6 py-2 sm:py-4 min-w-[80px] sm:min-w-[120px]">
                  <button
                    onClick={() => handleSort('trainingType')}
                    className="flex items-center gap-1 sm:gap-2 font-medium text-xs sm:text-sm uppercase tracking-wide hover-elevate active-elevate-2 -mx-1 sm:-mx-2 px-1 sm:px-2 py-1 rounded-md"
                    data-testid="button-sort-trainingType"
                  >
                    Training Type
                    <SortIcon field="trainingType" />
                  </button>
                </th>
                <th className="hidden sm:table-cell text-left px-2 sm:px-6 py-2 sm:py-4 min-w-[120px] sm:min-w-[180px]">
                  <button
                    onClick={() => handleSort('modelCreatedAt')}
                    className="flex items-center gap-1 sm:gap-2 font-medium text-xs sm:text-sm uppercase tracking-wide hover-elevate active-elevate-2 -mx-1 sm:-mx-2 px-1 sm:px-2 py-1 rounded-md"
                    data-testid="button-sort-modelCreatedAt"
                  >
                    Model Added At (PT)
                    <SortIcon field="modelCreatedAt" />
                  </button>
                </th>
                <th className="hidden sm:table-cell text-left px-2 sm:px-6 py-2 sm:py-4 min-w-[120px] sm:min-w-[180px]">
                  <button
                    onClick={() => handleSort('firstEvalEndedAt')}
                    className="flex items-center gap-1 sm:gap-2 font-medium text-xs sm:text-sm uppercase tracking-wide hover-elevate active-elevate-2 -mx-1 sm:-mx-2 px-1 sm:px-2 py-1 rounded-md"
                    data-testid="button-sort-firstEvalEndedAt"
                  >
                    First Eval At (PT)
                    <SortIcon field="firstEvalEndedAt" />
                  </button>
                </th>
                <th className="hidden sm:table-cell text-left px-2 sm:px-6 py-2 sm:py-4 min-w-[120px] sm:min-w-[180px]">
                  <button
                    onClick={() => handleSort('latestEvalEndedAt')}
                    className="flex items-center gap-1 sm:gap-2 font-medium text-xs sm:text-sm uppercase tracking-wide hover-elevate active-elevate-2 -mx-1 sm:-mx-2 px-1 sm:px-2 py-1 rounded-md"
                    data-testid="button-sort-latestEvalEndedAt"
                  >
                    Latest Eval At (PT)
                    <SortIcon field="latestEvalEndedAt" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedData.length === 0 ? (
                <tr>
                  <td colSpan={totalColumns} className="px-4 sm:px-6 py-8 sm:py-12 text-center text-muted-foreground">
                    No results found
                  </td>
                </tr>
              ) : (
                filteredAndSortedData.map((row, index) => {
                  const isBaseModel = row.baseModelName === 'None';
                  const isBlacklisted = BLACKLISTED_MODELS.has(row.modelName);
                  const prevRow = index > 0 ? filteredAndSortedData[index - 1] : undefined;
                  const nextRow = index < filteredAndSortedData.length - 1 ? filteredAndSortedData[index + 1] : undefined;
                  // Section header insertion (Table 1 tab): render before the first row of each section.
                  // Only when custom order is in effect (sortDirection === null), otherwise header would scatter.
                  const showSectionHeaders = hasCustomOrder && !sortDirection && !!sectionByModel;
                  const currentSection = showSectionHeaders ? sectionByModel![row.modelName] : undefined;
                  const prevSection = showSectionHeaders && prevRow ? sectionByModel![prevRow.modelName] : undefined;
                  const isSectionStart = showSectionHeaders && !!currentSection && currentSection !== prevSection;
                  const isGroupContinuation = prevRow?.modelName === row.modelName;
                  const isGroupStart = !isGroupContinuation && nextRow?.modelName === row.modelName;
                  const isInGroup = isGroupContinuation || isGroupStart;
                  const rowBgClass = isBaseModel
                    ? 'bg-blue-100 dark:bg-blue-900/60'
                    : isBlacklisted
                      ? 'bg-neutral-200 dark:bg-neutral-800/70'
                      : index % 2 === 0 ? 'bg-background' : 'bg-muted/20';
                  const stickyCellBgClass = isBaseModel
                    ? 'bg-blue-100 dark:bg-blue-900/60'
                    : isBlacklisted
                      ? 'bg-neutral-200 dark:bg-neutral-800/70'
                      : 'bg-background';
                  const rowBorderClass = isGroupContinuation ? 'border-t-0' : 'border-t border-border';
                  const bottomBorderClass = (nextRow && nextRow.modelName === row.modelName) ? '' : 'border-b border-border';

                  return (
                    <Fragment key={`${row.modelName}-${row.agentName}`}>
                      {isSectionStart && (
                        <tr className="bg-muted/60 border-t-2 border-primary/40">
                          <td
                            colSpan={totalColumns}
                            className="px-2 sm:px-6 py-2 text-xs sm:text-sm font-bold uppercase tracking-wider text-foreground sm:sticky sm:left-0 sm:z-20 bg-muted/60"
                            data-testid={`row-section-${currentSection}`}
                          >
                            {currentSection}
                          </td>
                        </tr>
                      )}
                    <tr
                      className={`${rowBorderClass} ${bottomBorderClass} hover-elevate ${rowBgClass}`}
                      data-testid={`row-result-${row.modelName}-${row.agentName}`}
                    >
                      <td className={`w-8 px-1 py-2 text-center text-xs text-muted-foreground font-mono sm:sticky sm:left-0 sm:z-20 sm:w-12 sm:px-2 sm:py-4 ${stickyCellBgClass}`}>{isGroupContinuation ? '' : index + 1}</td>
                      <td className={`px-2 py-2 sm:sticky sm:left-12 sm:z-20 sm:px-6 sm:py-4 ${stickyCellBgClass} ${isInGroup ? 'border-l-2 border-l-primary/40' : ''}`}>
                        {isGroupContinuation ? (
                          <span className="text-muted-foreground/50 text-xs sm:text-sm pl-3">↳</span>
                        ) : (
                          <>
                            <span className="font-semibold text-foreground text-xs sm:text-sm">{row.modelName}</span>
                            {row.modelSizeB != null && (
                              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded font-mono font-medium ${modelSizeColor(row.modelSizeB)}`}>
                                {formatModelSize(row.modelSizeB)}
                              </span>
                            )}
                            <span className={`ml-1 text-xs px-1.5 py-0.5 rounded font-medium ${
                              row.trainingType === 'SFT'
                                ? 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200'
                                : row.trainingType === 'RL'
                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200'
                                  : 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200'
                            }`}>
                              {row.trainingType || 'Base'}
                            </span>
                          </>
                        )}
                      </td>
                    <td className="px-1 py-2 sm:px-6 sm:py-4">
                      {row.isNoEval ? (
                        <span className="text-red-500 font-semibold text-xs sm:text-sm">NO EVAL</span>
                      ) : (
                        <span className="text-muted-foreground text-xs sm:text-sm">{row.agentName}</span>
                      )}
                    </td>
                      {visibleBenchmarks.map(benchmark => {
                        const cellData = row.benchmarks[benchmark];
                        const allResults = cellData?.allResults;
                        const hasMultiple = allResults && allResults.length > 1;
                        const cellKey = `${row.modelName}|||${row.agentName}|||${benchmark}`;
                        const currentIdx = cellResultIndex[cellKey] ?? 0;
                        const displayData = hasMultiple ? allResults[currentIdx] : cellData;
                        return (
                          <td key={benchmark} className={`px-1 py-2 text-right sm:px-6 sm:py-4 ${categoryBoundarySet.has(benchmark) ? 'border-l-4 border-muted-foreground/50' : ''}`}>
                            {hasMultiple ? (
                              <div className="flex items-center gap-0.5">
                                <div className="flex flex-col items-center gap-0.5 mr-1">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setCellResultIndex(prev => ({ ...prev, [cellKey]: (currentIdx - 1 + allResults.length) % allResults.length })); }}
                                    className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted/50 transition-colors leading-none"
                                    title="Previous result"
                                  >
                                    <ChevronLeft className="w-3 h-3" />
                                  </button>
                                  <span className="text-[9px] font-mono text-muted-foreground whitespace-nowrap">
                                    {currentIdx + 1}/{allResults.length}
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setCellResultIndex(prev => ({ ...prev, [cellKey]: (currentIdx + 1) % allResults.length })); }}
                                    className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted/50 transition-colors leading-none"
                                    title="Next result"
                                  >
                                    <ChevronRight className="w-3 h-3" />
                                  </button>
                                </div>
                                <div className="flex-1">
                                  {formatBenchmarkCell(displayData, benchmark, row.baseModelName)}
                                </div>
                              </div>
                            ) : (
                              formatBenchmarkCell(cellData, benchmark, row.baseModelName)
                            )}
                          </td>
                        );
                      })}
                    <td className="hidden sm:table-cell px-2 sm:px-6 py-2 sm:py-4">
                      <span className="text-muted-foreground text-xs sm:text-sm">{row.baseModelName}</span>
                    </td>
                    <td className="hidden sm:table-cell px-2 sm:px-6 py-2 sm:py-4">
                      <span className="text-muted-foreground text-xs sm:text-sm">{row.trainingType || '—'}</span>
                    </td>
                    <td className="hidden sm:table-cell px-2 sm:px-6 py-2 sm:py-4">
                      <span className="text-muted-foreground font-mono text-xs sm:text-sm">
                        {row.modelCreatedAt || '—'}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell px-2 sm:px-6 py-2 sm:py-4">
                      <span className="text-muted-foreground font-mono text-xs sm:text-sm">
                        {row.firstEvalEndedAt || '—'}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell px-2 sm:px-6 py-2 sm:py-4">
                      <span className="text-muted-foreground font-mono text-xs sm:text-sm">
                        {row.latestEvalEndedAt || '—'}
                      </span>
                    </td>
                    </tr>
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
