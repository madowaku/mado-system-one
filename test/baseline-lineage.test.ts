import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanaryActivationPolicy,
  type CanaryActivationPolicy,
  type CanarySessionSummary,
} from "../src/activation/canary.js";
import { buildActiveLimitedDriftPolicy } from "../src/activation/drift.js";
import type {
  WorkloadBaselineMetrics,
  WorkloadRebaselineAcceptanceEvidence,
} from "../src/activation/rebaseline.js";
import {
  appendBaselineLineageEvent,
  bindCheckpointToDistributionEpoch,
  createBaselineLineageRegistry,
  deriveBaselineLineageState,
  registerInitialDistributionEpoch,
  registerRebaselineDistributionEpoch,
  verifyBaselineLineageRegistry,
} from "../src/baseline/registry.js";
import {
  appendLineageEvent,
  createCheckpointLineageRegistry,
  type CheckpointLineageRegistry,
} from "../src/lineage/registry.js";
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

const checkpointRegistryV2 = (): CheckpointLineageRegistry => {
  let registry = createCheckpointLineageRegistry(
    "checkpoint-asset-qa",
    "asset.qa",
    new Date("2026-10-03T00:00:00.000Z"),
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
        knownGoodEvidenceRef: "baseline:base-v1",
      },
    },
    {
      eventId: "register-base",
      now: new Date("2026-10-03T00:01:00.000Z"),
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
        reevalEvidenceRef: "reeval:v2",
        reevalId: "reeval-v2",
      },
    },
    {
      eventId: "register-v2",
      now: new Date("2026-10-03T00:02:00.000Z"),
    },
  );
  registry = appendLineageEvent(
    registry,
    {
      type: "promotion_recorded",
      data: {
        checkpointId: "candidate-v2",
        gateId: "gate-v2",
        gateEvidenceRef: "promotion:gate-v2",
        reevalId: "reeval-v2",
        reevalEvidenceRef: "reeval:v2",
        rollbackTargetId: "base-v1",
      },
    },
    {
      eventId: "promote-v2",
      now: new Date("2026-10-03T00:03:00.000Z"),
    },
  );
  return registry;
};

const checkpointRegistryV3 = (): CheckpointLineageRegistry => {
  let registry = checkpointRegistryV2();
  registry = appendLineageEvent(
    registry,
    {
      type: "rollback_safety_set",
      data: {
        checkpointId: "candidate-v2",
        eligible: true,
        evidenceRef: "rollback-safe:v2",
        reason: "v2 is accepted as rollback target for v3",
      },
    },
    {
      eventId: "mark-v2-known-good",
      now: new Date("2026-10-03T01:00:00.000Z"),
    },
  );
  registry = appendLineageEvent(
    registry,
    {
      type: "checkpoint_registered",
      data: {
        checkpointId: "candidate-v3",
        checkpoint: checkpoint("candidate-v3", "c".repeat(64)),
        origin: "fine_tune",
        knownGood: false,
        parentCheckpointId: "candidate-v2",
        reevalEvidenceRef: "reeval:v3",
        reevalId: "reeval-v3",
      },
    },
    {
      eventId: "register-v3",
      now: new Date("2026-10-03T01:01:00.000Z"),
    },
  );
  registry = appendLineageEvent(
    registry,
    {
      type: "promotion_recorded",
      data: {
        checkpointId: "candidate-v3",
        gateId: "gate-v3",
        gateEvidenceRef: "promotion:gate-v3",
        reevalId: "reeval-v3",
        reevalEvidenceRef: "reeval:v3",
        rollbackTargetId: "candidate-v2",
      },
    },
    {
      eventId: "promote-v3",
      now: new Date("2026-10-03T01:02:00.000Z"),
    },
  );
  return registry;
};

const summary = (
  policy: CanaryActivationPolicy,
  meanConfidence: number,
  disagreementRate = 0.05,
): CanarySessionSummary => ({
  schemaVersion: "mso.canary-summary.v0",
  policyId: policy.policyId,
  stage: policy.stage,
  trafficFraction: policy.trafficFraction,
  traces: 100,
  eligibleRequests: 100,
  candidateSelected: 100,
  candidateReturned: 100,
  candidateErrors: 0,
  incumbentErrors: 0,
  fallbacks: 0,
  killedAtStart: 0,
  comparableQuestions: 100,
  disagreements: Math.round(disagreementRate * 100),
  agreementRate: 1 - disagreementRate,
  candidateErrorRate: 0,
  fallbackRate: 0,
  candidateReturnRate: 1,
  p95CandidateWallLatencyMs: 12,
  p95IncumbentWallLatencyMs: 10,
  p95LatencyRatio: 1.2,
  candidateConfidenceSamples: 100,
  meanCandidateConfidence: meanConfidence,
  incumbentConfidenceSamples: 100,
  meanIncumbentConfidence: 0.88,
  killTrips: 0,
});

const activation = (
  registry: CheckpointLineageRegistry,
  id: string,
) =>
  buildCanaryActivationPolicy(registry, {
    policyId: id,
    candidateProviderId: "candidate",
    incumbentProviderId: "incumbent",
    stage: "limited_active",
    allowedPatterns: ["gate"],
    circuitBreaker: {
      maxConsecutiveCandidateErrors: 3,
      minCandidateAttemptsForErrorRate: 20,
      maxCandidateErrorRate: 0.05,
    },
  });

const drift = (
  active: CanaryActivationPolicy,
  policyId: string,
  meanConfidence: number,
) =>
  buildActiveLimitedDriftPolicy(
    active,
    active,
    summary(active, meanConfidence),
    {
      policyId,
      window: {
        size: 100,
        minCandidateSelected: 50,
        minComparableQuestions: 50,
        minCandidateConfidenceSamples: 50,
      },
      thresholds: {
        maxCandidateErrorRate: 0.05,
        maxIncumbentErrorRate: 0.05,
        maxFallbackRate: 0.05,
        maxDisagreementRate: 0.15,
        maxP95LatencyRatio: 2,
        maxMeanCandidateConfidenceDelta: 0.15,
      },
    },
  );

const acceptance = (
  active: CanaryActivationPolicy,
  driftPolicyId: string,
  metrics: WorkloadBaselineMetrics,
): WorkloadRebaselineAcceptanceEvidence => ({
  schemaVersion: "mso.rebaseline-acceptance.v0",
  rebaselineId: "rebaseline-002",
  createdAt: "2026-10-03T02:00:00.000Z",
  decisionSurface: active.decisionSurface,
  candidateCheckpointId: active.candidateCheckpointId,
  candidateFingerprint: active.candidateFingerprint,
  recoveryCanaryPolicyIds: [
    "recovery-canary-1",
    "recovery-canary-5",
    "recovery-canary-25",
  ],
  recoveryCanaryStages: ["canary_1", "canary_5", "canary_25"],
  recoveryCanaryAdvanceActions: [
    "eligible_for_next_stage",
    "eligible_for_next_stage",
    "eligible_for_next_stage",
  ],
  status: "pass",
  action: "eligible_for_limited_active",
  automaticActivation: false,
  oldBaselineReplaced: false,
  acceptedBaseline: metrics,
  limitedActivePolicyId: active.policyId,
  driftPolicyId,
  review: {
    schemaVersion: "mso.rebaseline-acceptance-review.v0",
    rebaselineId: "rebaseline-002",
    operatorReviewed: true,
    operatorApprovalRef: "ops:accept-002",
    evidenceRefs: ["canary-chain:002"],
    acceptanceSummary:
      "UI-heavy assets are now the accepted workload distribution.",
  },
});

const metricsFromDrift = (
  policy: ReturnType<typeof drift>,
): WorkloadBaselineMetrics => ({
  traces: policy.baseline.traces,
  candidateSelected: policy.baseline.candidateSelected,
  comparableQuestions: policy.baseline.comparableQuestions,
  candidateConfidenceSamples: policy.baseline.candidateConfidenceSamples,
  meanCandidateConfidence: policy.baseline.meanCandidateConfidence,
  candidateErrorRate: policy.baseline.candidateErrorRate,
  incumbentErrorRate: policy.baseline.incumbentErrorRate,
  fallbackRate: policy.baseline.fallbackRate,
  disagreementRate: policy.baseline.disagreementRate,
  p95LatencyRatio: policy.baseline.p95LatencyRatio,
});

test("initial baseline epoch creates epoch 001 and checkpoint binding", () => {
  const checkpoints = checkpointRegistryV2();
  const active = activation(checkpoints, "active-v2-e1");
  const driftPolicy = drift(active, "drift-v2-e1", 0.9);
  const empty = createBaselineLineageRegistry(
    "baseline-asset-qa",
    "asset.qa",
    new Date("2026-10-03T03:00:00.000Z"),
  );

  const registry = registerInitialDistributionEpoch(
    empty,
    checkpoints,
    active,
    driftPolicy,
    {
      epochId: "epoch-001",
      distributionSummary: "Initial accepted asset QA workload.",
      sourceEvidenceRefs: ["baseline-seed:asset-qa"],
      bindingEvidenceRef: "activation:active-v2-e1",
      now: new Date("2026-10-03T03:01:00.000Z"),
    },
  );

  const state = deriveBaselineLineageState(registry);
  assert.equal(state.currentEpochId, "epoch-001");
  assert.equal(state.epochs["epoch-001"]?.ordinal, 1);
  assert.equal(state.epochs["epoch-001"]?.lifecycle, "current");
  assert.equal(state.epochs["epoch-001"]?.origin, "initial");
  assert.equal(state.epochs["epoch-001"]?.bindingIds.length, 1);
  assert.deepEqual(state.checkpointEpochMatrix["candidate-v2"], ["epoch-001"]);
  assert.equal(state.eventCount, 2);
});

test("accepted M1.2 rebaseline creates epoch 002 and supersedes epoch 001", () => {
  const checkpoints = checkpointRegistryV2();
  const active1 = activation(checkpoints, "active-v2-e1");
  const drift1 = drift(active1, "drift-v2-e1", 0.9);
  let registry = registerInitialDistributionEpoch(
    createBaselineLineageRegistry("baseline-asset-qa", "asset.qa"),
    checkpoints,
    active1,
    drift1,
    {
      epochId: "epoch-001",
      distributionSummary: "Initial accepted workload.",
      sourceEvidenceRefs: ["baseline-seed:e1"],
      bindingEvidenceRef: "activation:e1",
    },
  );

  const active2 = activation(checkpoints, "active-v2-e2");
  const drift2 = drift(active2, "drift-v2-e2", 0.7);
  registry = registerRebaselineDistributionEpoch(
    registry,
    checkpoints,
    acceptance(active2, drift2.policyId, metricsFromDrift(drift2)),
    active2,
    drift2,
    {
      epochId: "epoch-002",
      acceptanceEvidenceRef: "evidence/rebaseline-002.json",
      bindingEvidenceRef: "activation:e2",
    },
  );

  const state = deriveBaselineLineageState(registry);
  assert.equal(state.currentEpochId, "epoch-002");
  assert.equal(state.epochs["epoch-001"]?.lifecycle, "superseded");
  assert.equal(state.epochs["epoch-002"]?.lifecycle, "current");
  assert.equal(state.epochs["epoch-002"]?.parentEpochId, "epoch-001");
  assert.deepEqual(state.epochs["epoch-001"]?.childEpochIds, ["epoch-002"]);
  assert.equal(state.epochs["epoch-002"]?.rebaselineId, "rebaseline-002");
  assert.equal(
    state.epochs["epoch-002"]?.baseline.meanCandidateConfidence,
    0.7,
  );
  assert.deepEqual(state.checkpointEpochMatrix["candidate-v2"], [
    "epoch-001",
    "epoch-002",
  ]);
});

test("checkpoint generation can change without creating a new distribution epoch", () => {
  const checkpointsV2 = checkpointRegistryV2();
  const activeV2 = activation(checkpointsV2, "active-v2-e1");
  const driftV2 = drift(activeV2, "drift-v2-e1", 0.9);
  let registry = registerInitialDistributionEpoch(
    createBaselineLineageRegistry("baseline-asset-qa", "asset.qa"),
    checkpointsV2,
    activeV2,
    driftV2,
    {
      epochId: "epoch-001",
      distributionSummary: "Stable workload epoch.",
      sourceEvidenceRefs: ["baseline-seed:e1"],
      bindingEvidenceRef: "activation:v2-e1",
    },
  );

  const checkpointsV3 = checkpointRegistryV3();
  const activeV3 = activation(checkpointsV3, "active-v3-e1");
  const driftV3 = drift(activeV3, "drift-v3-e1", 0.9);
  registry = bindCheckpointToDistributionEpoch(
    registry,
    checkpointsV3,
    activeV3,
    driftV3,
    {
      evidenceRef: "activation:v3-e1",
    },
  );

  const state = deriveBaselineLineageState(registry);
  assert.equal(state.currentEpochId, "epoch-001");
  assert.equal(Object.keys(state.epochs).length, 1);
  assert.deepEqual(state.checkpointEpochMatrix["candidate-v2"], ["epoch-001"]);
  assert.deepEqual(state.checkpointEpochMatrix["candidate-v3"], ["epoch-001"]);
  assert.equal(state.epochs["epoch-001"]?.bindingIds.length, 2);
});

test("new checkpoint binding is rejected when its drift baseline describes another epoch", () => {
  const checkpointsV2 = checkpointRegistryV2();
  const activeV2 = activation(checkpointsV2, "active-v2-e1");
  const driftV2 = drift(activeV2, "drift-v2-e1", 0.9);
  const registry = registerInitialDistributionEpoch(
    createBaselineLineageRegistry("baseline-asset-qa", "asset.qa"),
    checkpointsV2,
    activeV2,
    driftV2,
    {
      epochId: "epoch-001",
      distributionSummary: "Stable workload epoch.",
      sourceEvidenceRefs: ["baseline-seed:e1"],
      bindingEvidenceRef: "activation:v2-e1",
    },
  );

  const checkpointsV3 = checkpointRegistryV3();
  const activeV3 = activation(checkpointsV3, "active-v3-other");
  const mismatchedDrift = drift(activeV3, "drift-v3-other", 0.65);

  assert.throws(
    () =>
      bindCheckpointToDistributionEpoch(
        registry,
        checkpointsV3,
        activeV3,
        mismatchedDrift,
        { evidenceRef: "activation:v3-other" },
      ),
    /does not match current distribution epoch/,
  );
});

test("blocked or mismatched rebaseline acceptance cannot create a new epoch", () => {
  const checkpoints = checkpointRegistryV2();
  const active1 = activation(checkpoints, "active-v2-e1");
  const drift1 = drift(active1, "drift-v2-e1", 0.9);
  const registry = registerInitialDistributionEpoch(
    createBaselineLineageRegistry("baseline-asset-qa", "asset.qa"),
    checkpoints,
    active1,
    drift1,
    {
      epochId: "epoch-001",
      distributionSummary: "Initial workload.",
      sourceEvidenceRefs: ["baseline-seed:e1"],
      bindingEvidenceRef: "activation:e1",
    },
  );
  const active2 = activation(checkpoints, "active-v2-e2");
  const drift2 = drift(active2, "drift-v2-e2", 0.7);
  const blocked = {
    ...acceptance(active2, drift2.policyId, metricsFromDrift(drift2)),
    status: "blocked" as const,
    action: "hold_remains" as const,
  };

  assert.throws(
    () =>
      registerRebaselineDistributionEpoch(
        registry,
        checkpoints,
        blocked,
        active2,
        drift2,
        {
          epochId: "epoch-002",
          acceptanceEvidenceRef: "blocked.json",
          bindingEvidenceRef: "activation:e2",
        },
      ),
    /not eligible/,
  );

  const wrongMetrics = acceptance(
    active2,
    drift2.policyId,
    {
      ...metricsFromDrift(drift2),
      meanCandidateConfidence: 0.8,
    },
  );
  assert.throws(
    () =>
      registerRebaselineDistributionEpoch(
        registry,
        checkpoints,
        wrongMetrics,
        active2,
        drift2,
        {
          epochId: "epoch-002",
          acceptanceEvidenceRef: "wrong-metrics.json",
          bindingEvidenceRef: "activation:e2",
        },
      ),
    /metrics do not match/,
  );
});

test("baseline lineage hash chain detects tampering", () => {
  const checkpoints = checkpointRegistryV2();
  const active = activation(checkpoints, "active-v2-e1");
  const driftPolicy = drift(active, "drift-v2-e1", 0.9);
  const registry = registerInitialDistributionEpoch(
    createBaselineLineageRegistry("baseline-asset-qa", "asset.qa"),
    checkpoints,
    active,
    driftPolicy,
    {
      epochId: "epoch-001",
      distributionSummary: "Initial workload.",
      sourceEvidenceRefs: ["baseline-seed:e1"],
      bindingEvidenceRef: "activation:e1",
    },
  );

  const tampered = structuredClone(registry);
  const first = tampered.events[0];
  assert.ok(first);
  if (first.payload.type !== "epoch_registered") {
    throw new Error("unexpected first event");
  }
  first.payload.data.distributionSummary = "silently rewritten world";

  assert.throws(
    () => verifyBaselineLineageRegistry(tampered),
    /hash mismatch/,
  );
});

test("event append rejects duplicate epoch registration", () => {
  const registry = createBaselineLineageRegistry(
    "baseline-asset-qa",
    "asset.qa",
  );
  const metrics: WorkloadBaselineMetrics = {
    traces: 1,
    candidateSelected: 1,
    comparableQuestions: 1,
    candidateConfidenceSamples: 1,
    meanCandidateConfidence: 0.9,
    candidateErrorRate: 0,
    incumbentErrorRate: 0,
    fallbackRate: 0,
    disagreementRate: 0,
    p95LatencyRatio: 1,
  };
  const once = appendBaselineLineageEvent(registry, {
    type: "epoch_registered",
    data: {
      epochId: "epoch-001",
      origin: "initial",
      distributionSummary: "Initial.",
      baseline: metrics,
      sourceBaselinePolicyId: "canary-25",
      driftPolicyId: "drift-1",
      sourceEvidenceRefs: ["seed:1"],
    },
  });

  assert.throws(
    () =>
      appendBaselineLineageEvent(once, {
        type: "epoch_registered",
        data: {
          epochId: "epoch-001",
          origin: "rebaseline",
          parentEpochId: "epoch-001",
          distributionSummary: "Duplicate.",
          baseline: metrics,
          sourceBaselinePolicyId: "canary-25-b",
          driftPolicyId: "drift-2",
          sourceEvidenceRefs: ["seed:2"],
          rebaselineId: "rebaseline-2",
        },
      }),
    /already registered/,
  );
});
