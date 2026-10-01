import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvalRun } from "../eval/skeleton.js";
import type { ShadowTrace } from "../shadow/bridge.js";

export type PromotionStage =
  | "experimental"
  | "shadow"
  | "candidate"
  | "promoted";

export type GateStatus = "pass" | "fail" | "blocked";

export interface PromotionThresholds {
  minOfflineCases: number;
  minOfflineAccuracy: number;
  maxOfflineProviderErrorRate: number;
  minShadowTraces: number;
  minComparableQuestions: number;
  minShadowAgreementRate: number;
  maxShadowProviderErrorRate: number;
  highConfidenceThreshold: number;
  maxHighConfidenceDisagreementRate: number;
  minDisagreementReviewCoverage: number;
  minReviewedDisagreements: number;
  minReviewedShadowAccuracy: number;
  maxP95ShadowWallLatencyMs?: number;
  maxP95ShadowLagMs?: number;
  maxP95LatencyRatio?: number;
}

export interface PromotionPolicy {
  schemaVersion: "mso.promotion-policy.v0";
  policyId: string;
  candidateProviderId: string;
  decisionSurface: string;
  thresholds: PromotionThresholds;
}

export interface PromotionControls {
  schemaVersion: "mso.promotion-controls.v0";
  fallbackTested: boolean;
  killSwitchTested: boolean;
  redactionChecked: boolean;
  thresholdProfileId?: string;
  rollbackTarget?: string;
  attestedAt?: string;
}

export type PromotionReviewLabel =
  | "shadow_correct"
  | "incumbent_correct"
  | "both_acceptable"
  | "neither";

export interface PromotionReviewRecord {
  schemaVersion: "mso.review.v0";
  traceId: string;
  questionId: string;
  shadowProviderId: string;
  label: PromotionReviewLabel;
  source: "human" | "verified_outcome" | "deterministic_invariant";
  reviewedAt: string;
  reviewer?: string;
}

export interface GateCheck {
  id: string;
  status: GateStatus;
  actual?: number | string | boolean;
  required?: number | string | boolean;
  detail: string;
}

export interface TransitionGate {
  from: PromotionStage;
  to: PromotionStage;
  status: GateStatus;
  checks: readonly GateCheck[];
}

export interface PromotionMetrics {
  offlineCases: number;
  offlineAccuracy: number;
  offlineProviderErrorRate: number;
  shadowTraces: number;
  comparableQuestions: number;
  shadowAgreementRate: number;
  shadowProviderErrorRate: number;
  highConfidenceDisagreementQuestions: number;
  highConfidenceDisagreementRate: number;
  disagreementQuestions: number;
  reviewedDisagreements: number;
  disagreementReviewCoverage: number;
  reviewedShadowAccuracy?: number;
  p95IncumbentWallLatencyMs: number;
  p95ShadowWallLatencyMs: number;
  p95LatencyRatio: number;
  p95ShadowLagMs: number;
}

export interface PromotionGateInput {
  policy: PromotionPolicy;
  offlineRun: EvalRun;
  shadowTraces?: readonly ShadowTrace[];
  reviews?: readonly PromotionReviewRecord[];
  controls?: PromotionControls;
  gateId?: string;
}

export interface PromotionGateEvidence {
  schemaVersion: "mso.promotion-gate.v0";
  gateId: string;
  createdAt: string;
  policyId: string;
  candidateProviderId: string;
  decisionSurface: string;
  maxEligibleStage: PromotionStage;
  action: "hold" | "eligible_for_shadow" | "eligible_for_candidate" | "eligible_for_promotion";
  automaticPromotion: false;
  metrics: PromotionMetrics;
  transitions: readonly TransitionGate[];
  blockingReasons: readonly string[];
}

const pct = (values: readonly number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0;
};

const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const passMin = (
  id: string,
  actual: number,
  required: number,
  detail: string,
): GateCheck => ({
  id,
  status: actual >= required ? "pass" : "fail",
  actual,
  required,
  detail,
});

const passMax = (
  id: string,
  actual: number,
  required: number,
  detail: string,
): GateCheck => ({
  id,
  status: actual <= required ? "pass" : "fail",
  actual,
  required,
  detail,
});

const requireTrue = (
  id: string,
  actual: boolean | undefined,
  detail: string,
): GateCheck => ({
  id,
  status: actual === undefined ? "blocked" : actual ? "pass" : "fail",
  ...(actual === undefined ? {} : { actual }),
  required: true,
  detail,
});

const requireString = (
  id: string,
  actual: string | undefined,
  detail: string,
): GateCheck => ({
  id,
  status: actual ? "pass" : "blocked",
  ...(actual ? { actual } : {}),
  required: "non-empty",
  detail,
});

const transitionStatus = (checks: readonly GateCheck[]): GateStatus => {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "blocked")) return "blocked";
  return "pass";
};

const transition = (
  from: PromotionStage,
  to: PromotionStage,
  checks: readonly GateCheck[],
): TransitionGate => ({
  from,
  to,
  status: transitionStatus(checks),
  checks,
});

const reviewKey = (traceId: string, questionId: string): string =>
  `${traceId}::${questionId}`;

const validatePolicy = (policy: PromotionPolicy): void => {
  if (!policy.policyId || !policy.candidateProviderId || !policy.decisionSurface) {
    throw new Error("promotion policy identity fields must be non-empty");
  }
  const t = policy.thresholds;
  const probabilities = [
    ["minOfflineAccuracy", t.minOfflineAccuracy],
    ["maxOfflineProviderErrorRate", t.maxOfflineProviderErrorRate],
    ["minShadowAgreementRate", t.minShadowAgreementRate],
    ["maxShadowProviderErrorRate", t.maxShadowProviderErrorRate],
    ["highConfidenceThreshold", t.highConfidenceThreshold],
    ["maxHighConfidenceDisagreementRate", t.maxHighConfidenceDisagreementRate],
    ["minDisagreementReviewCoverage", t.minDisagreementReviewCoverage],
    ["minReviewedShadowAccuracy", t.minReviewedShadowAccuracy],
  ] as const;
  for (const [name, value] of probabilities) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${name} must be in [0, 1]`);
    }
  }
  for (const [name, value] of [
    ["minOfflineCases", t.minOfflineCases],
    ["minShadowTraces", t.minShadowTraces],
    ["minComparableQuestions", t.minComparableQuestions],
    ["minReviewedDisagreements", t.minReviewedDisagreements],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
};

const calculateMetrics = (
  input: PromotionGateInput,
): PromotionMetrics => {
  const { policy, offlineRun } = input;
  const shadowTraces = input.shadowTraces ?? [];
  const reviews = input.reviews ?? [];

  if (offlineRun.providerId !== policy.candidateProviderId) {
    throw new Error(
      `offline eval provider ${offlineRun.providerId} does not match policy candidate ${policy.candidateProviderId}`,
    );
  }

  const comparableQuestions = shadowTraces.reduce(
    (sum, trace) => sum + trace.comparableQuestions,
    0,
  );
  const agreements = shadowTraces.reduce(
    (sum, trace) => sum + trace.agreements,
    0,
  );
  const shadowErrors = shadowTraces.filter(
    (trace) =>
      trace.shadowProviderId === policy.candidateProviderId &&
      trace.shadow.status === "error",
  ).length;

  for (const trace of shadowTraces) {
    if (trace.shadowProviderId !== policy.candidateProviderId) {
      throw new Error(
        `shadow trace provider ${trace.shadowProviderId} does not match policy candidate ${policy.candidateProviderId}`,
      );
    }
    if (trace.labelsKnown !== false || trace.shadowInfluencedExecution !== false) {
      throw new Error(
        `shadow trace ${trace.traceId} violates non-authoritative live evidence contract`,
      );
    }
  }

  const disagreementKeys = new Set<string>();
  let highConfidenceDisagreementQuestions = 0;
  for (const trace of shadowTraces) {
    for (const question of trace.questions) {
      if (question.comparable && question.agreement === false) {
        disagreementKeys.add(reviewKey(trace.traceId, question.questionId));
        if (
          question.shadow.confidence !== undefined &&
          question.shadow.confidence >= policy.thresholds.highConfidenceThreshold
        ) {
          highConfidenceDisagreementQuestions += 1;
        }
      }
    }
  }

  const reviewByKey = new Map<string, PromotionReviewRecord>();
  for (const review of reviews) {
    if (review.shadowProviderId !== policy.candidateProviderId) continue;
    const key = reviewKey(review.traceId, review.questionId);
    if (!disagreementKeys.has(key)) continue;
    reviewByKey.set(key, review);
  }

  const reviewedDisagreements = reviewByKey.size;
  const shadowCorrectReviews = [...reviewByKey.values()].filter(
    (review) =>
      review.label === "shadow_correct" || review.label === "both_acceptable",
  ).length;

  const p95IncumbentWallLatencyMs = pct(
    shadowTraces
      .filter((trace) => trace.incumbent.status === "ok")
      .map((trace) => trace.incumbent.wallLatencyMs),
    0.95,
  );
  const p95ShadowWallLatencyMs = pct(
    shadowTraces
      .filter((trace) => trace.shadow.status === "ok")
      .map((trace) => trace.shadow.wallLatencyMs),
    0.95,
  );

  return {
    offlineCases: offlineRun.metrics.cases,
    offlineAccuracy: offlineRun.metrics.accuracy,
    offlineProviderErrorRate: rate(
      offlineRun.metrics.providerErrors,
      offlineRun.metrics.cases,
    ),
    shadowTraces: shadowTraces.length,
    comparableQuestions,
    shadowAgreementRate: rate(agreements, comparableQuestions),
    shadowProviderErrorRate: rate(shadowErrors, shadowTraces.length),
    highConfidenceDisagreementQuestions,
    highConfidenceDisagreementRate: rate(
      highConfidenceDisagreementQuestions,
      comparableQuestions,
    ),
    disagreementQuestions: disagreementKeys.size,
    reviewedDisagreements,
    disagreementReviewCoverage:
      disagreementKeys.size === 0
        ? 1
        : rate(reviewedDisagreements, disagreementKeys.size),
    ...(reviewedDisagreements === 0
      ? {}
      : {
          reviewedShadowAccuracy: rate(
            shadowCorrectReviews,
            reviewedDisagreements,
          ),
        }),
    p95IncumbentWallLatencyMs,
    p95ShadowWallLatencyMs,
    p95LatencyRatio:
      p95IncumbentWallLatencyMs > 0
        ? p95ShadowWallLatencyMs / p95IncumbentWallLatencyMs
        : 0,
    p95ShadowLagMs: pct(
      shadowTraces.map((trace) => trace.shadowLagAfterIncumbentMs),
      0.95,
    ),
  };
};

export const evaluatePromotionGate = (
  input: PromotionGateInput,
): PromotionGateEvidence => {
  validatePolicy(input.policy);
  const metrics = calculateMetrics(input);
  const t = input.policy.thresholds;

  const toShadowChecks: GateCheck[] = [
    passMin(
      "offline_cases",
      metrics.offlineCases,
      t.minOfflineCases,
      "offline labeled eval has enough cases",
    ),
    passMin(
      "offline_accuracy",
      metrics.offlineAccuracy,
      t.minOfflineAccuracy,
      "candidate meets labeled offline accuracy floor",
    ),
    passMax(
      "offline_provider_error_rate",
      metrics.offlineProviderErrorRate,
      t.maxOfflineProviderErrorRate,
      "offline provider errors remain below the policy ceiling",
    ),
  ];

  const toCandidateChecks: GateCheck[] = [
    passMin(
      "shadow_traces",
      metrics.shadowTraces,
      t.minShadowTraces,
      "live shadow exposure is representative enough for this policy",
    ),
    passMin(
      "comparable_questions",
      metrics.comparableQuestions,
      t.minComparableQuestions,
      "enough live questions produced comparable incumbent/shadow answers",
    ),
    passMin(
      "shadow_agreement_rate",
      metrics.shadowAgreementRate,
      t.minShadowAgreementRate,
      "agreement is a stability signal only, not a correctness label",
    ),
    passMax(
      "shadow_provider_error_rate",
      metrics.shadowProviderErrorRate,
      t.maxShadowProviderErrorRate,
      "candidate provider reliability stays within the policy ceiling",
    ),
    passMax(
      "high_confidence_disagreement_rate",
      metrics.highConfidenceDisagreementRate,
      t.maxHighConfidenceDisagreementRate,
      "high-confidence live disagreements stay below the risk ceiling",
    ),
    passMin(
      "disagreement_review_coverage",
      metrics.disagreementReviewCoverage,
      t.minDisagreementReviewCoverage,
      "live disagreements have sufficient human/verified-outcome review coverage",
    ),
  ];

  if (t.maxP95ShadowWallLatencyMs !== undefined) {
    toCandidateChecks.push(
      passMax(
        "p95_shadow_wall_latency_ms",
        metrics.p95ShadowWallLatencyMs,
        t.maxP95ShadowWallLatencyMs,
        "candidate wall latency stays within the decision-surface budget",
      ),
    );
  }
  if (t.maxP95ShadowLagMs !== undefined) {
    toCandidateChecks.push(
      passMax(
        "p95_shadow_lag_ms",
        metrics.p95ShadowLagMs,
        t.maxP95ShadowLagMs,
        "shadow completion lag stays operationally acceptable",
      ),
    );
  }
  if (t.maxP95LatencyRatio !== undefined) {
    toCandidateChecks.push(
      passMax(
        "p95_latency_ratio",
        metrics.p95LatencyRatio,
        t.maxP95LatencyRatio,
        "candidate p95 latency regression stays within the policy ratio",
      ),
    );
  }

  const controls = input.controls;
  const reviewedAccuracy = metrics.reviewedShadowAccuracy;
  const toPromotedChecks: GateCheck[] = [
    passMin(
      "reviewed_disagreements",
      metrics.reviewedDisagreements,
      t.minReviewedDisagreements,
      "enough disagreement cases have verified labels",
    ),
    reviewedAccuracy === undefined
      ? {
          id: "reviewed_shadow_accuracy",
          status: "blocked",
          required: t.minReviewedShadowAccuracy,
          detail: "verified disagreement labels are required before promotion",
        }
      : passMin(
          "reviewed_shadow_accuracy",
          reviewedAccuracy,
          t.minReviewedShadowAccuracy,
          "candidate performs well on the reviewed disagreement set",
        ),
    requireTrue(
      "fallback_tested",
      controls?.fallbackTested,
      "fallback behavior has been exercised",
    ),
    requireTrue(
      "kill_switch_tested",
      controls?.killSwitchTested,
      "kill switch has been exercised",
    ),
    requireTrue(
      "redaction_checked",
      controls?.redactionChecked,
      "live evidence redaction has been checked",
    ),
    requireString(
      "threshold_profile",
      controls?.thresholdProfileId,
      "a decision-surface threshold profile is attached",
    ),
    requireString(
      "rollback_target",
      controls?.rollbackTarget,
      "a known rollback target is recorded",
    ),
  ];

  const transitions = [
    transition("experimental", "shadow", toShadowChecks),
    transition("shadow", "candidate", toCandidateChecks),
    transition("candidate", "promoted", toPromotedChecks),
  ];

  let maxEligibleStage: PromotionStage = "experimental";
  if (transitions[0]?.status === "pass") maxEligibleStage = "shadow";
  if (
    maxEligibleStage === "shadow" &&
    transitions[1]?.status === "pass"
  ) {
    maxEligibleStage = "candidate";
  }
  if (
    maxEligibleStage === "candidate" &&
    transitions[2]?.status === "pass"
  ) {
    maxEligibleStage = "promoted";
  }

  const blockingReasons = transitions
    .flatMap((item) => item.checks)
    .filter((check) => check.status !== "pass")
    .map((check) => `${check.id}: ${check.detail}`);

  const action =
    maxEligibleStage === "promoted"
      ? "eligible_for_promotion"
      : maxEligibleStage === "candidate"
        ? "eligible_for_candidate"
        : maxEligibleStage === "shadow"
          ? "eligible_for_shadow"
          : "hold";

  return {
    schemaVersion: "mso.promotion-gate.v0",
    gateId:
      input.gateId ??
      `gate-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    createdAt: new Date().toISOString(),
    policyId: input.policy.policyId,
    candidateProviderId: input.policy.candidateProviderId,
    decisionSurface: input.policy.decisionSurface,
    maxEligibleStage,
    action,
    automaticPromotion: false,
    metrics,
    transitions,
    blockingReasons,
  };
};

export const writePromotionGateEvidence = async (
  path: string,
  evidence: PromotionGateEvidence,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
};
