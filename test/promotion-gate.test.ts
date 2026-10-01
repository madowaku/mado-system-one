import assert from "node:assert/strict";
import test from "node:test";
import type { EvalRun } from "../src/eval/skeleton.js";
import {
  evaluatePromotionGate,
  type PromotionControls,
  type PromotionPolicy,
  type PromotionReviewRecord,
} from "../src/promotion/gate.js";
import {
  parsePromotionPolicy,
  parsePromotionReviewJsonl,
} from "../src/promotion/io.js";
import type { ShadowTrace } from "../src/shadow/bridge.js";

const offlineRun = (accuracy = 1, providerErrors = 0): EvalRun => ({
  schemaVersion: "mso.eval.v0",
  runId: "offline-laya",
  datasetId: "promotion-fixture",
  providerId: "laya",
  startedAt: "2026-10-01T00:00:00.000Z",
  completedAt: "2026-10-01T00:00:01.000Z",
  providerCapabilities: {
    primitives: ["choice", "noul", "score"],
    modalities: ["text"],
    inferenceFamily: "encoder_scoring",
    specialization: "general",
    probabilitySemantics: "direct_logits",
    confidenceSemantics: "selected_probability",
    calibration: { status: "unknown" },
  },
  metrics: {
    cases: 10,
    correctCases: Math.round(10 * accuracy),
    caseAccuracy: accuracy,
    questions: 10,
    correctQuestions: Math.round(10 * accuracy),
    accuracy,
    providerErrors,
    latencyP50Ms: 10,
    latencyP95Ms: 15,
    totalEstimatedCost: 0,
  },
  cases: [],
});

const policy: PromotionPolicy = {
  schemaVersion: "mso.promotion-policy.v0",
  policyId: "asset-qa-laya-v0",
  candidateProviderId: "laya",
  decisionSurface: "asset.qa",
  thresholds: {
    minOfflineCases: 5,
    minOfflineAccuracy: 0.8,
    maxOfflineProviderErrorRate: 0,
    minShadowTraces: 2,
    minComparableQuestions: 2,
    minShadowAgreementRate: 0.5,
    maxShadowProviderErrorRate: 0,
    highConfidenceThreshold: 0.8,
    maxHighConfidenceDisagreementRate: 0.5,
    minDisagreementReviewCoverage: 1,
    minReviewedDisagreements: 1,
    minReviewedShadowAccuracy: 0.5,
    maxP95ShadowWallLatencyMs: 30,
    maxP95ShadowLagMs: 20,
    maxP95LatencyRatio: 2,
  },
};

const trace = (
  traceId: string,
  agreement: boolean,
  shadowConfidence = 0.9,
): ShadowTrace => ({
  schemaVersion: "mso.shadow.v0",
  traceId,
  capturedAt: "2026-10-01T00:00:00.000Z",
  mode: "shadow",
  authoritativeProviderId: "incumbent",
  shadowProviderId: "laya",
  shadowInfluencedExecution: false,
  labelsKnown: false,
  incumbent: {
    providerId: "incumbent",
    status: "ok",
    wallLatencyMs: 10,
  },
  shadow: {
    providerId: "laya",
    status: "ok",
    wallLatencyMs: 15,
  },
  comparableQuestions: 1,
  agreements: agreement ? 1 : 0,
  disagreements: agreement ? 0 : 1,
  agreementRate: agreement ? 1 : 0,
  shadowLagAfterIncumbentMs: 5,
  review: {
    needed: !agreement,
    reasons: agreement ? [] : ["disagreement"],
    candidateUse: agreement ? "none" : "human_label_required",
  },
  questions: [
    {
      questionId: "verdict",
      type: "choice",
      comparable: true,
      agreement,
      incumbent: {
        status: "ok",
        answer: "accept",
        confidence: 0.9,
      },
      shadow: {
        status: "ok",
        answer: agreement ? "accept" : "reject",
        confidence: shadowConfidence,
      },
    },
  ],
});

const review: PromotionReviewRecord = {
  schemaVersion: "mso.review.v0",
  traceId: "live-2",
  questionId: "verdict",
  shadowProviderId: "laya",
  label: "shadow_correct",
  source: "human",
  reviewedAt: "2026-10-01T01:00:00.000Z",
  reviewer: "qa-review",
};

const controls: PromotionControls = {
  schemaVersion: "mso.promotion-controls.v0",
  fallbackTested: true,
  killSwitchTested: true,
  redactionChecked: true,
  thresholdProfileId: "asset-qa-laya-thresholds-v1",
  rollbackTarget: "incumbent",
  attestedAt: "2026-10-01T01:10:00.000Z",
};

test("offline evidence alone can earn shadow but cannot skip live stages", () => {
  const evidence = evaluatePromotionGate({
    policy,
    offlineRun: offlineRun(),
    gateId: "offline-only",
  });

  assert.equal(evidence.maxEligibleStage, "shadow");
  assert.equal(evidence.action, "eligible_for_shadow");
  assert.equal(evidence.transitions[0]?.status, "pass");
  assert.equal(evidence.transitions[1]?.status, "fail");
  assert.notEqual(evidence.transitions[2]?.status, "pass");
  assert.equal(evidence.automaticPromotion, false);
});

test("reviewed live shadow evidence can earn candidate without auto promotion", () => {
  const evidence = evaluatePromotionGate({
    policy,
    offlineRun: offlineRun(),
    shadowTraces: [trace("live-1", true), trace("live-2", false)],
    reviews: [review],
    gateId: "candidate-only",
  });

  assert.equal(evidence.metrics.shadowAgreementRate, 0.5);
  assert.equal(evidence.metrics.highConfidenceDisagreementRate, 0.5);
  assert.equal(evidence.metrics.disagreementReviewCoverage, 1);
  assert.equal(evidence.metrics.reviewedShadowAccuracy, 1);
  assert.equal(evidence.metrics.p95LatencyRatio, 1.5);
  assert.equal(evidence.transitions[1]?.status, "pass");
  assert.equal(evidence.transitions[2]?.status, "blocked");
  assert.equal(evidence.maxEligibleStage, "candidate");
  assert.equal(evidence.action, "eligible_for_candidate");
});

test("promotion eligibility requires reviewed labels and operational controls", () => {
  const evidence = evaluatePromotionGate({
    policy,
    offlineRun: offlineRun(),
    shadowTraces: [trace("live-1", true), trace("live-2", false)],
    reviews: [review],
    controls,
    gateId: "promoted",
  });

  assert.equal(evidence.transitions[0]?.status, "pass");
  assert.equal(evidence.transitions[1]?.status, "pass");
  assert.equal(evidence.transitions[2]?.status, "pass");
  assert.equal(evidence.maxEligibleStage, "promoted");
  assert.equal(evidence.action, "eligible_for_promotion");
  assert.equal(evidence.automaticPromotion, false);
});

test("agreement alone is not treated as live correctness", () => {
  const evidence = evaluatePromotionGate({
    policy,
    offlineRun: offlineRun(),
    shadowTraces: [trace("live-1", true), trace("live-2", true)],
    controls,
    gateId: "agreement-only",
  });

  assert.equal(evidence.metrics.shadowAgreementRate, 1);
  assert.equal(evidence.metrics.disagreementQuestions, 0);
  assert.equal(evidence.metrics.reviewedDisagreements, 0);
  assert.equal(evidence.transitions[1]?.status, "pass");
  assert.notEqual(evidence.transitions[2]?.status, "pass");
  assert.equal(evidence.maxEligibleStage, "candidate");
});

test("high-confidence disagreement ceiling can block candidate status", () => {
  const evidence = evaluatePromotionGate({
    policy,
    offlineRun: offlineRun(),
    shadowTraces: [trace("live-1", false, 0.95), trace("live-2", false, 0.99)],
    reviews: [
      {
        ...review,
        traceId: "live-1",
        label: "incumbent_correct",
      },
      review,
    ],
    gateId: "risky-shadow",
  });

  const check = evidence.transitions[1]?.checks.find(
    (item) => item.id === "high_confidence_disagreement_rate",
  );
  assert.equal(check?.status, "fail");
  assert.equal(check?.actual, 1);
  assert.equal(evidence.maxEligibleStage, "shadow");
});

test("candidate identity mismatch is rejected", () => {
  assert.throws(
    () =>
      evaluatePromotionGate({
        policy,
        offlineRun: { ...offlineRun(), providerId: "jev" },
      }),
    /does not match policy candidate/,
  );
});

test("review parser rejects duplicate labels for the same live question", () => {
  const line = JSON.stringify(review);
  assert.throws(
    () => parsePromotionReviewJsonl(`${line}\n${line}\n`),
    /duplicate review record/,
  );
});

test("policy parser requires explicit decision-surface thresholds", () => {
  const parsed = parsePromotionPolicy(policy);
  assert.equal(parsed.policyId, policy.policyId);
  assert.equal(parsed.thresholds.highConfidenceThreshold, 0.8);

  assert.throws(
    () =>
      parsePromotionPolicy({
        ...policy,
        thresholds: {
          ...policy.thresholds,
          highConfidenceThreshold: undefined,
        },
      }),
    /highConfidenceThreshold/,
  );
});
