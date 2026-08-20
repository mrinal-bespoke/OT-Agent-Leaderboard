import { useState, useMemo, useEffect, useRef } from 'react';
import { RefreshCw, Info, ExternalLink, AlertCircle, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import LeaderboardTableWithImprovement, { type PivotedLeaderboardRowWithImprovement } from '@/components/LeaderboardTableWithImprovement';
import SearchBarWithBaseModel from '@/components/SearchBarWithBaseModel';
import FilterControlsWithBaseModel from '@/components/FilterControlsWithBaseModel';
import ViewModeControls from '@/components/ViewModeControls';
import ThemeToggle from '@/components/ThemeToggle';
import { DEFAULT_VISIBLE_BENCHMARKS, OOD_BENCHMARKS, CORE_BENCHMARKS, compareBenchmarks } from '@/config/benchmarkConfig';
import { BLACKLISTED_MODELS } from '@/config/blacklistedModels';

/**
 * Track and capability identifiers, mirroring shared/benchmark-registry.ts.
 *
 * Declared locally rather than imported: the server owns which benchmarks
 * belong where, and the client only needs the identifiers it puts in a query
 * param. Column contents come from /api/benchmark-columns, so there is still
 * exactly one source of truth for membership.
 */
type Track = 'agentic' | 'non-agentic';

/** Capability views inside the non-agentic track, in display order. */
const NON_AGENTIC_VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'math', label: 'Math' },
  { id: 'code', label: 'Code' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'instruction', label: 'Instruction' },
  { id: 'longcontext', label: 'Long context' },
  { id: 'domain', label: 'Domain' },
] as const;

type NonAgenticView = typeof NON_AGENTIC_VIEWS[number]['id'];

type EvalSelectionMode = 'oldest' | 'latest' | 'highest' | 'all';

const SELECTION_MODE_DESCRIPTIONS: Record<EvalSelectionMode, string> = {
  oldest: 'Shows the first valid evaluation (accuracy > 1%) per model/agent/benchmark, falling back to the earliest if none meet the threshold.',
  latest: 'Shows the most recent valid evaluation (accuracy > 1%) per model/agent/benchmark, falling back to the latest if none meet the threshold.',
  highest: 'Shows the highest accuracy evaluation per model/agent/benchmark.',
  all: 'Shows all evaluations per cell. Use ◀ ▶ arrows to cycle through multiple results.',
};

const EVAL_AGENT_NAMES = new Set(['terminus-2', 'openhands', 'mini-swe-agent', 'swe-agent']);

const TABLE_1_SECTIONS: Array<{ label: string; models: string[] }> = [
  {
    label: '~8B Scale',
    models: [
      'Qwen/Qwen3-8B',
      'allenai/SERA-8B',
      'SWE-bench/SWE-agent-LM-7B',
      'nvidia/Nemotron-Terminal-8B',
      'camel-ai/seta-rl-qwen3-8b',
      'open-thoughts/OpenThinker-Agent-v1',
      'obiwan96/qwen3-8b-openthinker-sft-endless-terminals',
      'nvidia/Llama-3.1-Nemotron-Nano-8B-v1',
      'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
      'open-thoughts/OpenThinker3-7B',
      'SWE-Lego/SWE-Lego-Qwen3-8B',
    ],
  },
  {
    label: '~32B Scale',
    models: [
      'Qwen/Qwen3-32B',
      'Lite-Coder/LiteCoder-Terminal-30b-a3b-sft',
      'Qwen/Qwen3-30B-A3B-Instruct-2507',
      'allenai/SERA-32B',
      'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16',
      'Qwen/Qwen3-Coder-30B-A3B-Instruct',
      'SWE-bench/SWE-agent-LM-32B',
      'nvidia/Nemotron-Terminal-32B',
      'nvidia/Nemotron-Terminal-14B',
      'zai-org/GLM-4.7-Flash',
      'NovaSky-AI/SA-SWE-32B',
      'R2E-Gym/R2EGym-32B-Agent',
      'Skywork/Skywork-SWE-32B',
      'Qwen/Qwen2.5-Coder-32B-Instruct',
      'GAIR/OpenSWE-32B',
      'GAIR/daVinci-Dev-32B',
      'SWE-Lego/SWE-Lego-Qwen3-32B',
      'agentica-org/DeepSWE-Preview',
    ],
  },
  {
    label: 'Larger / Closed-Source',
    models: [
      'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8',
      'Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
      'moonshotai/Kimi-K2.5',
      'zai-org/GLM-4.7',
      'zai-org/GLM-4.7-FP8',
      'zai-org/GLM-5',
    ],
  },
  {
    label: 'Qwen3.5',
    models: [
      'Qwen/Qwen3.5-9B',
      'Qwen/Qwen3.5-27B',
    ],
  },
];

const TABLE_1_ORDER: string[] = TABLE_1_SECTIONS.flatMap(s => s.models);
const TABLE_1_MODELS = new Set<string>(TABLE_1_ORDER);
const TABLE_1_SECTION_BY_MODEL: Record<string, string> = TABLE_1_SECTIONS.reduce((acc, s) => {
  s.models.forEach(m => { acc[m] = s.label; });
  return acc;
}, {} as Record<string, string>);

const WAR_SECTIONS: Array<{ label: string; models: string[] }> = [
  {
    label: '~32B Scale',
    models: [
      'laion/nemotron-terminal-corpus-unified-100000__Qwen3-32B',
      'laion/nemosci-tasrep-a1mfc-gfistaqc-scaff-maxeps-swes-r2eg-32b__Qwen3-32B',
      'laion/nemosci-tasrep-nemodebug-a1mfc-gfistaqc-scaff-maxeps-swes-r2eg-32b__Qwen3-32B',
      'laion/nemosci-tasrep-a1mfc-gfistaqc-dev1-scaff-maxeps-swes-r2eg-32b__Qwen3-32B',
      'nvidia/Nemotron-Terminal-32B',
      'laion/nemotron-terminal-corpus-unified-31600__Qwen3-32B',
      'DCAgent/g1_diverse_tezos_100k_32b_step900',
      'DCAgent/g1_min_episodes_e1_gpt_long_thinking_tacc-Qwen3-32B',
      'DCAgent/g1_weighted_100k_32B_step4400',
      'laion/nemosci-tasrep-a1mfc-dev1-maxeps-swes-r2eg-32b__Qwen3-32B',
      'DCAgent/g1_min_episodes_e1_gpt_long_sampled_swesmith_psu_thinking_tacc-Qwen3-32B',
      'DCAgent/g1_weighted_31600_32B',
      'DCAgent/g1_timeout_e1_gpt_long_sampled_swesmith_psu_thinking_tacc-Qwen3-32B',
      'DCAgent/g1_timeout_e1_gpt_long_thinking_tacc-Qwen3-32B',
      'DCAgent/g1_weighted_100k_32B_step2800',
    ],
  },
  {
    label: '~8B Scale',
    models: [
      'laion/nemosci-tasrep-a1mfc-dev1-maxeps__Qwen3-8B',
      'laion/100k_wd0__Qwen3-8B',
      'nvidia/Nemotron-Terminal-8B',
      'laion/nemosci-tasrep-a1mfc-gfistaqc-dev1-scaff-maxeps-swes-r2eg__Qwen3-8B',
      'DCAgent/g1_weighted_100k_8b_v2',
      'DCAgent/g1_weighted_31600_8b_orig',
      'laion/100k_wd1e-3__Qwen3-8B',
      'DCAgent/g1_min_episodes_e1_gpt_long_tacc',
      'DCAgent/g1_timeout_e1_gpt_long',
      'laion/nemosci-tasrep-a1mfc-gfistaqc-dev1-scaff-maxeps__Qwen3-8B',
    ],
  },
];

const WAR_ORDER: string[] = WAR_SECTIONS.flatMap(s => s.models);
const WAR_MODELS = new Set<string>(WAR_ORDER);
const WAR_SECTION_BY_MODEL: Record<string, string> = WAR_SECTIONS.reduce((acc, s) => {
  s.models.forEach(m => { acc[m] = s.label; });
  return acc;
}, {} as Record<string, string>);

const SCALING_SECTIONS: Array<{ label: string; models: string[] }> = [
  {
    label: 'laion nemotron (~8B)',
    models: [
      'laion/nemotron-316-opt1k__Qwen3-8B',
      'laion/nemotron-1000-opt1k__Qwen3-8B',
      'laion/nemotron-terminal-corpus-unified-3160__Qwen3-8B',
      'laion/nemotron-10000__Qwen3-8B',
      'laion/nemotron-31600-opt100k__Qwen3-8B',
      'laion/nemotron-100000-opt100k__Qwen3-8B',
    ],
  },
  {
    label: 'laion nemotron (~32B)',
    models: [
      'laion/nemotron-terminal-corpus-unified-316__Qwen3-32B',
      'laion/nemotron-terminal-corpus-unified-1000__Qwen3-32B',
      'laion/nemotron-terminal-corpus-unified-3160__Qwen3-32B',
      'laion/nemotron-terminal-corpus-unified-10000__Qwen3-32B',
      'laion/nemotron-terminal-corpus-unified-31600__Qwen3-32B',
      'laion/nemotron-terminal-corpus-unified-100000__Qwen3-32B',
    ],
  },
  {
    label: 'SERA (~32B)',
    models: [
      'ethanlshen/Qwen3-32B-316_sera_46_47000',
      'ethanlshen/Qwen3-32B-1000_sera_46_47000',
      'ethanlshen/Qwen3-32B-3160_sera_46_47000-converted',
      'ethanlshen/Qwen3-32B-10000_sera_46_47000',
      'ethanlshen/Qwen3-32B-31600_sera_46_47000_converted',
      'ethanlshen/Qwen3-32B-47000-46',
      'allenai/SERA-32B',
    ],
  },
  {
    label: 'DCAgent g1 (~32B)',
    models: [
      'DCAgent3/g1_diverse_tezos_top4_316_32b',
      'DCAgent3/g1_diverse_tezos_top4_1000_32b',
      'DCAgent3/g1_diverse_tezos_top4_3160_32b',
      'DCAgent3/g1_diverse_tezos_top4_10000_32b',
      'DCAgent2/g1_diverse_tezos_top4_31600_32b_step900',
      'DCAgent/g1_diverse_tezos_100k_32b_step3600',
    ],
  },
  {
    label: '8B Scaling',
    models: [
      'DCAgent3/g1_diverse_tezos_top4_316_8b',
      'DCAgent3/g1_diverse_tezos_top4_1000_8b',
      'DCAgent3/g1_diverse_tezos_top4_3160_8b',
      'DCAgent3/g1_diverse_tezos_top4_10000_8b',
      'DCAgent/g1_diverse_tezos_100k_8b',
    ],
  },
  {
    label: 'Base',
    models: [
      'Qwen/Qwen3-8B',
      'Qwen/Qwen3-32B',
    ],
  },
];

// "8B RL" tab: the base model below plus every model trained on top of it.
const RL_8B_BASE_MODEL = 'laion/GLM-4_7-swesmith-sandboxes-with_tests-oracle_verified_120s-maxeps-131k-fixthink';

const SCALING_ORDER: string[] = SCALING_SECTIONS.flatMap(s => s.models);
const SCALING_MODELS = new Set<string>(SCALING_ORDER);
const SCALING_SECTION_BY_MODEL: Record<string, string> = SCALING_SECTIONS.reduce((acc, s) => {
  s.models.forEach(m => { acc[m] = s.label; });
  return acc;
}, {} as Record<string, string>);

export default function Leaderboard() {
  const [selectionMode, setSelectionMode] = useState<EvalSelectionMode>('all');
  // Evaluation track, and the capability view within the non-agentic track.
  // The server filters by track BEFORE dedup, so switching re-fetches rather
  // than filtering client-side: selection, dedup and improvement must all be
  // computed within the visible set, not across it.
  const [track, setTrack] = useState<Track>('agentic');
  const [nonAgenticView, setNonAgenticView] = useState<NonAgenticView>('overview');
  const [activeTab, setActiveTab] = useState<'filtered' | 'all' | 'blacklisted' | 'base' | 'active' | 'a1' | 'b1' | 'c1' | 'd1' | 'e1' | 'f1' | 'g1' | 'ood' | 'war' | 'table1' | 'scaling' | 'rl8b' | 'baselineData' | 'missingEval' | 'guardrail'>('all');
  const [topN, setTopN] = useState<number>(50);
  const [recentlyAddedN, setRecentlyAddedN] = useState<number>(50);
  const [recentlyEvaledN, setRecentlyEvaledN] = useState<number>(50);
  const [topPerformerBenchmark, setTopPerformerBenchmark] = useState<string>('dev_set_v2');
  const [modelSearch, setModelSearch] = useState('');
  const [agentSearch, setAgentSearch] = useState('');
  const [baseModelSearch, setBaseModelSearch] = useState('');
  const [benchmarkSearch, setBenchmarkSearch] = useState('');
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [selectedTrainingAgents, setSelectedTrainingAgents] = useState<string[]>([]);
  const [selectedBaseModels, setSelectedBaseModels] = useState<string[]>([]);
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<string[]>([]);
  const [selectedTrainingTypes, setSelectedTrainingTypes] = useState<string[]>([]);
  const [selectedModelSizes, setSelectedModelSizes] = useState<string[]>([]);
  // Duplicate display controls (default: hide duplicates)
  const [showDuplicateBenchmarks, setShowDuplicateBenchmarks] = useState(false);
  const [showDuplicateModels, setShowDuplicateModels] = useState(false);
  const [showDuplicateAgents, setShowDuplicateAgents] = useState(false);
  const [hideNoTraceLink, setHideNoTraceLink] = useState(false);
  const [hideBlacklisted, setHideBlacklisted] = useState(false);
  const [hideBaseModels, setHideBaseModels] = useState(false);

  // Always fetch improvement metrics data (query key includes mode for per-mode caching)
  const { data: pivotedData = [], isLoading, isFetching, refetch } = useQuery<PivotedLeaderboardRowWithImprovement[]>({
    queryKey: [
      `/api/leaderboard-pivoted-with-improvement?mode=${selectionMode}&hideNoTraceLink=${hideNoTraceLink}` +
      `&track=${track}` +
      (track === 'non-agentic' && nonAgenticView !== 'overview' ? `&capability=${nonAgenticView}` : ''),
    ],
  });

  // Columns the selected non-agentic view SHOULD show, straight from the
  // registry rather than from the data -- so a capability nobody has evaluated
  // renders as an empty column instead of silently not existing.
  const { data: registryColumns = [] } = useQuery<{ canonicalName: string; displayName: string; capability: string }[]>({
    queryKey: [`/api/benchmark-columns?track=${track}&capability=${nonAgenticView}`],
    enabled: track === 'non-agentic',
  });

  const forcedBenchmarks = useMemo(
    () => (track === 'non-agentic' ? registryColumns.map(c => c.canonicalName) : undefined),
    [track, registryColumns],
  );

  const handleRefresh = () => {
    refetch();
  };

  const availableModels = useMemo(() => {
    let models = pivotedData;
    if (!showDuplicateModels) {
      models = models.filter(item => item.modelDuplicateOf === null);
    }
    return Array.from(new Set(models.map((item) => item.modelName))).sort();
  }, [pivotedData, showDuplicateModels]);

  const availableAgents = useMemo(() => {
    let agents = pivotedData;
    if (!showDuplicateAgents) {
      agents = agents.filter(item => item.agentDuplicateOf === null);
    }
    return Array.from(new Set(agents.map((item) => item.agentName))).sort();
  }, [pivotedData, showDuplicateAgents]);

  const availableEvalAgents = useMemo(() => {
    // Only known eval agents that actually appear in the data
    const allAgents = new Set(pivotedData.map(item => item.agentName));
    return Array.from(EVAL_AGENT_NAMES).filter(a => allAgents.has(a)).sort();
  }, [pivotedData]);

  const availableTrainingAgents = useMemo(() => {
    const trainingSet = new Set<string>();
    pivotedData.forEach(item => {
      if (item.agentName && !EVAL_AGENT_NAMES.has(item.agentName)) trainingSet.add(item.agentName);
      if (item.trainingAgentName && !EVAL_AGENT_NAMES.has(item.trainingAgentName)) trainingSet.add(item.trainingAgentName);
    });
    return Array.from(trainingSet).sort();
  }, [pivotedData]);

  const availableBaseModels = useMemo(() => {
    const field = showDuplicateModels ? 'baseModelName' : 'canonicalBaseModelName';
    return Array.from(new Set(
      pivotedData.map((item) => item[field]).filter(Boolean)
    )).sort();
  }, [pivotedData, showDuplicateModels]);

  const availableTrainingTypes = useMemo(() => {
    return Array.from(new Set(
      pivotedData.map((item) => item.trainingType || 'None')
    )).sort();
  }, [pivotedData]);

  const availableModelSizes = useMemo(() => {
    const sizes = new Set<string>();
    pivotedData.forEach((item) => {
      sizes.add(item.modelSizeB != null ? `${Math.floor(item.modelSizeB)}B` : 'Unknown');
    });
    return Array.from(sizes).sort((a, b) => {
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      return parseInt(a) - parseInt(b);
    });
  }, [pivotedData]);

  const availableBenchmarks = useMemo(() => {
    const benchmarkSet = new Set<string>();
    pivotedData.forEach(row => {
      Object.entries(row.benchmarks).forEach(([name, data]) => {
        if (showDuplicateBenchmarks || !data.benchmarkDuplicateOf) {
          benchmarkSet.add(name);
        }
      });
    });
    return Array.from(benchmarkSet).sort(compareBenchmarks);
  }, [pivotedData, showDuplicateBenchmarks]);

  // Build a map of duplicate benchmark -> canonical benchmark from the data
  const benchmarkDuplicateMap = useMemo(() => {
    const map = new Map<string, string>(); // duplicateName -> canonicalName
    pivotedData.forEach(row => {
      Object.entries(row.benchmarks).forEach(([benchmarkName, benchmarkData]) => {
        if (benchmarkData.benchmarkDuplicateOf && benchmarkData.canonicalBenchmarkName) {
          map.set(benchmarkName, benchmarkData.canonicalBenchmarkName);
        }
      });
    });
    return map;
  }, [pivotedData]);

  // Build reverse map: canonical -> array of duplicate benchmark names
  const canonicalToDuplicatesMap = useMemo(() => {
    const map = new Map<string, string[]>(); // canonicalName -> [duplicateName1, duplicateName2, ...]
    benchmarkDuplicateMap.forEach((canonicalName, duplicateName) => {
      const existing = map.get(canonicalName) || [];
      existing.push(duplicateName);
      map.set(canonicalName, existing);
    });
    return map;
  }, [benchmarkDuplicateMap]);

  // Only canonical benchmarks (not duplicates) for the top performer dropdown
  const canonicalBenchmarks = useMemo(() => {
    return availableBenchmarks.filter(benchmark => !benchmarkDuplicateMap.has(benchmark));
  }, [availableBenchmarks, benchmarkDuplicateMap]);

  // Filter by view mode: Top N + Recent N
  const filteredByViewMode = useMemo(() => {
    if (activeTab !== 'filtered') {
      return pivotedData; // No filtering for non-filtered tabs
    }

    // Helper function to get accuracy for sorting (canonical or duplicate fallback)
    const getAccuracyForSorting = (row: PivotedLeaderboardRowWithImprovement, benchmarkName: string): number => {
      // First try canonical benchmark
      const canonicalData = row.benchmarks[benchmarkName];
      if (canonicalData !== undefined) {
        return canonicalData.accuracy ?? -Infinity;
      }

      // Fall back to duplicates
      const duplicates = canonicalToDuplicatesMap.get(benchmarkName) || [];
      if (duplicates.length === 0) {
        return -Infinity;
      }

      // Find duplicate results for this row
      const duplicateResults = duplicates
        .map(dupName => row.benchmarks[dupName])
        .filter(data => data !== undefined);

      if (duplicateResults.length === 0) {
        return -Infinity;
      }

      // Use first duplicate's accuracy (duplicates are already deduplicated per model-agent-benchmark)
      return duplicateResults[0].accuracy ?? -Infinity;
    };

    // Filter: rows with selected benchmark OR any of its duplicates
    const duplicatesOfSelected = canonicalToDuplicatesMap.get(topPerformerBenchmark) || [];
    const dataWithBenchmark = pivotedData.filter(row => {
      if (row.benchmarks[topPerformerBenchmark] !== undefined) return true;
      return duplicatesOfSelected.some(dup => row.benchmarks[dup] !== undefined);
    });

    // Top N by selected benchmark accuracy (descending), with duplicate fallback
    const topPerformers = [...dataWithBenchmark]
      .sort((a, b) => {
        const accuracyA = getAccuracyForSorting(a, topPerformerBenchmark);
        const accuracyB = getAccuracyForSorting(b, topPerformerBenchmark);
        return accuracyB - accuracyA;
      })
      .slice(0, topN === Number.MAX_SAFE_INTEGER ? undefined : topN);

    // N Most Recently Added — sort by modelCreatedAt only
    const safeDateMs = (s: string | undefined) => {
      if (!s || s === '—') return NaN;
      const t = new Date(s).getTime();
      return isNaN(t) ? -Infinity : t;
    };
    const dataWithCreatedAt = pivotedData.filter(row => row.modelCreatedAt && row.modelCreatedAt !== '—' && !isNaN(new Date(row.modelCreatedAt).getTime()));
    const mostRecentlyAdded = [...dataWithCreatedAt]
      .sort((a, b) => safeDateMs(b.modelCreatedAt) - safeDateMs(a.modelCreatedAt))
      .slice(0, recentlyAddedN === Number.MAX_SAFE_INTEGER ? undefined : recentlyAddedN);

    // N Most Recently Evaluated — sort by latestEvalEndedAt only (no fallback)
    const dataWithEvalAt = pivotedData.filter(row => row.latestEvalEndedAt && row.latestEvalEndedAt !== '—' && !isNaN(new Date(row.latestEvalEndedAt).getTime()));
    const mostRecentlyEvaled = [...dataWithEvalAt]
      .sort((a, b) => safeDateMs(b.latestEvalEndedAt) - safeDateMs(a.latestEvalEndedAt))
      .slice(0, recentlyEvaledN === Number.MAX_SAFE_INTEGER ? undefined : recentlyEvaledN);

    // Union: Remove duplicates using Map
    const uniqueMap = new Map<string, PivotedLeaderboardRowWithImprovement>();
    topPerformers.forEach(row => {
      uniqueMap.set(`${row.modelName}|||${row.agentName}`, row);
    });
    mostRecentlyAdded.forEach(row => {
      uniqueMap.set(`${row.modelName}|||${row.agentName}`, row);
    });
    mostRecentlyEvaled.forEach(row => {
      uniqueMap.set(`${row.modelName}|||${row.agentName}`, row);
    });

    return Array.from(uniqueMap.values());
  }, [pivotedData, activeTab, topN, recentlyAddedN, recentlyEvaledN, topPerformerBenchmark, canonicalToDuplicatesMap]);

  // Pre-filter data based on active tab
  const tabFilteredData = useMemo(() => {
    switch (activeTab) {
      case 'blacklisted':
        return pivotedData.filter(row => BLACKLISTED_MODELS.has(row.modelName));
      case 'base':
        return pivotedData.filter(row => row.baseModelName === 'None');
      case 'active':
        return pivotedData.filter(row =>
          row.baseModelName !== 'None' && !BLACKLISTED_MODELS.has(row.modelName)
        );
      case 'all':
        return pivotedData;
      case 'filtered':
        return filteredByViewMode;
      case 'a1':
        return pivotedData.filter(row => row.modelName.startsWith('DCAgent/a1-'));
      case 'b1':
        return pivotedData.filter(row => row.modelName.startsWith('DCAgent/b1_'));
      case 'c1':
        return pivotedData.filter(row => row.modelName.startsWith('DCAgent/c1_'));
      case 'd1':
        return pivotedData.filter(row => row.modelName.startsWith('DCAgent/d1_'));
      case 'e1':
        return pivotedData.filter(row => row.modelName.startsWith('DCAgent/e1_'));
      case 'f1':
        return pivotedData.filter(row => row.modelName.startsWith('DCAgent/f1_'));
      case 'g1':
        return pivotedData.filter(row => row.modelName.startsWith('DCAgent/g1_'));
      case 'ood':
        return pivotedData;
      case 'war':
        // Match against the canonical model name so duplicate-model rows
        // (e.g. openai/Foo as duplicate_of Foo) pass through and get merged
        // into the canonical row by the table's duplicate-merge step.
        return pivotedData.filter(row => WAR_MODELS.has(row.canonicalModelName ?? row.modelName));
      case 'table1':
        return pivotedData.filter(row => TABLE_1_MODELS.has(row.canonicalModelName ?? row.modelName));
      case 'scaling':
        return pivotedData.filter(row => SCALING_MODELS.has(row.canonicalModelName ?? row.modelName));
      case 'rl8b':
        // Models trained on the 8B RL base, plus the base model itself.
        return pivotedData.filter(row =>
          row.baseModelName === RL_8B_BASE_MODEL ||
          row.canonicalBaseModelName === RL_8B_BASE_MODEL ||
          (row.canonicalModelName ?? row.modelName) === RL_8B_BASE_MODEL
        );
      case 'guardrail':
        return pivotedData.filter(row =>
          Object.values(row.benchmarks).some(b => {
            const isFinished = b.jobStatus === 'Finished' || b.jobStatus === null;
            return isFinished && (b.isIncomplete || b.isHighErrors);
          })
        );
      case 'baselineData':
        return pivotedData.filter(row =>
          /(?:^|[/_-])(?:316|1000|3160|10000|31000|100000)(?:[/_-]|$)/.test(row.modelName)
        );
      case 'missingEval':
        // Pass all data — the table component applies the missing eval filter
        // after duplicate merging, so it's a strict subset of the All Models view
        return pivotedData;
    }
  }, [activeTab, pivotedData, filteredByViewMode]);

  // Initialize selectedBenchmarks with defaults only on first data load
  const hasInitializedBenchmarks = useRef(false);

  // Switching tab is a fresh data set with a different benchmark vocabulary,
  // so the column choice has to be made again.
  useEffect(() => {
    hasInitializedBenchmarks.current = false;
  }, [track, nonAgenticView]);

  useEffect(() => {
    if (pivotedData.length > 0 && !hasInitializedBenchmarks.current) {
      hasInitializedBenchmarks.current = true;
      // Non-agentic takes its columns from the registry, including capabilities
      // with no results. Agentic keeps the existing core-set default exactly.
      if (track === 'non-agentic') {
        if (forcedBenchmarks && forcedBenchmarks.length > 0) {
          setSelectedBenchmarks(forcedBenchmarks);
        }
        return;
      }
      const validDefaults = DEFAULT_VISIBLE_BENCHMARKS.filter(benchmark =>
        availableBenchmarks.includes(benchmark)
      );
      if (validDefaults.length > 0) {
        setSelectedBenchmarks(validDefaults);
      }
    }
  }, [pivotedData, availableBenchmarks, track, nonAgenticView, forcedBenchmarks]);

  const handleClearFilters = () => {
    setSelectedModels([]);
    setSelectedAgents([]);
    setSelectedTrainingAgents([]);
    setSelectedBaseModels([]);
    setSelectedBenchmarks([]);
    setSelectedTrainingTypes([]);
    setSelectedModelSizes([]);
  };

  const handleResetFilters = () => {
    setSelectedModels([]);
    setSelectedAgents([]);
    setSelectedTrainingAgents([]);
    setSelectedBaseModels([]);
    setSelectedTrainingTypes([]);
    setSelectedModelSizes([]);
    if (track === 'non-agentic') {
      setSelectedBenchmarks(forcedBenchmarks ?? []);
      return;
    }
    setSelectedBenchmarks(
      DEFAULT_VISIBLE_BENCHMARKS.filter(benchmark => availableBenchmarks.includes(benchmark)),
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading benchmark results...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16 gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold text-foreground truncate" data-testid="text-page-title">
                LLM Agent Benchmark
              </h1>
              <Badge variant="secondary" className="hidden sm:inline-flex" data-testid="text-total-entries">
                {pivotedData.length} rows
              </Badge>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                data-testid="button-refresh"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Evaluation track, and capability view within non-agentic (#7958) */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-3">
          <span className="text-sm font-medium text-foreground">Track:</span>
          <ToggleGroup
            type="single"
            value={track}
            onValueChange={(value) => { if (value) setTrack(value as Track); }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="agentic" data-testid="track-agentic">Agentic</ToggleGroupItem>
            <ToggleGroupItem value="non-agentic" data-testid="track-non-agentic">Non-agentic</ToggleGroupItem>
          </ToggleGroup>
          <span className="hidden sm:inline text-xs text-muted-foreground max-w-md">
            {track === 'agentic'
              ? 'Harbor agentic evals: SWE-bench, dev_set_v2, terminal_bench_2 and the rest.'
              : 'Evalchemy and lm-eval results. Empty columns are capabilities with no results yet.'}
          </span>
        </div>

        {track === 'non-agentic' && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-4">
            <span className="text-sm font-medium text-foreground">View:</span>
            <ToggleGroup
              type="single"
              value={nonAgenticView}
              onValueChange={(value) => { if (value) setNonAgenticView(value as NonAgenticView); }}
              variant="outline"
              size="sm"
            >
              {NON_AGENTIC_VIEWS.map(v => (
                <ToggleGroupItem key={v.id} value={v.id} data-testid={`view-${v.id}`}>
                  {v.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}

        {/* Eval Selection Mode */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-4 sm:mb-6">
          <span className="text-sm font-medium text-foreground">Result Selection:</span>
          <ToggleGroup
            type="single"
            value={selectionMode}
            onValueChange={(value) => { if (value) setSelectionMode(value as EvalSelectionMode); }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="oldest">Oldest</ToggleGroupItem>
            <ToggleGroupItem value="latest">Latest</ToggleGroupItem>
            <ToggleGroupItem value="highest">Highest</ToggleGroupItem>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
          </ToggleGroup>
          <span className="hidden sm:inline text-xs text-muted-foreground max-w-md">
            {SELECTION_MODE_DESCRIPTIONS[selectionMode]}
          </span>
          {isFetching && !isLoading && (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>

        <Tabs value={activeTab} onValueChange={(v) => {
          const newTab = v as typeof activeTab;
          setActiveTab(newTab);
          if (newTab === 'ood') {
            const validOOD = OOD_BENCHMARKS.filter(b => availableBenchmarks.includes(b));
            if (validOOD.length > 0) setSelectedBenchmarks(validOOD);
          } else if (newTab === 'war' || newTab === 'table1' || newTab === 'scaling' || newTab === 'rl8b') {
            const validBenchmarks = [...CORE_BENCHMARKS, ...OOD_BENCHMARKS].filter(b => availableBenchmarks.includes(b));
            if (validBenchmarks.length > 0) setSelectedBenchmarks(validBenchmarks);
          } else {
            const validCore = CORE_BENCHMARKS.filter(b => availableBenchmarks.includes(b));
            if (validCore.length > 0) setSelectedBenchmarks(validCore);
          }
        }}>
          <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
            <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
              <TabsTrigger value="all" className="text-xs sm:text-sm">All Models</TabsTrigger>
              <TabsTrigger value="base" className="text-xs sm:text-sm bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 data-[state=active]:bg-cyan-500/30">Base Models</TabsTrigger>
              <TabsTrigger value="a1" className="text-xs sm:text-sm bg-blue-500/15 text-blue-700 dark:text-blue-300 data-[state=active]:bg-blue-500/30">A1</TabsTrigger>
              <TabsTrigger value="b1" className="text-xs sm:text-sm bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 data-[state=active]:bg-emerald-500/30">B1</TabsTrigger>
              <TabsTrigger value="c1" className="text-xs sm:text-sm bg-teal-500/15 text-teal-700 dark:text-teal-300 data-[state=active]:bg-teal-500/30">C1</TabsTrigger>
              <TabsTrigger value="d1" className="text-xs sm:text-sm bg-amber-500/15 text-amber-700 dark:text-amber-300 data-[state=active]:bg-amber-500/30">D1</TabsTrigger>
              <TabsTrigger value="e1" className="text-xs sm:text-sm bg-rose-500/15 text-rose-700 dark:text-rose-300 data-[state=active]:bg-rose-500/30">E1</TabsTrigger>
              <TabsTrigger value="f1" className="text-xs sm:text-sm bg-pink-500/15 text-pink-700 dark:text-pink-300 data-[state=active]:bg-pink-500/30">F1</TabsTrigger>
              <TabsTrigger value="g1" className="text-xs sm:text-sm bg-violet-500/15 text-violet-700 dark:text-violet-300 data-[state=active]:bg-violet-500/30">G1</TabsTrigger>
              <TabsTrigger value="ood" className="text-xs sm:text-sm bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 data-[state=active]:bg-fuchsia-500/30">OOD</TabsTrigger>
              <TabsTrigger value="war" className="text-xs sm:text-sm bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 data-[state=active]:bg-yellow-500/30 font-bold">WAR</TabsTrigger>
              <TabsTrigger value="table1" className="text-xs sm:text-sm bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 data-[state=active]:bg-indigo-500/30">Table 1</TabsTrigger>
              <TabsTrigger value="scaling" className="text-xs sm:text-sm bg-sky-500/15 text-sky-700 dark:text-sky-300 data-[state=active]:bg-sky-500/30">Scaling</TabsTrigger>
              <TabsTrigger value="rl8b" className="text-xs sm:text-sm bg-lime-500/15 text-lime-700 dark:text-lime-300 data-[state=active]:bg-lime-500/30">8B RL</TabsTrigger>
              <TabsTrigger value="baselineData" className="text-xs sm:text-sm bg-purple-500/15 text-purple-700 dark:text-purple-300 data-[state=active]:bg-purple-500/30">Baseline Data</TabsTrigger>
              <TabsTrigger value="missingEval" className="text-xs sm:text-sm bg-red-500/15 text-red-700 dark:text-red-300 data-[state=active]:bg-red-500/30">Missing Eval</TabsTrigger>
              <TabsTrigger value="guardrail" className="text-xs sm:text-sm bg-orange-500/15 text-orange-700 dark:text-orange-300 data-[state=active]:bg-orange-500/30">Guardrail</TabsTrigger>
              <TabsTrigger value="filtered" className="text-xs sm:text-sm">Filtered View</TabsTrigger>
              <TabsTrigger value="active" className="text-xs sm:text-sm">Active</TabsTrigger>
              <TabsTrigger value="blacklisted" className="text-xs sm:text-sm">Blacklisted</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="filtered" className="space-y-6">
            <ViewModeControls
              topN={topN}
              recentlyAddedN={recentlyAddedN}
              recentlyEvaledN={recentlyEvaledN}
              onTopNChange={setTopN}
              onRecentlyAddedNChange={setRecentlyAddedN}
              onRecentlyEvaledNChange={setRecentlyEvaledN}
              currentCount={filteredByViewMode.length}
              availableBenchmarks={canonicalBenchmarks}
              topPerformerBenchmark={topPerformerBenchmark}
              onTopPerformerBenchmarkChange={setTopPerformerBenchmark}
            />

            <SearchBarWithBaseModel
            modelSearch={modelSearch}
            agentSearch={agentSearch}
            baseModelSearch={baseModelSearch}
            benchmarkSearch={benchmarkSearch}
            onModelSearchChange={setModelSearch}
            onAgentSearchChange={setAgentSearch}
            onBaseModelSearchChange={setBaseModelSearch}
            onBenchmarkSearchChange={setBenchmarkSearch}
          />

          {/* Filters */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <FilterControlsWithBaseModel
              availableModels={availableModels}
              availableAgents={availableAgents}
              availableEvalAgents={availableEvalAgents}
              availableTrainingAgents={availableTrainingAgents}
              availableBaseModels={availableBaseModels}
              availableBenchmarks={availableBenchmarks}
              availableTrainingTypes={availableTrainingTypes}
              availableModelSizes={availableModelSizes}
              selectedModels={selectedModels}
              selectedAgents={selectedAgents}
              selectedTrainingAgents={selectedTrainingAgents}
              selectedBaseModels={selectedBaseModels}
              selectedBenchmarks={selectedBenchmarks}
              selectedTrainingTypes={selectedTrainingTypes}
              selectedModelSizes={selectedModelSizes}
              onModelsChange={setSelectedModels}
              onAgentsChange={setSelectedAgents}
              onTrainingAgentsChange={setSelectedTrainingAgents}
              onBaseModelsChange={setSelectedBaseModels}
              onBenchmarksChange={setSelectedBenchmarks}
              onTrainingTypesChange={setSelectedTrainingTypes}
              onModelSizesChange={setSelectedModelSizes}
              onClearAll={handleClearFilters}
              onReset={handleResetFilters}
            />

            {/* Duplicate Display Controls */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-duplicate-benchmarks"
                  checked={showDuplicateBenchmarks}
                  onCheckedChange={(checked) => setShowDuplicateBenchmarks(checked === true)}
                />
                <label
                  htmlFor="show-duplicate-benchmarks"
                  className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none"
                >
                  Show duplicate benchmarks
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-duplicate-models"
                  checked={showDuplicateModels}
                  onCheckedChange={(checked) => setShowDuplicateModels(checked === true)}
                />
                <label
                  htmlFor="show-duplicate-models"
                  className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none"
                >
                  Show duplicate models
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-duplicate-agents"
                  checked={showDuplicateAgents}
                  onCheckedChange={(checked) => setShowDuplicateAgents(checked === true)}
                />
                <label
                  htmlFor="show-duplicate-agents"
                  className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none"
                >
                  Show duplicate agents
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="hide-no-trace-link"
                  checked={hideNoTraceLink}
                  onCheckedChange={(checked) => setHideNoTraceLink(checked === true)}
                />
                <label
                  htmlFor="hide-no-trace-link"
                  className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none"
                >
                  Hide evals with no trace link
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="hide-blacklisted"
                  checked={hideBlacklisted}
                  onCheckedChange={(checked) => setHideBlacklisted(checked === true)}
                />
                <label
                  htmlFor="hide-blacklisted"
                  className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none"
                >
                  Hide blacklisted models
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="hide-base-models"
                  checked={hideBaseModels}
                  onCheckedChange={(checked) => setHideBaseModels(checked === true)}
                />
                <label
                  htmlFor="hide-base-models"
                  className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none"
                >
                  Hide base models
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-4 px-3 py-3 bg-muted/30 rounded-md text-sm text-muted-foreground">
            {/* Row Highlighting */}
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Row Highlighting</p>
                  <p className="text-xs">
                    <span className="inline-block w-3 h-3 rounded bg-blue-100 dark:bg-blue-900/60 border mr-1 align-middle" /> Base models (no base model).{' '}
                    <span className="inline-block w-3 h-3 rounded bg-neutral-200 dark:bg-neutral-800/70 border mr-1 align-middle" /> Blacklisted models.
                  </p>
                </div>
              </div>
            </div>

            {/* Metrics Explanation */}
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Standard Error (±)</p>
                  <p className="text-xs">Calculated over 3 runs. Shows variability in model performance.</p>
                </div>
              </div>
              <div className="flex items-start gap-2 ml-6">
                <div className="w-4 h-4" />
                <div>
                  <p className="font-medium text-foreground">Improvement (pp)</p>
                  <p className="text-xs">Percentage points gained over base model (e.g., +1.02 pp = 1.02% improvement). Green text indicates positive improvement, red indicates regression.</p>
                </div>
              </div>
            </div>

            {/* Sorting Explanation */}
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Column Sorting</p>
                  <p className="text-xs">For each benchmark, click "Acc" to sort by accuracy or "Imp" to sort by improvement over base model. Gray buttons indicate that sorting mode is inactive.</p>
                </div>
              </div>
            </div>

            {/* Traces Legend */}
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p className="font-medium text-foreground">Trace Links</p>
              </div>
              <div className="flex items-center gap-4 text-xs ml-6">
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center justify-center w-5 h-5 rounded border-2 border-primary bg-primary/10">
                    <ExternalLink className="w-3 h-3 text-primary" />
                  </div>
                  <span>Available</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center justify-center w-5 h-5 rounded border border-muted-foreground/20 bg-muted/50">
                    <ExternalLink className="w-3 h-3 text-muted-foreground/40" />
                  </div>
                  <span>Unavailable</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center justify-center w-5 h-5 rounded border border-red-500/50 bg-red-500/10">
                    <AlertCircle className="w-3 h-3 text-red-500" />
                  </div>
                  <span>Missing</span>
                </div>
              </div>
            </div>

            {/* Timestamp Columns Legend */}
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Timestamp Columns (Pacific Time)</p>
                  <p className="text-xs">All timestamps are displayed in Pacific Time (PST/PDT, America/Los_Angeles).</p>
                  <p className="text-xs mt-1"><strong>Model Added At:</strong> When the model was registered in the database.</p>
                  <p className="text-xs mt-1"><strong>First Eval At:</strong> The earliest evaluation completion time across all benchmarks for this model+agent combination.</p>
                  <p className="text-xs mt-1"><strong>Latest Eval At:</strong> The most recent evaluation completion time across all benchmarks for this model+agent combination.</p>
                </div>
              </div>
            </div>

            {/* Result Selection */}
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Result Selection ({selectionMode.charAt(0).toUpperCase() + selectionMode.slice(1)} mode)</p>
                  <p className="text-xs">
                    {SELECTION_MODE_DESCRIPTIONS[selectionMode]}
                    {' '}Results from equivalent benchmarks (canonical + duplicates) are merged into one pool before selection.
                  </p>
                </div>
              </div>
            </div>

            {/* Config Metadata Badges */}
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Config Metadata Badges</p>
                  <p className="text-xs">Each benchmark cell displays configuration badges indicating the evaluation environment settings. Badges are only shown for finished evaluations.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs ml-6">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] rounded-full px-2 py-0.5 border bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25">T:2x</span>
                  <span>Timeout multiplier (e.g., 2x = double the default timeout)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] rounded-full px-2 py-0.5 border bg-muted/50 text-muted-foreground/50 border-muted-foreground/20">T:N/A</span>
                  <span>Timeout not configured</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs ml-6">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] rounded-full px-2 py-0.5 border whitespace-nowrap bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25">D: Snapshot</span>
                  <span>Daytona sandbox with auto-snapshot enabled</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] rounded-full px-2 py-0.5 border whitespace-nowrap bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30">D: snapshot_old</span>
                  <span>Snapshot eval run before resource config change on 2026-04-13</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] rounded-full px-2 py-0.5 border bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25">D: 4/8/32</span>
                  <span>Daytona sandbox overrides: CPUs / Memory (GB) / Storage (GB). "x" = not overridden</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] rounded-full px-2 py-0.5 border whitespace-nowrap bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25">D: Default</span>
                  <span>Default Daytona sandbox config (no overrides, no snapshot)</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs ml-6">
                <div className="flex items-start gap-2">
                  <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 whitespace-nowrap">Errors: N</span>
                  <span>
                    Shown when more than 10 trials failed with <span className="font-medium">non-benign</span> errors. Benign error types are excluded from the count:{' '}
                    <span className="font-mono">AgentTimeoutError</span>,{' '}
                    <span className="font-mono">ContextLengthExceededError</span>,{' '}
                    <span className="font-mono">SummarizationTimeout</span>/<span className="font-mono">SummarizationTimeoutError</span>,{' '}
                    <span className="font-mono">BadRequestError</span>,{' '}
                    <span className="font-mono">NonZeroAgentExitCodeError</span>,{' '}
                    <span className="font-mono">VerifierRuntimeError</span>.
                  </span>
                </div>
              </div>
            </div>

          </div>

            {/* Table */}
            <LeaderboardTableWithImprovement
              data={filteredByViewMode}
              modelSearch={modelSearch}
              agentSearch={agentSearch}
              baseModelSearch={baseModelSearch}
              benchmarkSearch={benchmarkSearch}
              filters={{
                models: selectedModels,
                agents: selectedAgents,
                trainingAgents: selectedTrainingAgents,
                baseModels: selectedBaseModels,
                benchmarks: selectedBenchmarks,
                trainingTypes: selectedTrainingTypes,
                modelSizes: selectedModelSizes,
              }}
              forcedBenchmarks={forcedBenchmarks}
              showDuplicateBenchmarks={showDuplicateBenchmarks}
              showDuplicateModels={showDuplicateModels}
              showDuplicateAgents={showDuplicateAgents}
              hideBlacklisted={hideBlacklisted}
              hideBaseModels={hideBaseModels}
            />
          </TabsContent>

          {/* Shared content for all non-filtered tabs */}
          {(['all', 'base', 'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'ood', 'war', 'table1', 'scaling', 'rl8b', 'baselineData', 'missingEval', 'guardrail', 'active', 'blacklisted'] as const).map(tabValue => (
            <TabsContent key={tabValue} value={tabValue} className="space-y-6">
              <SearchBarWithBaseModel
                modelSearch={modelSearch}
                agentSearch={agentSearch}
                baseModelSearch={baseModelSearch}
                benchmarkSearch={benchmarkSearch}
                onModelSearchChange={setModelSearch}
                onAgentSearchChange={setAgentSearch}
                onBaseModelSearchChange={setBaseModelSearch}
                onBenchmarkSearchChange={setBenchmarkSearch}
              />

              {/* Filters */}
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <FilterControlsWithBaseModel
                  availableModels={availableModels}
                  availableAgents={availableAgents}
                  availableEvalAgents={availableEvalAgents}
                  availableTrainingAgents={availableTrainingAgents}
                  availableBaseModels={availableBaseModels}
                  availableBenchmarks={availableBenchmarks}
                  availableTrainingTypes={availableTrainingTypes}
                  availableModelSizes={availableModelSizes}
                  selectedModels={selectedModels}
                  selectedAgents={selectedAgents}
                  selectedTrainingAgents={selectedTrainingAgents}
                  selectedBaseModels={selectedBaseModels}
                  selectedBenchmarks={selectedBenchmarks}
                  selectedTrainingTypes={selectedTrainingTypes}
                  selectedModelSizes={selectedModelSizes}
                  onModelsChange={setSelectedModels}
                  onAgentsChange={setSelectedAgents}
                  onTrainingAgentsChange={setSelectedTrainingAgents}
                  onBaseModelsChange={setSelectedBaseModels}
                  onBenchmarksChange={setSelectedBenchmarks}
                  onTrainingTypesChange={setSelectedTrainingTypes}
                  onModelSizesChange={setSelectedModelSizes}
                  onClearAll={handleClearFilters}
                  onReset={handleResetFilters}
                />

                {/* Duplicate Display Controls */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-6">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`show-duplicate-benchmarks-${tabValue}`}
                      checked={showDuplicateBenchmarks}
                      onCheckedChange={(checked) => setShowDuplicateBenchmarks(checked === true)}
                    />
                    <label
                      htmlFor={`show-duplicate-benchmarks-${tabValue}`}
                      className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none"
                    >
                      Show duplicate benchmarks
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`show-duplicate-models-${tabValue}`}
                      checked={showDuplicateModels}
                      onCheckedChange={(checked) => setShowDuplicateModels(checked === true)}
                    />
                    <label
                      htmlFor={`show-duplicate-models-${tabValue}`}
                      className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none"
                    >
                      Show duplicate models
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`show-duplicate-agents-${tabValue}`}
                      checked={showDuplicateAgents}
                      onCheckedChange={(checked) => setShowDuplicateAgents(checked === true)}
                    />
                    <label
                      htmlFor={`show-duplicate-agents-${tabValue}`}
                      className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none"
                    >
                      Show duplicate agents
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`hide-no-trace-link-${tabValue}`}
                      checked={hideNoTraceLink}
                      onCheckedChange={(checked) => setHideNoTraceLink(checked === true)}
                    />
                    <label
                      htmlFor={`hide-no-trace-link-${tabValue}`}
                      className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none"
                    >
                      Hide evals with no trace link
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`hide-blacklisted-${tabValue}`}
                      checked={hideBlacklisted}
                      onCheckedChange={(checked) => setHideBlacklisted(checked === true)}
                    />
                    <label
                      htmlFor={`hide-blacklisted-${tabValue}`}
                      className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none"
                    >
                      Hide blacklisted models
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`hide-base-models-${tabValue}`}
                      checked={hideBaseModels}
                      onCheckedChange={(checked) => setHideBaseModels(checked === true)}
                    />
                    <label
                      htmlFor={`hide-base-models-${tabValue}`}
                      className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none"
                    >
                      Hide base models
                    </label>
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-3 py-3 bg-muted/30 rounded-md text-sm text-muted-foreground">
                {/* Row Highlighting */}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Row Highlighting</p>
                      <p className="text-xs">
                        <span className="inline-block w-3 h-3 rounded bg-blue-100 dark:bg-blue-900/60 border mr-1 align-middle" /> Base models (no base model).{' '}
                        <span className="inline-block w-3 h-3 rounded bg-neutral-200 dark:bg-neutral-800/70 border mr-1 align-middle" /> Blacklisted models.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Metrics Explanation */}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Standard Error (±)</p>
                      <p className="text-xs">Calculated over 3 runs. Shows variability in model performance.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 ml-6">
                    <div className="w-4 h-4" />
                    <div>
                      <p className="font-medium text-foreground">Improvement (pp)</p>
                      <p className="text-xs">Percentage points gained over base model (e.g., +1.02 pp = 1.02% improvement). Green text indicates positive improvement, red indicates regression.</p>
                    </div>
                  </div>
                </div>

                {/* Sorting Explanation */}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Column Sorting</p>
                      <p className="text-xs">For each benchmark, click "Acc" to sort by accuracy or "Imp" to sort by improvement over base model. Gray buttons indicate that sorting mode is inactive.</p>
                    </div>
                  </div>
                </div>

                {/* Traces Legend */}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <p className="font-medium text-foreground">Trace Links</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs ml-6">
                    <div className="flex items-center gap-2">
                      <div className="inline-flex items-center justify-center w-5 h-5 rounded border-2 border-primary bg-primary/10">
                        <ExternalLink className="w-3 h-3 text-primary" />
                      </div>
                      <span>Available</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="inline-flex items-center justify-center w-5 h-5 rounded border border-muted-foreground/20 bg-muted/50">
                        <ExternalLink className="w-3 h-3 text-muted-foreground/40" />
                      </div>
                      <span>Unavailable</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="inline-flex items-center justify-center w-5 h-5 rounded border border-red-500/50 bg-red-500/10">
                        <AlertCircle className="w-3 h-3 text-red-500" />
                      </div>
                      <span>Missing</span>
                    </div>
                  </div>
                </div>

                {/* Timestamp Columns Legend */}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Timestamp Columns</p>
                      <p className="text-xs"><strong>First Eval Ended At:</strong> The earliest evaluation completion time across all benchmarks for this model+agent combination.</p>
                      <p className="text-xs mt-1"><strong>Latest Eval Ended At:</strong> The most recent evaluation completion time across all benchmarks for this model+agent combination.</p>
                    </div>
                  </div>
                </div>

                {/* Result Selection */}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Result Selection ({selectionMode.charAt(0).toUpperCase() + selectionMode.slice(1)} mode)</p>
                      <p className="text-xs">
                        {SELECTION_MODE_DESCRIPTIONS[selectionMode]}
                        {' '}Results from equivalent benchmarks (canonical + duplicates) are merged into one pool before selection.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Config Metadata Badges */}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Config Metadata Badges</p>
                      <p className="text-xs">Each benchmark cell displays configuration badges indicating the evaluation environment settings.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs ml-6">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] rounded-full px-2 py-0.5 border bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25">T:2x</span>
                      <span>Timeout multiplier (e.g. 2x = double the default timeout)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] rounded-full px-2 py-0.5 border bg-muted/50 text-muted-foreground/50 border-muted-foreground/20">T:N/A</span>
                      <span>Default timeout (not configured / not found)</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs ml-6">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] rounded-full px-2 py-0.5 border bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25">D:4/8/32</span>
                      <span>Daytona sandbox overrides: CPUs / Memory (GB) / Storage (GB)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] rounded-full px-2 py-0.5 border bg-muted/50 text-muted-foreground/50 border-muted-foreground/20">D:?/?/?</span>
                      <span>Default sandbox config (not configured / not found)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Table */}
              <LeaderboardTableWithImprovement
                data={tabFilteredData}
                modelSearch={modelSearch}
                agentSearch={agentSearch}
                baseModelSearch={baseModelSearch}
                benchmarkSearch={benchmarkSearch}
                filters={{
                  models: selectedModels,
                  agents: selectedAgents,
                  trainingAgents: selectedTrainingAgents,
                  baseModels: selectedBaseModels,
                  benchmarks: selectedBenchmarks,
                  trainingTypes: selectedTrainingTypes,
                  modelSizes: selectedModelSizes,
                }}
                forcedBenchmarks={forcedBenchmarks}
              showDuplicateBenchmarks={showDuplicateBenchmarks}
                showDuplicateModels={showDuplicateModels}
                showDuplicateAgents={showDuplicateAgents}
                hideBlacklisted={hideBlacklisted}
                hideBaseModels={hideBaseModels}
                filterMissingEval={tabValue === 'missingEval'}
                customOrder={
                  tabValue === 'table1' ? TABLE_1_ORDER :
                  tabValue === 'war' ? WAR_ORDER :
                  tabValue === 'scaling' ? SCALING_ORDER :
                  undefined
                }
                sectionByModel={
                  tabValue === 'table1' ? TABLE_1_SECTION_BY_MODEL :
                  tabValue === 'war' ? WAR_SECTION_BY_MODEL :
                  tabValue === 'scaling' ? SCALING_SECTION_BY_MODEL :
                  undefined
                }
              />
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
}
