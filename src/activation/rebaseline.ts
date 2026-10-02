import type {
  CanaryActivationPolicy,
  CanaryAdvanceEvidence,
  CanarySessionSummary,
  CanaryTrace,
} from "./canary.js";
import {
  buildCanaryActivationPolicy,
  summarizeCanaryTraces,
} from "./canary.js";
import type {
  ActiveLimitedDriftPolicy,
  DriftHoldEvent,
  DriftThresholds,
  DriftWindowPolicy,
} from "./drift.js";
import { buildActiveLimitedDriftPolicy } from "./drift.js";
import type { HoldRecoveryCase } from "./recovery.js";
import { validateHoldRecoveryCase } from "./recovery.js";
import type { CheckpointLineageRegistry } from "../lineage/registry.js";
import { deriveLineageState } from "../lineage/registry.js";

export interface WorkloadBaselineHealthPolicy {
  minCandidateSelected: number;
  minComparableQuestions: number;
  minCandidateConfidenceSamples: number;
  maxCandidateErrorRate: number;
  maxIncumbentErrorRate: number;
  maxFallbackRate: number;
  maxP95LatencyRatio: number;
}

export interface WorkloadRebaselineReview {
  schemaVersion: "mso.rebaseline-review.v0";
  rebaselineId: string;
  holdId: string;
  recoveryId: string;
  operatorReviewed: boolean;
  operatorApprovalRef?: string;
  distributionSummary: string;
  evidenceRefs: readonly string[];
}

export interface WorkloadBaselineMetrics {
  traces: number;
  candidateSelected: number;
  comparableQuestions: number;
  candidateConfidenceSamples: number;
  meanCandidateConfidence: number;
  candidateErrorRate: number;
  incumbentErrorRate: number;
  fallbackRate: number;
  disagreementRate: number;
  p95LatencyRatio: number;
}

export interface WorkloadBaselineDelta {
  candidateErrorRate: number;
  incumbentErrorRate: number;
  fallbackRate: number;
  disagreementRate: number;
  p95LatencyRatio: number;
  meanCandidateConfidence: number;
}

export interface WorkloadRebaselineCheck {
  id:
    | "workload_drift_route"
    | "operator_review"
    | "operator_approval"
    | "distribution_evidence"
    | "candidate_selected"
    | "comparable_questions"
    | "candidate_confidence_samples"
    | "candidate_error_rate"
    | "incumbent_error_rate"
    | "fallback_rate"
    | "p95_latency_ratio"
    | "lineage_head";
  status: "pass" | "fail" | "blocked";
  actual?: number;
  required?: number;
  detail: string;
}

export interface WorkloadRebaselineCandidateEvidence {
  schemaVersion: "mso.rebaseline-candidate.v0";
  rebaselineId: string;
  createdAt: string;
  holdId: string;
  recoveryId: string;
  decisionSurface: string;
  candidateCheckpointId: string;
  candidateFingerprint: string;
  previousActivationPolicyId: string;
  previousDriftPolicyId: string;
  sourceTracePolicyId: string;
  status: "pass" | "blocked" | "fail";
  action:
    | "eligible_for_recovery_canary"
    | "review_required"
    | "unhealthy_baseline_candidate";
  automaticActivation: false;
  oldBaselineReplaced: false;
  oldBaseline: WorkloadBaselineMetrics;
  candidateBaseline: WorkloadBaselineMetrics;
  delta: WorkloadBaselineDelta;
  checks: readonly WorkloadRebaselineCheck[];
  review: WorkloadRebaselineReview;
  restartPolicyId?: string;
  restartStage?: "canary_1";
}

export interface WorkloadRebaselineCandidateResult {
  evidence: WorkloadRebaselineCandidateEvidence;
  restartPolicy?: CanaryActivationPolicy;
}

export interface WorkloadRebaselineAcceptanceReview {
  schemaVersion: "mso.rebaseline-acceptance-review.v0";
  rebaselineId: string;
  operatorReviewed: boolean;
  operatorApprovalRef?: string;
  evidenceRefs: readonly string[];
  acceptanceSummary: string;
}

export interface WorkloadRebaselineAcceptanceEvidence {
  schemaVersion: "mso.rebaseline-acceptance.v0";
  rebaselineId: string;
  createdAt: string;
  decisionSurface: string;
  candidateCheckpointId: string;
  candidateFingerprint: string;
  recoveryCanaryPolicyId: string;
  recoveryCanaryStage: "canary_25";
  recoveryCanaryAdvanceAction: "eligible_for_next_stage";
  status: "pass" | "blocked";
  action: "eligible_for_limited_active" | "hold_remains";
  automaticActivation: false;
  oldBaselineReplaced: false;
  acceptedBaseline: WorkloadBaselineMetrics;
  limitedActivePolicyId?: string;
  driftPolicyId?: string;
  review: WorkloadRebaselineAcceptanceReview;
}

export interface WorkloadRebaselineAcceptanceResult {
  evidence: WorkloadRebaselineAcceptanceEvidence;
  limitedActivePolicy?: CanaryActivationPolicy;
  driftPolicy?: ActiveLimitedDriftPolicy;
}

const nonEmpty = (value: string, label: string): void => {
  if (!value.trim()) throw new Error(`${label} must be non-empty`);
};

const rate = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be in [0,1]`);
  }
};

const positive = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive`);
  }
};

const positiveInteger = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
};

const validateHealthPolicy = (
  policy: WorkloadBaselineHealthPolicy,
): void => {
  positiveInteger(policy.minCandidateSelected, "minCandidateSelected");
  positiveInteger(policy.minComparableQuestions, "minComparableQuestions");
  positiveInteger(
    policy.minCandidateConfidenceSamples,
    "minCandidateConfidenceSamples",
  );
  rate(policy.maxCandidateErrorRate, "maxCandidateErrorRate");
  rate(policy.maxIncumbentErrorRate, "maxIncumbentErrorRate");
  rate(policy.maxFallbackRate, "maxFallbackRate");
  positive(policy.maxP95LatencyRatio, "maxP95LatencyRatio");
};

export const validateWorkloadRebaselineReview = (
  review: WorkloadRebaselineReview,
): void => {
  if (review.schemaVersion !== "mso.rebaseline-review.v0") {
    throw new Error("unsupported rebaseline review schema");
  }
  nonEmpty(review.rebaselineId, "rebaselineId");
  nonEmpty(review.holdId, "holdId");
  nonEmpty(review.recoveryId, "recoveryId");
  nonEmpty(review.distributionSummary, "distributionSummary");
  if (review.operatorApprovalRef !== undefined) {
    nonEmpty(review.operatorApprovalRef, "operatorApprovalRef");
  }
  for (const ref of review.evidenceRefs) nonEmpty(ref, "evidenceRefs");
};

export const validateWorkloadRebaselineAcceptanceReview = (
  review: WorkloadRebaselineAcceptanceReview,
): void => {
  if (
    review.schemaVersion !== "mso.rebaseline-acceptance-review.v0"
  ) {
    throw new Error("unsupported rebaseline acceptance review schema");
  }
  nonEmpty(review.rebaselineId, "rebaselineId");
  nonEmpty(review.acceptanceSummary, "acceptanceSummary");
  if (review.operatorApprovalRef !== undefined) {
    nonEmpty(review.operatorApprovalRef, "operatorApprovalRef");
  }
  for (const ref of review.evidenceRefs) nonEmpty(ref, "evidenceRefs");
};

const incumbentErrorRate = (summary: CanarySessionSummary): number =>
  summary.traces === 0 ? 0 : summary.incumbentErrors / summary.traces;

const disagreementRate = (summary: CanarySessionSummary): number =>
  summary.comparableQuestions === 0
    ? 0
    : summary.disagreements / summary.comparableQuestions;

const metricsFromSummary = (
  summary: CanarySessionSummary,
): WorkloadBaselineMetrics => ({
  traces: summary.traces,
  candidateSelected: summary.candidateSelected,
  comparableQuestions: summary.comparableQuestions,
  candidateConfidenceSamples: summary.candidateConfidenceSamples,
  meanCandidateConfidence: summary.meanCandidateConfidence,
  candidateErrorRate: summary.candidateErrorRate,
  incumbentErrorRate: incumbentErrorRate(summary),
  fallbackRate: summary.fallbackRate,
  disagreementRate: disagreementRate(summary),
  p95LatencyRatio: summary.p95LatencyRatio,
});

const metricsFromDriftBaseline = (
  policy: ActiveLimitedDriftPolicy,
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

const delta = (
  current: WorkloadBaselineMetrics,
  previous: WorkloadBaselineMetrics,
): WorkloadBaselineDelta => ({
  candidateErrorRate:
    current.candidateErrorRate - previous.candidateErrorRate,
  incumbentErrorRate:
    current.incumbentErrorRate - previous.incumbentErrorRate,
  fallbackRate: current.fallbackRate - previous.fallbackRate,
  disagreementRate:
    current.disagreementRate - previous.disagreementRate,
  p95LatencyRatio: current.p95LatencyRatio - previous.p95LatencyRatio,
  meanCandidateConfidence:
    current.meanCandidateConfidence - previous.meanCandidateConfidence,
});

const check = (
  id: WorkloadRebaselineCheck["id"],
  status: WorkloadRebaselineCheck["status"],
  detail: string,
  actual?: number,
  required?: number,
): WorkloadRebaselineCheck => ({
  id,
  status,
  ...(actual === undefined ? {} : { actual }),
  ...(required === undefined ? {} : { required }),
  detail,
});

const assertWorkloadDriftIdentity = (
  activationPolicy: CanaryActivationPolicy,
  driftPolicy: ActiveLimitedDriftPolicy,
  hold: DriftHoldEvent,
  recovery: HoldRecoveryCase,
  review: WorkloadRebaselineReview,
): void => {
  validateHoldRecoveryCase(recovery);
  validateWorkloadRebaselineReview(review);
  if (recovery.classification !== "workload_drift") {
    throw new Error("rebaseline route requires workload_drift classification");
  }
  if (
    recovery.holdId !== hold.holdId ||
    review.holdId !== hold.holdId ||
    review.recoveryId !== recovery.recoveryId
  ) {
    throw new Error("rebaseline hold/recovery/review identity mismatch");
  }
  if (
    hold.policyId !== driftPolicy.policyId ||
    hold.activationPolicyId !== activationPolicy.policyId ||
    hold.decisionSurface !== activationPolicy.decisionSurface ||
    hold.candidateCheckpointId !== activationPolicy.candidateCheckpointId ||
    hold.candidateFingerprint !== activationPolicy.candidateFingerprint
  ) {
    throw new Error("rebaseline hold identity does not match policies");
  }
  if (review.rebaselineId.trim().length === 0) {
    throw new Error("rebaselineId must be non-empty");
  }
};

const assertCurrentLineage = (
  registry: CheckpointLineageRegistry,
  activationPolicy: CanaryActivationPolicy,
): void => {
  const lineage = deriveLineageState(registry);
  if (
    lineage.recordedHeadCheckpointId !==
    activationPolicy.candidateCheckpointId
  ) {
    throw new Error("rebaseline checkpoint is no longer the lineage head");
  }
  const checkpoint =
    lineage.checkpoints[activationPolicy.candidateCheckpointId];
  if (
    !checkpoint ||
    checkpoint.lifecycle !== "promoted" ||
    checkpoint.checkpoint.fingerprint !==
      activationPolicy.candidateFingerprint
  ) {
    throw new Error(
      "rebaseline checkpoint is no longer the same promoted artifact",
    );
  }
  if (
    !checkpoint.latestRollbackTargetId ||
    !lineage.checkpoints[checkpoint.latestRollbackTargetId]?.knownGood
  ) {
    throw new Error(
      "rebaseline checkpoint no longer has a known-good rollback target",
    );
  }
};

export const buildWorkloadRebaselineCandidate = (
  registry: CheckpointLineageRegistry,
  activationPolicy: CanaryActivationPolicy,
  driftPolicy: ActiveLimitedDriftPolicy,
  hold: DriftHoldEvent,
  recovery: HoldRecoveryCase,
  candidateTraces: readonly CanaryTrace[],
  review: WorkloadRebaselineReview,
  healthPolicy: WorkloadBaselineHealthPolicy,
  options: {
    newCanaryPolicyId: string;
    now?: Date;
  },
): WorkloadRebaselineCandidateResult => {
  assertWorkloadDriftIdentity(
    activationPolicy,
    driftPolicy,
    hold,
    recovery,
    review,
  );
  validateHealthPolicy(healthPolicy);
  nonEmpty(options.newCanaryPolicyId, "newCanaryPolicyId");
  assertCurrentLineage(registry, activationPolicy);

  const summary = summarizeCanaryTraces(
    activationPolicy,
    candidateTraces,
  );
  const previous = metricsFromDriftBaseline(driftPolicy);
  const candidate = metricsFromSummary(summary);
  const checks: WorkloadRebaselineCheck[] = [
    check(
      "workload_drift_route",
      "pass",
      "recovery classification explicitly routes through rebaseline",
    ),
    check(
      "operator_review",
      review.operatorReviewed ? "pass" : "blocked",
      review.operatorReviewed
        ? "new workload distribution was operator-reviewed"
        : "operator review is required",
    ),
    check(
      "operator_approval",
      review.operatorReviewed && review.operatorApprovalRef
        ? "pass"
        : "blocked",
      review.operatorApprovalRef
        ? "operator approval reference supplied"
        : "operator approval reference is required",
    ),
    check(
      "distribution_evidence",
      review.evidenceRefs.length > 0 ? "pass" : "blocked",
      review.evidenceRefs.length > 0
        ? `${review.evidenceRefs.length} distribution evidence reference(s) supplied`
        : "distribution evidence is required",
    ),
    check(
      "candidate_selected",
      candidate.candidateSelected >= healthPolicy.minCandidateSelected
        ? "pass"
        : "blocked",
      "new workload sample has enough candidate-authority observations",
      candidate.candidateSelected,
      healthPolicy.minCandidateSelected,
    ),
    check(
      "comparable_questions",
      candidate.comparableQuestions >= healthPolicy.minComparableQuestions
        ? "pass"
        : "blocked",
      "new workload sample has enough incumbent/candidate comparisons",
      candidate.comparableQuestions,
      healthPolicy.minComparableQuestions,
    ),
    check(
      "candidate_confidence_samples",
      candidate.candidateConfidenceSamples >=
        healthPolicy.minCandidateConfidenceSamples
        ? "pass"
        : "blocked",
      "new workload sample has enough candidate confidence telemetry",
      candidate.candidateConfidenceSamples,
      healthPolicy.minCandidateConfidenceSamples,
    ),
    check(
      "candidate_error_rate",
      candidate.candidateErrorRate <= healthPolicy.maxCandidateErrorRate
        ? "pass"
        : "fail",
      "candidate remains operationally healthy on the proposed workload baseline",
      candidate.candidateErrorRate,
      healthPolicy.maxCandidateErrorRate,
    ),
    check(
      "incumbent_error_rate",
      candidate.incumbentErrorRate <= healthPolicy.maxIncumbentErrorRate
        ? "pass"
        : "fail",
      "incumbent fallback remains healthy on the proposed workload baseline",
      candidate.incumbentErrorRate,
      healthPolicy.maxIncumbentErrorRate,
    ),
    check(
      "fallback_rate",
      candidate.fallbackRate <= healthPolicy.maxFallbackRate
        ? "pass"
        : "fail",
      "fallback rate remains acceptable on the proposed workload baseline",
      candidate.fallbackRate,
      healthPolicy.maxFallbackRate,
    ),
    check(
      "p95_latency_ratio",
      candidate.p95LatencyRatio <= healthPolicy.maxP95LatencyRatio
        ? "pass"
        : "fail",
      "candidate latency remains bounded on the proposed workload baseline",
      candidate.p95LatencyRatio,
      healthPolicy.maxP95LatencyRatio,
    ),
    check(
      "lineage_head",
      "pass",
      "current promoted checkpoint and known-good rollback target remain valid",
    ),
  ];

  const status = checks.some((item) => item.status === "fail")
    ? "fail"
    : checks.some((item) => item.status === "blocked")
      ? "blocked"
      : "pass";
  const action =
    status === "fail"
      ? "unhealthy_baseline_candidate"
      : status === "blocked"
        ? "review_required"
        : "eligible_for_recovery_canary";

  const baseEvidence = {
    schemaVersion: "mso.rebaseline-candidate.v0" as const,
    rebaselineId: review.rebaselineId,
    createdAt: (options.now ?? new Date()).toISOString(),
    holdId: hold.holdId,
    recoveryId: recovery.recoveryId,
    decisionSurface: activationPolicy.decisionSurface,
    candidateCheckpointId: activationPolicy.candidateCheckpointId,
    candidateFingerprint: activationPolicy.candidateFingerprint,
    previousActivationPolicyId: activationPolicy.policyId,
    previousDriftPolicyId: driftPolicy.policyId,
    sourceTracePolicyId: activationPolicy.policyId,
    status,
    action,
    automaticActivation: false as const,
    oldBaselineReplaced: false as const,
    oldBaseline: previous,
    candidateBaseline: candidate,
    delta: delta(candidate, previous),
    checks,
    review,
  };

  if (status !== "pass") {
    return { evidence: baseEvidence };
  }

  const restartPolicy = buildCanaryActivationPolicy(registry, {
    policyId: options.newCanaryPolicyId,
    candidateProviderId: activationPolicy.candidateProviderId,
    incumbentProviderId: activationPolicy.incumbentProviderId,
    stage: "canary_1",
    allowedPatterns: [...activationPolicy.allowedPatterns],
    circuitBreaker: { ...activationPolicy.circuitBreaker },
  });

  return {
    evidence: {
      ...baseEvidence,
      restartPolicyId: restartPolicy.policyId,
      restartStage: "canary_1",
    },
    restartPolicy,
  };
};

export const acceptWorkloadRebaseline = (
  registry: CheckpointLineageRegistry,
  candidateEvidence: WorkloadRebaselineCandidateEvidence,
  recoveryCanaryPolicy: CanaryActivationPolicy,
  advanceEvidence: CanaryAdvanceEvidence,
  review: WorkloadRebaselineAcceptanceReview,
  options: {
    limitedActivePolicyId: string;
    driftPolicyId: string;
    driftWindow: DriftWindowPolicy;
    driftThresholds: DriftThresholds;
    now?: Date;
  },
): WorkloadRebaselineAcceptanceResult => {
  validateWorkloadRebaselineAcceptanceReview(review);
  if (
    candidateEvidence.status !== "pass" ||
    candidateEvidence.action !== "eligible_for_recovery_canary"
  ) {
    throw new Error("rebaseline candidate is not eligible for recovery canary");
  }
  if (review.rebaselineId !== candidateEvidence.rebaselineId) {
    throw new Error("rebaseline acceptance review identity mismatch");
  }
  if (
    recoveryCanaryPolicy.candidateCheckpointId !==
      candidateEvidence.candidateCheckpointId ||
    recoveryCanaryPolicy.candidateFingerprint !==
      candidateEvidence.candidateFingerprint ||
    recoveryCanaryPolicy.decisionSurface !==
      candidateEvidence.decisionSurface
  ) {
    throw new Error("recovery canary does not match rebaseline candidate");
  }
  if (
    recoveryCanaryPolicy.stage !== "canary_25" ||
    advanceEvidence.policyId !== recoveryCanaryPolicy.policyId ||
    advanceEvidence.currentStage !== "canary_25" ||
    advanceEvidence.nextStage !== "limited_active" ||
    advanceEvidence.status !== "pass" ||
    advanceEvidence.action !== "eligible_for_next_stage" ||
    advanceEvidence.automaticStageAdvance !== false
  ) {
    throw new Error(
      "rebaseline acceptance requires a passing canary_25 advance evidence",
    );
  }
  assertCurrentLineage(registry, recoveryCanaryPolicy);
  nonEmpty(options.limitedActivePolicyId, "limitedActivePolicyId");
  nonEmpty(options.driftPolicyId, "driftPolicyId");

  const reviewed =
    review.operatorReviewed &&
    Boolean(review.operatorApprovalRef) &&
    review.evidenceRefs.length > 0;

  const baseEvidence = {
    schemaVersion: "mso.rebaseline-acceptance.v0" as const,
    rebaselineId: candidateEvidence.rebaselineId,
    createdAt: (options.now ?? new Date()).toISOString(),
    decisionSurface: candidateEvidence.decisionSurface,
    candidateCheckpointId: candidateEvidence.candidateCheckpointId,
    candidateFingerprint: candidateEvidence.candidateFingerprint,
    recoveryCanaryPolicyId: recoveryCanaryPolicy.policyId,
    recoveryCanaryStage: "canary_25" as const,
    recoveryCanaryAdvanceAction: "eligible_for_next_stage" as const,
    automaticActivation: false as const,
    oldBaselineReplaced: false as const,
    acceptedBaseline: metricsFromSummary(advanceEvidence.summary),
    review,
  };

  if (!reviewed) {
    return {
      evidence: {
        ...baseEvidence,
        status: "blocked",
        action: "hold_remains",
      },
    };
  }

  const limitedActivePolicy = buildCanaryActivationPolicy(registry, {
    policyId: options.limitedActivePolicyId,
    candidateProviderId: recoveryCanaryPolicy.candidateProviderId,
    incumbentProviderId: recoveryCanaryPolicy.incumbentProviderId,
    stage: "limited_active",
    allowedPatterns: [...recoveryCanaryPolicy.allowedPatterns],
    circuitBreaker: { ...recoveryCanaryPolicy.circuitBreaker },
  });
  const driftPolicy = buildActiveLimitedDriftPolicy(
    limitedActivePolicy,
    recoveryCanaryPolicy,
    advanceEvidence.summary,
    {
      policyId: options.driftPolicyId,
      window: options.driftWindow,
      thresholds: options.driftThresholds,
    },
  );

  return {
    evidence: {
      ...baseEvidence,
      status: "pass",
      action: "eligible_for_limited_active",
      limitedActivePolicyId: limitedActivePolicy.policyId,
      driftPolicyId: driftPolicy.policyId,
    },
    limitedActivePolicy,
    driftPolicy,
  };
};
