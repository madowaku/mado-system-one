import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanaryActivationPolicy,
  type CanarySessionSummary,
} from "../src/activation/canary.js";
import {
  buildActiveLimitedDriftPolicy,
  type DriftHoldEvent,
  type DriftWindowEvidence,
} from "../src/activation/drift.js";
import {
  evaluateHoldRequalification,
  type HoldRecoveryCase,
} from "../src/activation/recovery.js";
import {
  appendLineageEvent,
  createCheckpointLineageRegistry,
  deriveLineageState,
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

const registryFixture = (): CheckpointLineageRegistry => {
  let registry = createCheckpointLineageRegistry(
    "asset-qa-recovery",
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
        knownGoodEvidenceRef: "baseline:asset.qa:v1",
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

const activation = (registry: CheckpointLineageRegistry) =>
  buildCanaryActivationPolicy(registry, {
    policyId: "asset-qa-v2-active",
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

const summary = (policyId: string): CanarySessionSummary => ({
  schemaVersion: "mso.canary-summary.v0",
  policyId,
  stage: "limited_active",
  trafficFraction: 1,
  traces: 100,
  eligibleRequests: 100,
  candidateSelected: 100,
  candidateReturned: 100,
  candidateErrors: 0,
  incumbentErrors: 0,
  fallbacks: 0,
  killedAtStart: 0,
  comparableQuestions: 100,
  disagreements: 2,
  agreementRate: 0.98,
  candidateErrorRate: 0,
  fallbackRate: 0,
  candidateReturnRate: 1,
  p95CandidateWallLatencyMs: 12,
  p95IncumbentWallLatencyMs: 10,
  p95LatencyRatio: 1.2,
  candidateConfidenceSamples: 100,
  meanCandidateConfidence: 0.9,
  incumbentConfidenceSamples: 100,
  meanIncumbentConfidence: 0.88,
  killTrips: 0,
});

const driftPolicy = (
  active: ReturnType<typeof activation>,
) =>
  buildActiveLimitedDriftPolicy(
    active,
    active,
    summary(active.policyId),
    {
      policyId: "asset-qa-v2-drift",
      window: {
        size: 20,
        minCandidateSelected: 10,
        minComparableQuestions: 10,
        minCandidateConfidenceSamples: 10,
      },
      thresholds: {
        maxCandidateErrorRate: 0.05,
        maxIncumbentErrorRate: 0.05,
        maxFallbackRate: 0.05,
        maxDisagreementRate: 0.1,
        maxP95LatencyRatio: 2,
        maxMeanCandidateConfidenceDelta: 0.15,
      },
    },
  );

const recoveryWindow = (
  active: ReturnType<typeof activation>,
  driftId: string,
  status: "pass" | "fail" = "pass",
): DriftWindowEvidence => ({
  schemaVersion: "mso.drift-window.v0",
  policyId: driftId,
  activationPolicyId: active.policyId,
  evaluatedAt: "2026-10-02T12:00:00.000Z",
  traceCount: 20,
  firstTraceId: "recovery-1",
  lastTraceId: "recovery-20",
  status,
  action: status === "pass" ? "continue" : "auto_hold",
  automaticHold: true,
  automaticRollback: false,
  summary: {
    ...summary(active.policyId),
    traces: 20,
    eligibleRequests: 20,
    candidateSelected: 20,
    candidateReturned: status === "pass" ? 20 : 15,
    candidateErrors: status === "pass" ? 0 : 5,
    fallbacks: status === "pass" ? 0 : 5,
    comparableQuestions: 20,
    disagreements: status === "pass" ? 1 : 8,
    agreementRate: status === "pass" ? 0.95 : 0.6,
    candidateErrorRate: status === "pass" ? 0 : 0.25,
    fallbackRate: status === "pass" ? 0 : 0.25,
    candidateReturnRate: status === "pass" ? 1 : 0.75,
    candidateConfidenceSamples: 20,
    incumbentConfidenceSamples: 20,
    killTrips: status === "pass" ? 0 : 1,
  },
  confidenceDelta: status === "pass" ? 0.02 : 0.3,
  disagreementRate: status === "pass" ? 0.05 : 0.4,
  incumbentErrorRate: 0,
  checks: [],
});

const holdEvent = (
  active: ReturnType<typeof activation>,
  driftId: string,
): DriftHoldEvent => ({
  schemaVersion: "mso.drift-hold.v0",
  holdId: "hold-v2",
  policyId: driftId,
  activationPolicyId: active.policyId,
  decisionSurface: active.decisionSurface,
  candidateCheckpointId: active.candidateCheckpointId,
  candidateFingerprint: active.candidateFingerprint,
  triggeredAt: "2026-10-02T11:00:00.000Z",
  triggerTraceId: "trace-drift-20",
  action: "auto_hold",
  automaticHold: true,
  automaticRollback: false,
  candidateAuthorityAfterHold: false,
  fallbackAuthority: "incumbent",
  reasons: ["mean_candidate_confidence_delta"],
  window: recoveryWindow(active, driftId, "fail"),
});

const recoveryCase = (
  classification: HoldRecoveryCase["classification"],
  overrides: Partial<HoldRecoveryCase> = {},
): HoldRecoveryCase => ({
  schemaVersion: "mso.hold-recovery-case.v0",
  recoveryId: `recovery-${classification}`,
  holdId: "hold-v2",
  classification,
  diagnosisSummary: "reviewed recovery fixture",
  operatorReviewed: true,
  operatorApprovalRef: "ops-approval:recovery-v2",
  diagnosisEvidenceRefs: ["diagnosis:incident-42"],
  repairSummary: "repair applied and verified",
  repairEvidenceRefs: ["repair:change-42"],
  verificationEvidenceRefs: ["verification:replay-42"],
  ...overrides,
});

test("provider regression can requalify only into a new canary_1 session", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);
  const hold = holdEvent(active, drift.policyId);

  const result = evaluateHoldRequalification(
    registry,
    active,
    drift,
    hold,
    recoveryCase("provider_regression"),
    recoveryWindow(active, drift.policyId),
    {
      newActivationPolicyId: "asset-qa-v2-restart-1",
      now: new Date("2026-10-02T13:00:00.000Z"),
    },
  );

  assert.equal(result.evidence.status, "pass");
  assert.equal(result.evidence.action, "eligible_for_new_canary");
  assert.equal(result.evidence.automaticReactivation, false);
  assert.equal(result.evidence.automaticRollback, false);
  assert.equal(result.evidence.oldSessionReusable, false);
  assert.equal(result.evidence.restartStage, "canary_1");
  assert.equal(result.restartPolicy?.stage, "canary_1");
  assert.equal(result.restartPolicy?.trafficFraction, 0.01);
  assert.equal(result.restartPolicy?.policyId, "asset-qa-v2-restart-1");
  assert.equal(
    result.restartPolicy?.candidateFingerprint,
    active.candidateFingerprint,
  );
  assert.notEqual(result.restartPolicy?.policyId, active.policyId);
});

test("calibration drift can requalify after reviewed repair and passing replay", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);

  const result = evaluateHoldRequalification(
    registry,
    active,
    drift,
    holdEvent(active, drift.policyId),
    recoveryCase("calibration_drift"),
    recoveryWindow(active, drift.policyId),
    { newActivationPolicyId: "asset-qa-v2-calibration-restart" },
  );

  assert.equal(result.evidence.status, "pass");
  assert.equal(result.evidence.action, "eligible_for_new_canary");
  assert.equal(result.restartPolicy?.stage, "canary_1");
});

test("requalification re-pins to current valid lineage hash after audit event", () => {
  let registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);
  const oldHeadHash = active.lineageHeadEventHash;

  registry = appendLineageEvent(
    registry,
    {
      type: "rollback_safety_set",
      data: {
        checkpointId: "base-v1",
        eligible: true,
        evidenceRef: "baseline:asset.qa:v1-reaffirmed",
        reason: "rollback baseline reaffirmed during hold review",
      },
    },
    {
      eventId: "reaffirm-base",
      now: new Date("2026-10-02T12:30:00.000Z"),
    },
  );

  const result = evaluateHoldRequalification(
    registry,
    active,
    drift,
    holdEvent(active, drift.policyId),
    recoveryCase("provider_regression"),
    recoveryWindow(active, drift.policyId),
    { newActivationPolicyId: "asset-qa-v2-repinned" },
  );

  assert.equal(result.evidence.status, "pass");
  assert.notEqual(result.restartPolicy?.lineageHeadEventHash, oldHeadHash);
  assert.equal(
    result.restartPolicy?.lineageHeadEventHash,
    deriveLineageState(registry).headEventHash,
  );
});

test("missing operator approval keeps the hold in place", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);

  const result = evaluateHoldRequalification(
    registry,
    active,
    drift,
    holdEvent(active, drift.policyId),
    recoveryCase("provider_regression", {
      operatorReviewed: false,
    }),
    recoveryWindow(active, drift.policyId),
    { newActivationPolicyId: "blocked-restart" },
  );

  assert.equal(result.evidence.status, "blocked");
  assert.equal(result.evidence.action, "hold_remains");
  assert.equal(result.restartPolicy, undefined);
  assert.equal(
    result.evidence.checks.find((item) => item.id === "operator_review")
      ?.status,
    "blocked",
  );
});

test("failed post-repair replay keeps same checkpoint held", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);

  const result = evaluateHoldRequalification(
    registry,
    active,
    drift,
    holdEvent(active, drift.policyId),
    recoveryCase("calibration_drift"),
    recoveryWindow(active, drift.policyId, "fail"),
    { newActivationPolicyId: "blocked-window" },
  );

  assert.equal(result.evidence.status, "blocked");
  assert.equal(result.evidence.action, "hold_remains");
  assert.equal(result.restartPolicy, undefined);
});

test("workload drift routes to rebaseline instead of direct requalification", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);

  const result = evaluateHoldRequalification(
    registry,
    active,
    drift,
    holdEvent(active, drift.policyId),
    recoveryCase("workload_drift", {
      repairEvidenceRefs: [],
      verificationEvidenceRefs: [],
    }),
    recoveryWindow(active, drift.policyId, "fail"),
    { newActivationPolicyId: "unused" },
  );

  assert.equal(result.evidence.action, "requires_rebaseline");
  assert.equal(result.evidence.status, "blocked");
  assert.equal(result.restartPolicy, undefined);
});

test("checkpoint regression routes to a new checkpoint lineage", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);

  const result = evaluateHoldRequalification(
    registry,
    active,
    drift,
    holdEvent(active, drift.policyId),
    recoveryCase("checkpoint_regression", {
      repairEvidenceRefs: [],
      verificationEvidenceRefs: [],
    }),
    recoveryWindow(active, drift.policyId, "fail"),
    { newActivationPolicyId: "unused" },
  );

  assert.equal(result.evidence.action, "requires_new_checkpoint");
  assert.equal(result.restartPolicy, undefined);
});

test("unknown diagnosis cannot reopen candidate authority", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);

  const result = evaluateHoldRequalification(
    registry,
    active,
    drift,
    holdEvent(active, drift.policyId),
    recoveryCase("unknown", {
      repairEvidenceRefs: [],
      verificationEvidenceRefs: [],
    }),
    recoveryWindow(active, drift.policyId, "fail"),
    { newActivationPolicyId: "unused" },
  );

  assert.equal(result.evidence.action, "diagnosis_required");
  assert.equal(result.evidence.oldSessionReusable, false);
  assert.equal(result.restartPolicy, undefined);
});

test("hold identity mismatch is rejected instead of cross-wiring recovery", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);
  const hold = {
    ...holdEvent(active, drift.policyId),
    candidateFingerprint: "c".repeat(64),
  };

  assert.throws(
    () =>
      evaluateHoldRequalification(
        registry,
        active,
        drift,
        hold,
        recoveryCase("provider_regression"),
        recoveryWindow(active, drift.policyId),
        { newActivationPolicyId: "never-created" },
      ),
    /hold identity does not match/,
  );
});
