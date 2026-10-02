import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DecisionRequest, DecisionResponse } from "../core/types.js";
import type { CheckpointLineageRegistry } from "../lineage/registry.js";
import {
  deriveLineageState,
  planRollback,
  recordRollback,
} from "../lineage/registry.js";
import { MockSystemOneProvider } from "../providers/mock.js";
import {
  buildCanaryActivationPolicy,
  CanaryActivationProvider,
  MemoryCanaryEvidenceSink,
  evaluateCanaryAdvance,
  summarizeCanaryTraces,
  type CanaryAdvanceEvidence,
  type CanaryActivationPolicy,
  type CanarySessionSummary,
  type CanaryTrace,
} from "./canary.js";

export interface CanaryRollbackDrillReport {
  schemaVersion: "mso.canary-rollback-drill.v0";
  drillId: string;
  createdAt: string;
  decisionSurface: string;
  candidateCheckpointId: string;
  rollbackTargetCheckpointId: string;
  passed: boolean;
  productionRegistryMutated: false;
  externalRuntimeAuthorityChanged: false;
  checks: {
    candidateInfluencedBeforeFault: boolean;
    faultTriggeredKill: boolean;
    faultFellBackToIncumbent: boolean;
    postKillStayedOnIncumbent: boolean;
    stageAdvanceHeld: boolean;
    rollbackPlanNonExecuting: boolean;
    simulatedRegistryRestoredTarget: boolean;
    originalRegistryHeadUnchanged: boolean;
  };
  summary: CanarySessionSummary;
  advance: CanaryAdvanceEvidence;
  artifacts: {
    policy: "policy.json";
    traces: "canary-traces.jsonl";
    advance: "advance.json";
    rollbackPlan: "rollback-plan.json";
    simulatedRegistry: "simulated-registry.json";
    report: "drill.json";
  };
}

export interface CanaryRollbackDrillResult {
  report: CanaryRollbackDrillReport;
  policy: CanaryActivationPolicy;
  traces: readonly CanaryTrace[];
  rollbackPlan: ReturnType<typeof planRollback>;
  simulatedRegistry: CheckpointLineageRegistry;
}

const response = (
  providerId: string,
  request: DecisionRequest,
): DecisionResponse => ({
  traceId: request.traceId,
  providerId,
  probabilitySemantics: "heuristic",
  confidenceSemantics: "selected_probability",
  calibrationStatus: "uncalibrated",
  results: {
    verdict: {
      type: "choice",
      selected: "accept",
      distribution: { accept: 0.9, reject: 0.1 },
      confidence: 0.9,
    },
  },
  estimatedCost: 0,
});

const drillRequest = (
  index: number,
  decisionSurface: string,
): DecisionRequest => ({
  traceId: `canary-drill-${index}`,
  pattern: "gate",
  state: `synthetic reversible canary request ${index}`,
  questions: {
    verdict: {
      type: "choice",
      prompt: "Should this synthetic reversible request proceed?",
      options: [
        { id: "accept", label: "Accept" },
        { id: "reject", label: "Reject" },
      ],
    },
  },
  metadata: {
    decisionSurface,
    canaryEligible: true,
    drill: true,
    reversible: true,
    impactClass: "low",
    riskTags: [],
  },
});

export const runCanaryRollbackDrill = async (
  registry: CheckpointLineageRegistry,
  options: {
    drillId?: string;
    rollbackTargetCheckpointId?: string;
  } = {},
): Promise<CanaryRollbackDrillResult> => {
  const before = deriveLineageState(registry);
  const candidateCheckpointId = before.recordedHeadCheckpointId;
  if (!candidateCheckpointId) {
    throw new Error("rollback drill requires a recorded lineage head");
  }
  const candidate = before.checkpoints[candidateCheckpointId];
  if (!candidate?.latestRollbackTargetId) {
    throw new Error("rollback drill requires a promoted head with rollback target");
  }
  const rollbackTargetCheckpointId =
    options.rollbackTargetCheckpointId ?? candidate.latestRollbackTargetId;

  const policy = buildCanaryActivationPolicy(registry, {
    policyId: `drill-policy-${candidateCheckpointId}`,
    candidateProviderId: "drill-candidate",
    incumbentProviderId: "drill-incumbent",
    stage: "limited_active",
    allowedPatterns: ["gate"],
    circuitBreaker: {
      maxConsecutiveCandidateErrors: 1,
      minCandidateAttemptsForErrorRate: 3,
      maxCandidateErrorRate: 0.34,
    },
  });

  let candidateCalls = 0;
  const incumbent = new MockSystemOneProvider({
    id: "drill-incumbent",
    responder: (request) => response("drill-incumbent", request),
  });
  const candidateProvider = new MockSystemOneProvider({
    id: "drill-candidate",
    responder: async (request) => {
      candidateCalls += 1;
      if (candidateCalls === 3) {
        throw new Error("synthetic candidate failure");
      }
      return response("drill-candidate", request);
    },
  });
  const sink = new MemoryCanaryEvidenceSink();
  const provider = new CanaryActivationProvider({
    incumbent,
    candidate: candidateProvider,
    policy,
    sink,
    sessionId: "canary-rollback-drill",
  });

  const returnedProviders: string[] = [];
  for (let index = 1; index <= 4; index += 1) {
    const result = await provider.decide(
      drillRequest(index, registry.decisionSurface),
    );
    returnedProviders.push(result.providerId);
  }
  await provider.flush();

  const summary = summarizeCanaryTraces(policy, sink.records);
  const advance = evaluateCanaryAdvance(summary, {
    minCandidateSelected: 3,
    maxCandidateErrorRate: 0,
    maxFallbackRate: 0,
    maxDisagreementRate: 1,
  });

  const rollbackPlan = planRollback(
    registry,
    rollbackTargetCheckpointId,
    {
      reason: "synthetic canary rollback drill candidate failure",
      planId: "rollback-drill-plan",
    },
  );
  const simulatedRegistry = recordRollback(
    registry,
    rollbackPlan,
    "drill:simulated-runtime-switch",
    {
      eventId: "rollback-drill-record",
    },
  );
  const after = deriveLineageState(simulatedRegistry);
  const originalAfter = deriveLineageState(registry);

  const checks = {
    candidateInfluencedBeforeFault:
      returnedProviders[0] === "drill-candidate" &&
      returnedProviders[1] === "drill-candidate",
    faultTriggeredKill:
      sink.records[2]?.killSwitchAtReturn.killed === true,
    faultFellBackToIncumbent:
      returnedProviders[2] === "drill-incumbent" &&
      sink.records[2]?.fallbackReason === "candidate_error",
    postKillStayedOnIncumbent:
      returnedProviders[3] === "drill-incumbent" &&
      sink.records[3]?.fallbackReason === "kill_switch" &&
      sink.records[3]?.candidate.status === "not_run",
    stageAdvanceHeld: advance.status === "fail",
    rollbackPlanNonExecuting:
      rollbackPlan.automaticExecution === false &&
      rollbackPlan.runtimeAuthorityChanged === false,
    simulatedRegistryRestoredTarget:
      after.recordedHeadCheckpointId === rollbackTargetCheckpointId &&
      after.checkpoints[rollbackTargetCheckpointId]?.lifecycle === "restored",
    originalRegistryHeadUnchanged:
      originalAfter.recordedHeadCheckpointId ===
        before.recordedHeadCheckpointId &&
      originalAfter.headEventHash === before.headEventHash,
  };
  const passed = Object.values(checks).every(Boolean);
  const createdAt = new Date().toISOString();
  const drillId =
    options.drillId ??
    `canary-drill-${createdAt.replace(/[:.]/g, "-")}`;

  return {
    report: {
      schemaVersion: "mso.canary-rollback-drill.v0",
      drillId,
      createdAt,
      decisionSurface: registry.decisionSurface,
      candidateCheckpointId,
      rollbackTargetCheckpointId,
      passed,
      productionRegistryMutated: false,
      externalRuntimeAuthorityChanged: false,
      checks,
      summary,
      advance,
      artifacts: {
        policy: "policy.json",
        traces: "canary-traces.jsonl",
        advance: "advance.json",
        rollbackPlan: "rollback-plan.json",
        simulatedRegistry: "simulated-registry.json",
        report: "drill.json",
      },
    },
    policy,
    traces: sink.records,
    rollbackPlan,
    simulatedRegistry,
  };
};

const jsonl = (rows: readonly unknown[]): string =>
  rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

export const writeCanaryRollbackDrill = async (
  outDir: string,
  result: CanaryRollbackDrillResult,
): Promise<void> => {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(
      join(outDir, "policy.json"),
      `${JSON.stringify(result.policy, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(outDir, "canary-traces.jsonl"),
      jsonl(result.traces),
      "utf8",
    ),
    writeFile(
      join(outDir, "advance.json"),
      `${JSON.stringify(result.report.advance, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(outDir, "rollback-plan.json"),
      `${JSON.stringify(result.rollbackPlan, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(outDir, "simulated-registry.json"),
      `${JSON.stringify(result.simulatedRegistry, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(outDir, "drill.json"),
      `${JSON.stringify(result.report, null, 2)}\n`,
      "utf8",
    ),
  ]);
};
