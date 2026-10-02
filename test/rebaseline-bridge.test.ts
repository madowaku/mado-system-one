import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanaryActivationPolicy,
  evaluateCanaryAdvance,
  type CanaryActivationPolicy,
  type CanarySessionSummary,
  type CanaryTrace,
} from "../src/activation/canary.js";
import {
  buildActiveLimitedDriftPolicy,
  type DriftHoldEvent,
} from "../src/activation/drift.js";
import type { HoldRecoveryCase } from "../src/activation/recovery.js";
import {
  acceptWorkloadRebaseline,
  buildWorkloadRebaselineCandidate,
  type WorkloadRebaselineAcceptanceReview,
  type WorkloadRebaselineReview,
} from "../src/activation/rebaseline.js";
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

const registryFixture = (): CheckpointLineageRegistry => {
  let registry = createCheckpointLineageRegistry(
    "asset-qa-rebaseline",
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
        knownGoodEvidenceRef: "baseline:asset.qa:v1",
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
        reevalEvidenceRef: "reeval/v2/summary.json",
        reevalId: "reeval-v2",
      },
    },
    {
      eventId: "register-candidate",
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
        gateEvidenceRef: "promotion/gate-v2.json",
        reevalId: "reeval-v2",
        reevalEvidenceRef: "reeval/v2/summary.json",
        rollbackTargetId: "base-v1",
      },
    },
    {
      eventId: "promote-candidate",
      now: new Date("2026-10-03T00:03:00.000Z"),
    },
  );
  return registry;
};

const activation = (
  registry: CheckpointLineageRegistry,
  policyId = "asset-qa-v2-active",
  stage: CanaryActivationPolicy["stage"] = "limited_active",
) =>
  buildCanaryActivationPolicy(registry, {
    policyId,
    candidateProviderId: "candidate",
    incumbentProviderId: "incumbent",
    stage,
    allowedPatterns: ["gate"],
    circuitBreaker: {
      maxConsecutiveCandidateErrors: 3,
      minCandidateAttemptsForErrorRate: 20,
      maxCandidateErrorRate: 0.1,
    },
  });

const baselineSummary = (policyId: string): CanarySessionSummary => ({
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

const driftPolicy = (active: CanaryActivationPolicy) =>
  buildActiveLimitedDriftPolicy(
    active,
    active,
    baselineSummary(active.policyId),
    {
      policyId: "asset-qa-v2-drift",
      window: {
        size: 50,
        minCandidateSelected: 20,
        minComparableQuestions: 20,
        minCandidateConfidenceSamples: 20,
      },
      thresholds: {
        maxCandidateErrorRate: 0.1,
        maxIncumbentErrorRate: 0.1,
        maxFallbackRate: 0.1,
        maxDisagreementRate: 0.2,
        maxP95LatencyRatio: 2,
        maxMeanCandidateConfidenceDelta: 0.15,
      },
    },
  );

const hold = (
  active: CanaryActivationPolicy,
  driftId: string,
): DriftHoldEvent => ({
  schemaVersion: "mso.drift-hold.v0",
  holdId: "hold-workload-v2",
  policyId: driftId,
  activationPolicyId: active.policyId,
  decisionSurface: active.decisionSurface,
  candidateCheckpointId: active.candidateCheckpointId,
  candidateFingerprint: active.candidateFingerprint,
  triggeredAt: "2026-10-03T01:00:00.000Z",
  triggerTraceId: "shift-20",
  action: "auto_hold",
  automaticHold: true,
  automaticRollback: false,
  candidateAuthorityAfterHold: false,
  fallbackAuthority: "incumbent",
  reasons: ["mean_candidate_confidence_delta", "disagreement_rate"],
  window: {
    schemaVersion: "mso.drift-window.v0",
    policyId: driftId,
    activationPolicyId: active.policyId,
    evaluatedAt: "2026-10-03T01:00:00.000Z",
    traceCount: 20,
    status: "fail",
    action: "auto_hold",
    automaticHold: true,
    automaticRollback: false,
    summary: {
      ...baselineSummary(active.policyId),
      traces: 20,
      eligibleRequests: 20,
      candidateSelected: 20,
      candidateReturned: 20,
      comparableQuestions: 20,
      disagreements: 8,
      agreementRate: 0.6,
      candidateConfidenceSamples: 20,
      meanCandidateConfidence: 0.68,
      incumbentConfidenceSamples: 20,
      meanIncumbentConfidence: 0.88,
    },
    confidenceDelta: 0.22,
    disagreementRate: 0.4,
    incumbentErrorRate: 0,
    checks: [],
  },
});

const recovery: HoldRecoveryCase = {
  schemaVersion: "mso.hold-recovery-case.v0",
  recoveryId: "workload-recovery-v2",
  holdId: "hold-workload-v2",
  classification: "workload_drift",
  diagnosisSummary: "Input mix changed after a new asset pipeline rollout.",
  operatorReviewed: true,
  operatorApprovalRef: "ops:workload-drift-v2",
  diagnosisEvidenceRefs: ["distribution-report:new-asset-mix"],
  repairEvidenceRefs: [],
  verificationEvidenceRefs: [],
};

const review = (
  overrides: Partial<WorkloadRebaselineReview> = {},
): WorkloadRebaselineReview => ({
  schemaVersion: "mso.rebaseline-review.v0",
  rebaselineId: "rebaseline-v2",
  holdId: "hold-workload-v2",
  recoveryId: "workload-recovery-v2",
  operatorReviewed: true,
  operatorApprovalRef: "ops:rebaseline-v2",
  distributionSummary:
    "New workload has more UI-heavy assets; confidence moved but runtime health stayed bounded.",
  evidenceRefs: ["distribution-delta:asset-qa-v2"],
  ...overrides,
});

const trace = (
  policyId: string,
  index: number,
  options: {
    confidence?: number;
    incumbentConfidence?: number;
    agreement?: boolean;
    candidateError?: boolean;
  } = {},
): CanaryTrace => {
  const confidence = options.confidence ?? 0.7;
  const incumbentConfidence = options.incumbentConfidence ?? 0.88;
  const candidateError = options.candidateError ?? false;
  const agreement = options.agreement ?? true;
  return {
    schemaVersion: "mso.canary.v0",
    sessionId: "rebaseline-probe",
    traceId: `probe-${index}`,
    capturedAt: "2026-10-03T02:00:00.000Z",
    policyId,
    decisionSurface: "asset.qa",
    stage: "limited_active",
    trafficFraction: 1,
    bucket: 0,
    eligible: true,
    eligibilityReasons: [],
    killSwitchAtStart: { killed: false },
    killSwitchAtReturn: { killed: false },
    circuit: {
      attempts: index,
      errors: candidateError ? 1 : 0,
      errorRate: candidateError ? 1 / index : 0,
      consecutiveErrors: candidateError ? 1 : 0,
      tripped: false,
    },
    selectedAuthority: "candidate",
    returnedAuthority: candidateError ? "incumbent" : "candidate",
    candidateInfluencedExecution: !candidateError,
    ...(candidateError ? { fallbackReason: "candidate_error" as const } : {}),
    labelsKnown: false,
    request: {
      pattern: "gate",
      questionIds: ["verdict"],
    },
    incumbent: {
      providerId: "incumbent",
      status: "ok",
      wallLatencyMs: 10,
    },
    candidate: candidateError
      ? {
          providerId: "candidate",
          status: "error",
          wallLatencyMs: 12,
          error: "candidate fault",
        }
      : {
          providerId: "candidate",
          status: "ok",
          wallLatencyMs: 12,
        },
    comparableQuestions: candidateError ? 0 : 1,
    agreements: candidateError ? 0 : agreement ? 1 : 0,
    disagreements: candidateError ? 0 : agreement ? 0 : 1,
    agreementRate: candidateError ? 0 : agreement ? 1 : 0,
    questions: candidateError
      ? []
      : [
          {
            questionId: "verdict",
            type: "choice",
            comparable: true,
            agreement,
            incumbentConfidence,
            candidateConfidence: confidence,
          },
        ],
  };
};

const candidateTraces = (policyId: string): CanaryTrace[] =>
  Array.from({ length: 20 }, (_, index) =>
    trace(policyId, index + 1, {
      confidence: 0.7,
      agreement: index < 15,
    }),
  );

const healthPolicy = {
  minCandidateSelected: 20,
  minComparableQuestions: 20,
  minCandidateConfidenceSamples: 20,
  maxCandidateErrorRate: 0.05,
  maxIncumbentErrorRate: 0.05,
  maxFallbackRate: 0.05,
  maxP95LatencyRatio: 2,
};

const stageSummary = (
  policy: CanaryActivationPolicy,
): CanarySessionSummary => ({
  ...baselineSummary(policy.policyId),
  policyId: policy.policyId,
  stage: policy.stage,
  trafficFraction: policy.trafficFraction,
  traces: 50,
  eligibleRequests: 50,
  candidateSelected: 50,
  candidateReturned: 50,
  comparableQuestions: 50,
  disagreements: 4,
  agreementRate: 0.92,
  candidateConfidenceSamples: 50,
  meanCandidateConfidence: 0.71,
  incumbentConfidenceSamples: 50,
  meanIncumbentConfidence: 0.87,
});

const advance = (policy: CanaryActivationPolicy) =>
  evaluateCanaryAdvance(stageSummary(policy), {
    minCandidateSelected: 20,
    minComparableQuestions: 20,
    maxCandidateErrorRate: 0.05,
    maxIncumbentErrorRate: 0.05,
    maxFallbackRate: 0.05,
    maxDisagreementRate: 0.15,
    maxP95LatencyRatio: 2,
  });

const acceptanceReview = (
  overrides: Partial<WorkloadRebaselineAcceptanceReview> = {},
): WorkloadRebaselineAcceptanceReview => ({
  schemaVersion: "mso.rebaseline-acceptance-review.v0",
  rebaselineId: "rebaseline-v2",
  operatorReviewed: true,
  operatorApprovalRef: "ops:accept-rebaseline-v2",
  evidenceRefs: ["recovery-canary:asset-qa-v2"],
  acceptanceSummary:
    "Recovery canary stayed operationally healthy across 1%, 5%, and 25%.",
  ...overrides,
});

test("workload drift candidate reports distribution delta and emits recovery canary_1", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);

  const result = buildWorkloadRebaselineCandidate(
    registry,
    active,
    drift,
    hold(active, drift.policyId),
    recovery,
    candidateTraces(active.policyId),
    review(),
    healthPolicy,
    {
      newCanaryPolicyId: "recovery-canary-v2-1",
      now: new Date("2026-10-03T03:00:00.000Z"),
    },
  );

  assert.equal(result.evidence.status, "pass");
  assert.equal(result.evidence.action, "eligible_for_recovery_canary");
  assert.equal(result.evidence.oldBaselineReplaced, false);
  assert.equal(result.evidence.candidateBaseline.meanCandidateConfidence, 0.7);
  assert.ok(result.evidence.delta.meanCandidateConfidence < 0);
  assert.equal(result.restartPolicy?.stage, "canary_1");
  assert.equal(result.restartPolicy?.trafficFraction, 0.01);
});

test("rebaseline review is blocked when operator approval is missing", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);

  const result = buildWorkloadRebaselineCandidate(
    registry,
    active,
    drift,
    hold(active, drift.policyId),
    recovery,
    candidateTraces(active.policyId),
    review({ operatorReviewed: false }),
    healthPolicy,
    { newCanaryPolicyId: "unused" },
  );

  assert.equal(result.evidence.status, "blocked");
  assert.equal(result.evidence.action, "review_required");
  assert.equal(result.restartPolicy, undefined);
});

test("operationally unhealthy new workload cannot become a baseline candidate", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);
  const unhealthy = candidateTraces(active.policyId);
  unhealthy[0] = trace(active.policyId, 1, { candidateError: true });
  unhealthy[1] = trace(active.policyId, 2, { candidateError: true });

  const result = buildWorkloadRebaselineCandidate(
    registry,
    active,
    drift,
    hold(active, drift.policyId),
    recovery,
    unhealthy,
    review(),
    healthPolicy,
    { newCanaryPolicyId: "unused" },
  );

  assert.equal(result.evidence.status, "fail");
  assert.equal(result.evidence.action, "unhealthy_baseline_candidate");
  assert.equal(result.restartPolicy, undefined);
});

test("complete recovery canary chain materializes limited-active and new drift baseline", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);
  const candidate = buildWorkloadRebaselineCandidate(
    registry,
    active,
    drift,
    hold(active, drift.policyId),
    recovery,
    candidateTraces(active.policyId),
    review(),
    healthPolicy,
    { newCanaryPolicyId: "recovery-canary-v2-1" },
  );
  assert.ok(candidate.restartPolicy);

  const canary1 = candidate.restartPolicy;
  const canary5 = activation(registry, "recovery-canary-v2-5", "canary_5");
  const canary25 = activation(registry, "recovery-canary-v2-25", "canary_25");

  const result = acceptWorkloadRebaseline(
    registry,
    candidate.evidence,
    [canary1, canary5, canary25],
    [advance(canary1), advance(canary5), advance(canary25)],
    acceptanceReview(),
    {
      limitedActivePolicyId: "asset-qa-v2-active-rebaseline",
      driftPolicyId: "asset-qa-v2-drift-rebaseline",
      driftWindow: {
        size: 100,
        minCandidateSelected: 50,
        minComparableQuestions: 50,
        minCandidateConfidenceSamples: 50,
      },
      driftThresholds: {
        maxCandidateErrorRate: 0.05,
        maxIncumbentErrorRate: 0.05,
        maxFallbackRate: 0.05,
        maxDisagreementRate: 0.15,
        maxP95LatencyRatio: 2,
        maxMeanCandidateConfidenceDelta: 0.15,
      },
    },
  );

  assert.equal(result.evidence.status, "pass");
  assert.equal(result.evidence.action, "eligible_for_limited_active");
  assert.equal(result.evidence.oldBaselineReplaced, false);
  assert.deepEqual(result.evidence.recoveryCanaryStages, [
    "canary_1",
    "canary_5",
    "canary_25",
  ]);
  assert.equal(result.limitedActivePolicy?.stage, "limited_active");
  assert.equal(result.driftPolicy?.baseline.sourcePolicyId, canary25.policyId);
  assert.equal(result.driftPolicy?.baseline.meanCandidateConfidence, 0.71);
  assert.equal(
    result.driftPolicy?.activationPolicyId,
    result.limitedActivePolicy?.policyId,
  );
});

test("acceptance requires the full 1 -> 5 -> 25 canary evidence chain", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);
  const candidate = buildWorkloadRebaselineCandidate(
    registry,
    active,
    drift,
    hold(active, drift.policyId),
    recovery,
    candidateTraces(active.policyId),
    review(),
    healthPolicy,
    { newCanaryPolicyId: "recovery-canary-v2-1" },
  );
  assert.ok(candidate.restartPolicy);
  const canary1 = candidate.restartPolicy;
  const canary5 = activation(registry, "recovery-canary-v2-5", "canary_5");
  const wrong25 = activation(registry, "wrong-25", "canary_5");

  assert.throws(
    () =>
      acceptWorkloadRebaseline(
        registry,
        candidate.evidence,
        [canary1, canary5, wrong25],
        [advance(canary1), advance(canary5), advance(wrong25)],
        acceptanceReview(),
        {
          limitedActivePolicyId: "never",
          driftPolicyId: "never",
          driftWindow: {
            size: 20,
            minCandidateSelected: 10,
            minComparableQuestions: 10,
            minCandidateConfidenceSamples: 10,
          },
          driftThresholds: {
            maxCandidateErrorRate: 0.1,
            maxIncumbentErrorRate: 0.1,
            maxFallbackRate: 0.1,
            maxDisagreementRate: 0.2,
            maxP95LatencyRatio: 2,
            maxMeanCandidateConfidenceDelta: 0.2,
          },
        },
      ),
    /policy stages do not match/,
  );
});

test("acceptance review can block materialization after healthy recovery canary", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);
  const candidate = buildWorkloadRebaselineCandidate(
    registry,
    active,
    drift,
    hold(active, drift.policyId),
    recovery,
    candidateTraces(active.policyId),
    review(),
    healthPolicy,
    { newCanaryPolicyId: "recovery-canary-v2-1" },
  );
  assert.ok(candidate.restartPolicy);
  const canary1 = candidate.restartPolicy;
  const canary5 = activation(registry, "recovery-canary-v2-5", "canary_5");
  const canary25 = activation(registry, "recovery-canary-v2-25", "canary_25");

  const result = acceptWorkloadRebaseline(
    registry,
    candidate.evidence,
    [canary1, canary5, canary25],
    [advance(canary1), advance(canary5), advance(canary25)],
    acceptanceReview({ operatorReviewed: false }),
    {
      limitedActivePolicyId: "never",
      driftPolicyId: "never",
      driftWindow: {
        size: 20,
        minCandidateSelected: 10,
        minComparableQuestions: 10,
        minCandidateConfidenceSamples: 10,
      },
      driftThresholds: {
        maxCandidateErrorRate: 0.1,
        maxIncumbentErrorRate: 0.1,
        maxFallbackRate: 0.1,
        maxDisagreementRate: 0.2,
        maxP95LatencyRatio: 2,
        maxMeanCandidateConfidenceDelta: 0.2,
      },
    },
  );

  assert.equal(result.evidence.status, "blocked");
  assert.equal(result.evidence.action, "hold_remains");
  assert.equal(result.limitedActivePolicy, undefined);
  assert.equal(result.driftPolicy, undefined);
});

test("rebaseline route rejects non-workload diagnosis", () => {
  const registry = registryFixture();
  const active = activation(registry);
  const drift = driftPolicy(active);

  assert.throws(
    () =>
      buildWorkloadRebaselineCandidate(
        registry,
        active,
        drift,
        hold(active, drift.policyId),
        { ...recovery, classification: "provider_regression" },
        candidateTraces(active.policyId),
        review(),
        healthPolicy,
        { newCanaryPolicyId: "never" },
      ),
    /requires workload_drift/,
  );
});
