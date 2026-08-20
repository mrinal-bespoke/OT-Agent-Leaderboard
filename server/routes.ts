import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, type EvalSelectionMode } from "./storage";
import { familyToTrack, parseFamily } from "@shared/benchmark-families";
import { parseCapability, parseTrack } from "@shared/benchmark-registry";

export async function registerRoutes(app: Express): Promise<Server> {
  // Get all benchmark results
  app.get("/api/benchmark-results", async (req, res) => {
    try {
      const results = await storage.getAllBenchmarkResults();
      res.json(results);
    } catch (error) {
      console.error("Error fetching benchmark results:", error);
      res.status(500).json({ error: "Failed to fetch benchmark results" });
    }
  });

  // Get single benchmark result
  app.get("/api/benchmark-results/:id", async (req, res) => {
    try {
      const result = await storage.getBenchmarkResult(req.params.id);
      if (!result) {
        return res.status(404).json({ error: "Benchmark result not found" });
      }
      res.json(result);
    } catch (error) {
      console.error("Error fetching benchmark result:", error);
      res.status(500).json({ error: "Failed to fetch benchmark result" });
    }
  });

  // Get pivoted leaderboard data (benchmarks as columns)
  app.get("/api/leaderboard-pivoted", async (req, res) => {
    try {
      const results = await storage.getAllBenchmarkResults();

      // Group by (model, agent) combination
      const groupedData = new Map<string, {
        modelName: string;
        agentName: string;
        firstEvalEndedAt?: string;
        latestEvalEndedAt?: string;
        benchmarks: Record<string, { accuracy: number; standardError: number; hfTracesLink?: string }>;
      }>();

      for (const result of results) {
        const key = `${result.modelName}|||${result.agentName}`;

        if (!groupedData.has(key)) {
          groupedData.set(key, {
            modelName: result.modelName,
            agentName: result.agentName,
            firstEvalEndedAt: result.endedAt,
            latestEvalEndedAt: result.endedAt,
            benchmarks: {}
          });
        }

        const group = groupedData.get(key)!;
        // Update firstEvalEndedAt to the earliest timestamp
        if (!group.firstEvalEndedAt || (result.endedAt && result.endedAt < group.firstEvalEndedAt)) {
          group.firstEvalEndedAt = result.endedAt;
        }
        // Update latestEvalEndedAt to the latest timestamp
        if (!group.latestEvalEndedAt || (result.endedAt && result.endedAt > group.latestEvalEndedAt)) {
          group.latestEvalEndedAt = result.endedAt;
        }
        group.benchmarks[result.benchmarkName] = {
          accuracy: result.accuracy,
          standardError: result.standardError,
          hfTracesLink: result.hfTracesLink
        };
      }

      // Convert to array and sort by model name, then agent name
      const pivotedData = Array.from(groupedData.values()).sort((a, b) => {
        const modelCompare = a.modelName.localeCompare(b.modelName);
        if (modelCompare !== 0) return modelCompare;
        return a.agentName.localeCompare(b.agentName);
      });

      res.json(pivotedData);
    } catch (error) {
      console.error("Error fetching pivoted leaderboard:", error);
      res.status(500).json({ error: "Failed to fetch pivoted leaderboard" });
    }
  });

  // Get pivoted leaderboard data with improvement metrics
  app.get("/api/leaderboard-pivoted-with-improvement", async (req, res) => {
    try {
      // Validate and parse eval selection mode
      const modeParam = req.query.mode as string | undefined;
      const validModes: EvalSelectionMode[] = ['oldest', 'latest', 'highest', 'all'];
      const mode: EvalSelectionMode = modeParam && validModes.includes(modeParam as EvalSelectionMode)
        ? modeParam as EvalSelectionMode
        : 'oldest';

      const hideNoTraceLink = req.query.hideNoTraceLink === 'true';

      // Scope: track (+ optional capability). Defaults to the whole agentic
      // track, which is what every existing caller already receives.
      //
      // `family` is the superseded spelling and is still honoured for one
      // release so saved links keep working; an explicit `track` wins.
      const scope = req.query.track !== undefined
        ? (() => {
            const track = parseTrack(req.query.track);
            return { track, capability: parseCapability(req.query.capability, track) };
          })()
        : (() => {
            const { track, capabilities } = familyToTrack(parseFamily(req.query.family));
            // A legacy family can span capabilities (nlp = knowledge +
            // instruction); passing none means the whole track, so only narrow
            // when the family maps to exactly one.
            return { track, capability: capabilities?.length === 1 ? capabilities[0] : undefined };
          })();

      const results = await storage.getAllBenchmarkResultsWithImprovement(mode, hideNoTraceLink, scope);

      // Group by (model, agent) combination
      const groupedData = new Map<string, {
        modelName: string;
        agentName: string;
        trainingAgentName: string;
        isNoEval: boolean;
        modelId: string;
        baseModelName: string;
        trainingType?: string;
        modelSizeB?: number;
        firstEvalEndedAt?: string;
        latestEvalEndedAt?: string;
        modelCreatedAt?: string;
        // Duplicate tracking fields
        modelDuplicateOf: string | null;
        canonicalModelName: string;
        canonicalBaseModelName: string;
        agentDuplicateOf: string | null;
        canonicalAgentName: string;
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
          sourceBenchmarkName: string;
          sourceBenchmarkId: string;
          // Eval config metadata
          timeoutMultiplier?: number;
          daytonaOverrideCpus?: number;
          daytonaOverrideMemoryMb?: number;
          daytonaOverrideStorageMb?: number;
          autoSnapshot?: boolean;
          // Job status for progress tracking
          jobStatus: string | null;
          username: string | null;
          slurmJobId: string | null;
          jobCreatedAt?: string;
          isOverlong: boolean;
          isIncomplete: boolean;
          isHighErrors: boolean;
          invalidErrorCount?: number;
          completedTrials?: number;
          totalTrials?: number;
          // Free-text note from the job
          notes?: string;
          // "All" mode: array of all results for cycling
          allResults?: Array<Record<string, any>>;
        }>;
      }>();

      for (const result of results) {
        const key = `${result.modelName}|||${result.agentName}`;

        if (!groupedData.has(key)) {
          groupedData.set(key, {
            modelName: result.modelName,
            agentName: result.agentName,
            trainingAgentName: result.agentName, // Will be backfilled from models table later
            isNoEval: false,
            modelId: result.modelId,
            baseModelName: result.baseModelName,
            trainingType: result.trainingType,
            modelSizeB: result.modelSizeB,
            firstEvalEndedAt: result.endedAt,
            latestEvalEndedAt: result.endedAt,
            // Duplicate tracking fields
            modelDuplicateOf: result.modelDuplicateOf,
            canonicalModelName: result.canonicalModelName,
            canonicalBaseModelName: result.canonicalBaseModelName,
            agentDuplicateOf: result.agentDuplicateOf,
            canonicalAgentName: result.canonicalAgentName,
            benchmarks: {}
          });
        }

        const group = groupedData.get(key)!;
        // Update firstEvalEndedAt to the earliest timestamp
        if (!group.firstEvalEndedAt || (result.endedAt && result.endedAt < group.firstEvalEndedAt)) {
          group.firstEvalEndedAt = result.endedAt;
        }
        // Update latestEvalEndedAt to the latest timestamp
        if (!group.latestEvalEndedAt || (result.endedAt && result.endedAt > group.latestEvalEndedAt)) {
          group.latestEvalEndedAt = result.endedAt;
        }
        // For Pending/Started jobs, accuracy/standardError are 0 (from storage default) — treat as null
        const isFinished = result.jobStatus === 'Finished' || result.jobStatus === null;
        const accuracy = isFinished ? result.accuracy : null;
        const standardError = isFinished ? result.standardError : null;

        // Calculate improvement as absolute difference (percentage points) — only for Finished jobs
        // Fall back through canonical variants if direct base model accuracy isn't available
        const effectiveBaseModelAccuracy = result.baseModelAccuracy
          ?? result.canonicalBenchmarkBaseModelAccuracy
          ?? result.canonicalBaseModelAccuracy
          ?? result.canonicalBothBaseModelAccuracy;
        const improvement = (isFinished && effectiveBaseModelAccuracy !== undefined)
          ? result.accuracy - effectiveBaseModelAccuracy
          : undefined;

        const benchmarkEntry = {
          accuracy,
          standardError,
          hfTracesLink: result.hfTracesLink,
          baseModelAccuracy: result.baseModelAccuracy,
          improvement: improvement,
          // Additional accuracy values for duplicate-aware improvement recalculation
          canonicalBenchmarkBaseModelAccuracy: result.canonicalBenchmarkBaseModelAccuracy,
          canonicalBaseModelAccuracy: result.canonicalBaseModelAccuracy,
          canonicalBothBaseModelAccuracy: result.canonicalBothBaseModelAccuracy,
          // Duplicate tracking for benchmarks
          benchmarkDuplicateOf: result.benchmarkDuplicateOf,
          canonicalBenchmarkName: result.canonicalBenchmarkName,
          // Source benchmark (tracks which actual benchmark the result came from)
          sourceBenchmarkName: result.sourceBenchmarkName,
          sourceBenchmarkId: result.sourceBenchmarkId,
          // Eval config metadata
          timeoutMultiplier: result.timeoutMultiplier,
          daytonaOverrideCpus: result.daytonaOverrideCpus,
          daytonaOverrideMemoryMb: result.daytonaOverrideMemoryMb,
          daytonaOverrideStorageMb: result.daytonaOverrideStorageMb,
          autoSnapshot: result.autoSnapshot,
          // Job status for progress tracking
          jobStatus: result.jobStatus,
          username: result.username,
          slurmJobId: result.slurmJobId,
          // Job timestamp (for pending/started: COALESCE(started_at, created_at))
          jobCreatedAt: result.endedAt,
          isOverlong: result.isOverlong,
          isIncomplete: result.isIncomplete,
          isHighErrors: result.isHighErrors,
          invalidErrorCount: result.invalidErrorCount,
          completedTrials: result.completedTrials,
          totalTrials: result.totalTrials,
          notes: result.notes,
        };

        if (mode === 'all') {
          // In "all" mode, accumulate results into allResults array
          const existing = group.benchmarks[result.benchmarkName];
          if (existing) {
            if (!existing.allResults) {
              existing.allResults = [{ ...existing }];
              delete existing.allResults[0].allResults;
            }
            existing.allResults.push(benchmarkEntry);
          } else {
            group.benchmarks[result.benchmarkName] = { ...benchmarkEntry, allResults: [benchmarkEntry] };
          }
        } else {
          group.benchmarks[result.benchmarkName] = benchmarkEntry;
        }
      }

      // Fetch all registered models to backfill training agent info and add NO EVAL rows
      const allModels = await storage.getAllModels();

      const formatTimestamp = (ts: string) => {
        const d = new Date(ts);
        if (isNaN(d.getTime())) return ts;
        const formatted = d.toLocaleString('en-CA', {
          timeZone: 'America/Los_Angeles',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false,
        }).replace(',', '');
        return formatted.replace(/\b24:/, '00:');
      };

      // Build modelId → trainingAgentName, modelId → creationTime, modelId → trainingType lookups
      const modelTrainingAgentMap = new Map<string, string>();
      const modelCreationTimeMap = new Map<string, string>();
      const modelTrainingTypeMap = new Map<string, string>();
      const modelSizeBMap = new Map<string, number>();
      for (const model of allModels) {
        modelTrainingAgentMap.set(model.modelId, model.agentName);
        if (model.creationTime) {
          modelCreationTimeMap.set(model.modelId, model.creationTime);
        }
        if (model.trainingType) {
          modelTrainingTypeMap.set(model.modelId, model.trainingType);
        }
        if (model.modelSizeB !== null) {
          modelSizeBMap.set(model.modelId, model.modelSizeB);
        }
      }

      // Backfill trainingAgentName + modelCreatedAt + trainingType + modelSizeB on existing eval-result rows
      groupedData.forEach((group) => {
        group.trainingAgentName = modelTrainingAgentMap.get(group.modelId) ?? group.agentName;
        group.isNoEval = false;
        const ct = modelCreationTimeMap.get(group.modelId);
        if (ct) group.modelCreatedAt = formatTimestamp(ct);
        group.trainingType = modelTrainingTypeMap.get(group.modelId) ?? group.trainingType;
        group.modelSizeB = modelSizeBMap.get(group.modelId) ?? group.modelSizeB;
      });

      // Collect model names that have ANY eval results
      const modelNamesWithEvals = new Set<string>();
      groupedData.forEach(group => modelNamesWithEvals.add(group.modelName));

      // Add ONE "NO EVAL" row per model name that has zero eval results
      const noEvalModelsAdded = new Set<string>();
      for (const model of allModels) {
        if (modelNamesWithEvals.has(model.modelName)) continue;
        if (noEvalModelsAdded.has(model.modelName)) continue;
        noEvalModelsAdded.add(model.modelName);

        const key = `${model.modelName}|||NO EVAL`;
        groupedData.set(key, {
          modelName: model.modelName,
          agentName: 'NO EVAL',
          trainingAgentName: model.agentName,
          isNoEval: true,
          modelId: model.modelId,
          baseModelName: model.baseModelName,
          trainingType: model.trainingType ?? undefined,
          modelSizeB: model.modelSizeB ?? undefined,
          firstEvalEndedAt: undefined,
          latestEvalEndedAt: undefined,
          modelCreatedAt: model.creationTime ? formatTimestamp(model.creationTime) : undefined,
          modelDuplicateOf: model.modelDuplicateOf,
          canonicalModelName: model.canonicalModelName,
          canonicalBaseModelName: model.canonicalBaseModelName,
          agentDuplicateOf: null,
          canonicalAgentName: 'NO EVAL',
          benchmarks: {}
        });
      }

      // Remove NO EVAL rows for models that actually have eval rows
      // (defensive: handles edge cases where modelNamesWithEvals check is insufficient)
      const modelsWithRealEvals = new Set<string>();
      groupedData.forEach((group) => {
        if (!group.isNoEval) modelsWithRealEvals.add(group.modelName);
      });
      groupedData.forEach((group, key) => {
        if (group.isNoEval && modelsWithRealEvals.has(group.modelName)) {
          groupedData.delete(key);
        }
      });

      // Convert to array and sort by model name, then agent name
      let pivotedData = Array.from(groupedData.values()).sort((a, b) => {
        const modelCompare = a.modelName.localeCompare(b.modelName);
        if (modelCompare !== 0) return modelCompare;
        return a.agentName.localeCompare(b.agentName);
      });

      // On a standard-eval tab, drop models with no result in THIS family.
      //
      // The pivot emits one row per (model, agent) whether or not that model
      // has a score in the selected family, so without this the Math tab
      // renders every model in the registry with all cells blank -- 1,358 empty
      // rows against 0 real ones.
      //
      // Deliberately NOT applied to agentic: that board shows models with no
      // eval on purpose (the isNoEval flag and the "Missing Eval" tab depend on
      // them), so filtering there would remove a feature.
      if (scope.track !== 'agentic') {
        pivotedData = pivotedData.filter(row => Object.keys(row.benchmarks || {}).length > 0);
      }

      res.json(pivotedData);
    } catch (error) {
      console.error("Error fetching pivoted leaderboard with improvement:", error);
      res.status(500).json({ error: "Failed to fetch pivoted leaderboard with improvement" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
