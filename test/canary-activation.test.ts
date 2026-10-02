import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionRequest, DecisionResponse } from "../src/core/types.js";
import {
  buildCanaryActivationPolicy,
  CanaryActivationProvider,
  CanaryKillSwitch,
  evaluateCanaryAdvance,
  MemoryCanaryEvidenceSink,
  summarizeCanaryTraces,
} from "../src/activation/canary.js";
import { runCanaryRollbackDrill } from "../src/activation/drill.js";
import {
  appendLineageEvent,
  createCheckpointLineageRegistry,
  deriveLineageState,
} from "../src/lineage/registry.js";
import { MockSystemOneProvider } from "../src/providers/mock.js";
import type { LayaCheckpointFingerprint } from "../src/reeval/checkpoint.js";

const checkpoint = (
  ref: string,
  fingerprint: string,
): LayaCheckpointFingerprint => ({
  schemaVersion: "mso.laya-checkpoint.v0",
  ref,
  format: "laya-ts-onnx",
  fingerprint,
  artifacts: [],
});

const promotedRegistry = () => {
  let registry = createCheckpointLineageRegistry(
    "asset-qa-canary",
    "asset.qa",
    new Date("2026-10-02T00:00:00.000Z"),
  );
  registry = appendLineageEvent(
    registry,
    {
      type: "checkpoint_registered",
      data: {
        checkpointId: "base-v1",
        checkpoint: checkpoint("base-v1", "a".repeat(64)),
        origin: "base",
        knownGood: true,
        knownGoodEvidenceRef: "baseline-approval:v1",
      },
    },
    {
      eventId: "register-base",
      now: new Date("2026-10-02T00:01:00.000Z"),
    },
  );
  registry = appendLineageEvent(
    registry,
    {
      type: "checkpoint_registered",
      data: {
        checkpointId: "candidate-v2",
        checkpoint: checkpoint("candidate-v2", "b".repeat(64)),
        origin: "fine_tune",
        knownGood: false,
        parentCheckpointId: "base-v1",
        reevalEvidenceRef: "reeval/v2/summary.json",
        reevalId: "reeval-v2",
      },
    },
    {
      eventId: "register-candidate",
      now: new Date("2026-10-02T00:02:00.000Z"),
    },
  );
  registry = appendLineageEvent(
    registry,
    {
      type: "promotion_recorded",
      data: {
        checkpointId: "candidate-v2",
        gateId: "gate-v2",
        gateEvidenceRef: "promotion/gate-v2.json",
        reevalId: "reeval-v2",
        reevalEvidenceRef: "reeval/v2/summary.json",
        rollbackTargetId: "base-v1",
      },
    },
    {
      eventId: "promote-candidate",
      now: new Date("2026-10-02T00:03:00.000Z"),
    },
  );
  return registry;
};

const response = (
  providerId: string,
  request: DecisionRequest,
  selected: "accept" | "reject" = "accept",
): DecisionResponse => ({
  traceId: request.traceId,
  providerId,
  probabilitySemantics: "heuristic",
  confidenceSemantics: "selected_probability",
  calibrationStatus: "uncalibrated",
  results: {
    verdict: {
      type: "choice",
      selected,
      distribution:
        selected === "accept"
          ? { accept: 0.9, reject: 0.1 }
          : { accept: 0.1, reject: 0.9 },
      confidence: 0.9,
    },
  },
});

const request = (
  traceId: string,
  options: {
    surface?: string;
    eligible?: boolean;
    pattern?: DecisionRequest["pattern"];
  } = {},
): DecisionRequest => ({
  traceId,
  pattern: options.pattern ?? "gate",
  state: "synthetic reversible request",
  questions: {
    verdict: {
      type: "choice",
      prompt: "Proceed?",
      options: [
        { id: "accept", label: "Accept" },
        { id: "reject", label: "Reject" },
      ],
    },
  },
  metadata: {
    decisionSurface: options.surface ?? "asset.qa",
    canaryEligible: options.eligible ?? true,
  },
});

const policy = (
  stage: "off" | "canary_1" | "canary_5" | "canary_25" | "limited_active" =
    "limited_active",
) =>
  buildCanaryActivationPolicy(promotedRegistry(), {
    policyId: `asset-qa-${stage}`,
    candidateProviderId: "candidate",
    incumbentProviderId: "incumbent",
    stage,
    allowedPatterns: ["gate"],
    circuitBreaker: {
      maxConsecutiveCandidateErrors: 1,
      minCandidateAttemptsForErrorRate: 3,
      maxCandidateErrorRate: 0.34,
    },
  });

test("limited-active canary gives authority only to explicitly eligible requests", async () => {
  let candidateCalls = 0;
  const sink = new MemoryCanaryEvidenceSink();
  const provider = new CanaryActivationProvider({
    incumbent: new MockSystemOneProvider({
      id: "incumbent",
      responder: (input) => response("incumbent", input),
    }),
    candidate: new MockSystemOneProvider({
      id: "candidate",
      responder: (input) => {
        candidateCalls += 1;
        return response("candidate", input);
      },
    }),
    policy: policy(),
    sink,
    sessionId: "scope-test",
  });

  const eligible = await provider.decide(request("eligible"));
  const missingFlag = await provider.decide(
    request("missing-flag", { eligible: false }),
  );
  const wrongSurface = await provider.decide(
    request("wrong-surface", { surface: "workflow.route" }),
  );
  const wrongPattern = await provider.decide(
    request("wrong-pattern", { pattern: "act" }),
  );
  await provider.flush();

  assert.equal(eligible.providerId, "candidate");
  assert.equal(missingFlag.providerId, "incumbent");
  assert.equal(wrongSurface.providerId, "incumbent");
  assert.equal(wrongPattern.providerId, "incumbent");
  assert.equal(candidateCalls, 1);
  assert.equal(sink.records.length, 4);
  assert.equal(sink.records[1]?.fallbackReason, "outside_scope");
  assert.equal(
    sink.records[2]?.eligibilityReasons.includes("decision_surface_mismatch"),
    true,
  );
  assert.equal(
    sink.records[3]?.eligibilityReasons.includes("pattern_not_allowed"),
    true,
  );
});

test("candidate failure falls back and trips kill switch before later requests", async () => {
  let candidateCalls = 0;
  const sink = new MemoryCanaryEvidenceSink();
  const provider = new CanaryActivationProvider({
    incumbent: new MockSystemOneProvider({
      id: "incumbent",
      responder: (input) => response("incumbent", input),
    }),
    candidate: new MockSystemOneProvider({
      id: "candidate",
      responder: async (input) => {
        candidateCalls += 1;
        if (candidateCalls === 2) throw new Error("candidate down");
        return response("candidate", input);
      },
    }),
    policy: policy(),
    sink,
    sessionId: "breaker-test",
  });

  assert.equal((await provider.decide(request("r1"))).providerId, "candidate");
  assert.equal((await provider.decide(request("r2"))).providerId, "incumbent");
  assert.equal((await provider.decide(request("r3"))).providerId, "incumbent");
  await provider.flush();

  assert.equal(candidateCalls, 2);
  assert.equal(provider.killSwitch().snapshot().killed, true);
  assert.equal(sink.records[1]?.fallbackReason, "candidate_error");
  assert.equal(sink.records[1]?.killSwitchAtReturn.killed, true);
  assert.equal(sink.records[2]?.fallbackReason, "kill_switch");
  assert.equal(sink.records[2]?.candidate.status, "not_run");
});

test("manual kill routes incumbent and does not invoke candidate", async () => {
  const killSwitch = new CanaryKillSwitch();
  killSwitch.kill("operator drill");
  let candidateCalls = 0;
  const sink = new MemoryCanaryEvidenceSink();
  const provider = new CanaryActivationProvider({
    incumbent: new MockSystemOneProvider({
      id: "incumbent",
      responder: (input) => response("incumbent", input),
    }),
    candidate: new MockSystemOneProvider({
      id: "candidate",
      responder: (input) => {
        candidateCalls += 1;
        return response("candidate", input);
      },
    }),
    policy: policy(),
    killSwitch,
    sink,
  });

  const result = await provider.decide(request("killed"));
  await provider.flush();

  assert.equal(result.providerId, "incumbent");
  assert.equal(candidateCalls, 0);
  assert.equal(sink.records[0]?.fallbackReason, "kill_switch");
});

test("off stage is deterministic incumbent-only routing", async () => {
  let candidateCalls = 0;
  const sink = new MemoryCanaryEvidenceSink();
  const provider = new CanaryActivationProvider({
    incumbent: new MockSystemOneProvider({
      id: "incumbent",
      responder: (input) => response("incumbent", input),
    }),
    candidate: new MockSystemOneProvider({
      id: "candidate",
      responder: (input) => {
        candidateCalls += 1;
        return response("candidate", input);
      },
    }),
    policy: policy("off"),
    sink,
  });

  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      (await provider.decide(request(`off-${index}`))).providerId,
      "incumbent",
    );
  }
  await provider.flush();
  assert.equal(candidateCalls, 0);
  assert.equal(
    sink.records.every((item) => item.fallbackReason === "not_selected"),
    true,
  );
});

test("session summary and stage gate hold on operational regression", async () => {
  let calls = 0;
  const sink = new MemoryCanaryEvidenceSink();
  const currentPolicy = policy();
  const provider = new CanaryActivationProvider({
    incumbent: new MockSystemOneProvider({
      id: "incumbent",
      responder: (input) => response("incumbent", input),
    }),
    candidate: new MockSystemOneProvider({
      id: "candidate",
      responder: async (input) => {
        calls += 1;
        if (calls === 3) throw new Error("fault");
        return response("candidate", input);
      },
    }),
    policy: currentPolicy,
    sink,
  });

  for (let index = 1; index <= 4; index += 1) {
    await provider.decide(request(`summary-${index}`));
  }
  await provider.flush();

  const summary = summarizeCanaryTraces(currentPolicy, sink.records);
  const advance = evaluateCanaryAdvance(summary, {
    minCandidateSelected: 3,
    maxCandidateErrorRate: 0,
    maxFallbackRate: 0,
    maxDisagreementRate: 0.25,
  });

  assert.equal(summary.candidateSelected, 3);
  assert.equal(summary.candidateErrors, 1);
  assert.equal(summary.fallbacks, 1);
  assert.equal(summary.killTrips, 1);
  assert.equal(advance.status, "fail");
  assert.equal(advance.action, "hold_current_stage");
  assert.equal(advance.automaticStageAdvance, false);
});

test("policy is invalidated by any lineage mutation after planning", () => {
  const registry = promotedRegistry();
  const activation = buildCanaryActivationPolicy(registry, {
    policyId: "stale-test",
    candidateProviderId: "candidate",
    incumbentProviderId: "incumbent",
    stage: "canary_1",
    allowedPatterns: ["gate"],
    circuitBreaker: {
      maxConsecutiveCandidateErrors: 2,
      minCandidateAttemptsForErrorRate: 10,
      maxCandidateErrorRate: 0.1,
    },
  });
  const changed = appendLineageEvent(registry, {
    type: "rollback_safety_set",
    data: {
      checkpointId: "candidate-v2",
      eligible: true,
      evidenceRef: "rollback-approval:v2",
      reason: "new evidence",
    },
  });

  assert.notEqual(
    deriveLineageState(registry).headEventHash,
    deriveLineageState(changed).headEventHash,
  );

  assert.throws(
    async () => {
      const module = await import("../src/activation/canary.js");
      module.assertCanaryPolicyAgainstRegistry(changed, activation);
    },
    /stale/,
  );
});

test("rollback drill injects a fault, kills candidate, and restores clone only", async () => {
  const registry = promotedRegistry();
  const before = deriveLineageState(registry);
  const result = await runCanaryRollbackDrill(registry, {
    drillId: "drill-test",
  });
  const originalAfter = deriveLineageState(registry);
  const simulatedAfter = deriveLineageState(result.simulatedRegistry);

  assert.equal(result.report.passed, true);
  assert.equal(result.report.productionRegistryMutated, false);
  assert.equal(result.report.externalRuntimeAuthorityChanged, false);
  assert.equal(result.report.checks.faultTriggeredKill, true);
  assert.equal(result.report.checks.faultFellBackToIncumbent, true);
  assert.equal(result.report.checks.postKillStayedOnIncumbent, true);
  assert.equal(result.report.checks.stageAdvanceHeld, true);
  assert.equal(originalAfter.headEventHash, before.headEventHash);
  assert.equal(originalAfter.recordedHeadCheckpointId, "candidate-v2");
  assert.equal(simulatedAfter.recordedHeadCheckpointId, "base-v1");
  assert.equal(simulatedAfter.checkpoints["base-v1"]?.lifecycle, "restored");
});
