import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionRequest, DecisionResponse } from "../src/core/types.js";
import {
  buildCanaryActivationPolicy,
  CanaryActivationProvider,
  CanaryKillSwitch,
  MemoryCanaryEvidenceSink,
  type CanarySessionSummary,
} from "../src/activation/canary.js";
import {
  ActiveLimitedDriftGuard,
  buildActiveLimitedDriftPolicy,
  evaluateDriftWindow,
  MemoryDriftHoldEvidenceSink,
} from "../src/activation/drift.js";
import {
  appendLineageEvent,
  createCheckpointLineageRegistry,
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
    "asset-qa-drift",
    "asset.qa",
    new Date("2026-10-02T00:00:00.000Z"),
  );
  registry = appendLineageEvent(registry, {
    type: "checkpoint_registered",
    data: {
      checkpointId: "base-v1",
      checkpoint: checkpoint("base-v1", "a".repeat(64)),
      origin: "base",
      knownGood: true,
      knownGoodEvidenceRef: "baseline:asset.qa:v1",
    },
  });
  registry = appendLineageEvent(registry, {
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
  });
  registry = appendLineageEvent(registry, {
    type: "promotion_recorded",
    data: {
      checkpointId: "candidate-v2",
      gateId: "gate-v2",
      gateEvidenceRef: "promotion/gate-v2.json",
      reevalId: "reeval-v2",
      reevalEvidenceRef: "reeval/v2/summary.json",
      rollbackTargetId: "base-v1",
    },
  });
  return registry;
};

const activationPolicy = (id = "active-v2") =>
  buildCanaryActivationPolicy(promotedRegistry(), {
    policyId: id,
    candidateProviderId: "candidate",
    incumbentProviderId: "incumbent",
    stage: "limited_active",
    allowedPatterns: ["gate"],
    circuitBreaker: {
      maxConsecutiveCandidateErrors: 100,
      minCandidateAttemptsForErrorRate: 100,
      maxCandidateErrorRate: 1,
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

const driftPolicy = (active = activationPolicy()) => {
  return buildActiveLimitedDriftPolicy(
    active,
    active,
    baselineSummary(active.policyId),
    {
      policyId: "drift-v2",
      window: {
        size: 3,
        minCandidateSelected: 3,
        minComparableQuestions: 3,
        minCandidateConfidenceSamples: 3,
      },
      thresholds: {
        maxCandidateErrorRate: 0.2,
        maxIncumbentErrorRate: 0.2,
        maxFallbackRate: 0.2,
        maxDisagreementRate: 0.5,
        maxP95LatencyRatio: 10,
        maxMeanCandidateConfidenceDelta: 0.2,
      },
    },
  );
};

const response = (
  providerId: string,
  request: DecisionRequest,
  confidence: number,
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
          ? { accept: confidence, reject: 1 - confidence }
          : { accept: 1 - confidence, reject: confidence },
      confidence,
    },
  },
});

const request = (traceId: string): DecisionRequest => ({
  traceId,
  pattern: "gate",
  state: "bounded reversible drift fixture",
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
    decisionSurface: "asset.qa",
    canaryEligible: true,
    reversible: true,
    impactClass: "low",
    riskTags: [],
  },
});

test("drift guard waits for minimum evidence before holding", async () => {
  const active = activationPolicy();
  const policy = driftPolicy(active);
  const killSwitch = new CanaryKillSwitch();
  const guard = new ActiveLimitedDriftGuard({
    policy,
    activationPolicy: active,
    killSwitch,
  });
  const canarySink = new MemoryCanaryEvidenceSink();

  const provider = new CanaryActivationProvider({
    incumbent: new MockSystemOneProvider({
      id: "incumbent",
      responder: (input) => response("incumbent", input, 0.9),
    }),
    candidate: new MockSystemOneProvider({
      id: "candidate",
      responder: (input) => response("candidate", input, 0.4),
    }),
    policy: active,
    killSwitch,
    sink: canarySink,
    traceObserver: (trace) => guard.observe(trace),
  });

  await provider.decide(request("d1"));
  await provider.flush();
  await provider.decide(request("d2"));
  await provider.flush();

  assert.equal(killSwitch.snapshot().killed, false);
  assert.equal(guard.snapshot().held, false);
  assert.equal(guard.snapshot().latestWindow?.status, "blocked");
});

test("confidence drift auto-holds candidate authority and later traffic stays incumbent-only", async () => {
  const active = activationPolicy();
  const policy = driftPolicy(active);
  const killSwitch = new CanaryKillSwitch();
  const holdSink = new MemoryDriftHoldEvidenceSink();
  const guard = new ActiveLimitedDriftGuard({
    policy,
    activationPolicy: active,
    killSwitch,
    holdSink,
    now: () => new Date("2026-10-02T12:00:00.000Z"),
  });
  const canarySink = new MemoryCanaryEvidenceSink();

  const provider = new CanaryActivationProvider({
    incumbent: new MockSystemOneProvider({
      id: "incumbent",
      responder: (input) => response("incumbent", input, 0.9),
    }),
    candidate: new MockSystemOneProvider({
      id: "candidate",
      responder: (input) => response("candidate", input, 0.4),
    }),
    policy: active,
    killSwitch,
    sink: canarySink,
    traceObserver: (trace) => guard.observe(trace),
  });

  for (let index = 1; index <= 3; index += 1) {
    assert.equal(
      (await provider.decide(request(`low-confidence-${index}`))).providerId,
      "candidate",
    );
    await provider.flush();
  }
  await guard.flush();

  assert.equal(killSwitch.snapshot().killed, true);
  assert.equal(killSwitch.snapshot().kind, "auto_hold");
  assert.equal(guard.snapshot().held, true);
  assert.equal(holdSink.events.length, 1);
  assert.equal(holdSink.events[0]?.automaticRollback, false);
  assert.equal(
    holdSink.events[0]?.reasons.some((reason) =>
      reason.startsWith("mean_candidate_confidence_delta"),
    ),
    true,
  );

  const afterHold = await provider.decide(request("after-hold"));
  await provider.flush();

  assert.equal(afterHold.providerId, "incumbent");
  assert.equal(canarySink.records.at(-1)?.fallbackReason, "auto_hold");
  assert.equal(canarySink.records.at(-1)?.candidate.status, "not_run");
});

test("offline drift evaluation flags fallback and error regression without executing rollback", () => {
  const active = activationPolicy();
  const policy = driftPolicy(active);
  const traces = [1, 2, 3].map((index) => ({
    schemaVersion: "mso.canary.v0" as const,
    sessionId: "offline",
    traceId: `offline-${index}`,
    capturedAt: "2026-10-02T00:00:00.000Z",
    policyId: active.policyId,
    decisionSurface: active.decisionSurface,
    stage: "limited_active" as const,
    trafficFraction: 1,
    bucket: 0,
    eligible: true,
    eligibilityReasons: [],
    killSwitchAtStart: { killed: false },
    killSwitchAtReturn: { killed: false },
    circuit: {
      attempts: index,
      errors: index,
      errorRate: 1,
      consecutiveErrors: index,
      tripped: false,
    },
    selectedAuthority: "candidate" as const,
    returnedAuthority: "incumbent" as const,
    candidateInfluencedExecution: false,
    fallbackReason: "candidate_error" as const,
    labelsKnown: false as const,
    request: {
      pattern: "gate" as const,
      questionIds: ["verdict"],
    },
    incumbent: {
      providerId: "incumbent",
      status: "ok" as const,
      wallLatencyMs: 1,
    },
    candidate: {
      providerId: "candidate",
      status: "error" as const,
      wallLatencyMs: 1,
      error: "fault",
    },
    comparableQuestions: 1,
    agreements: 0,
    disagreements: 1,
    agreementRate: 0,
    questions: [
      {
        questionId: "verdict",
        type: "choice" as const,
        comparable: true,
        agreement: false,
        incumbentConfidence: 0.9,
        candidateConfidence: 0.4,
      },
    ],
  }));

  const evidence = evaluateDriftWindow(
    policy,
    active,
    traces,
    new Date("2026-10-02T12:00:00.000Z"),
  );

  assert.equal(evidence.status, "fail");
  assert.equal(evidence.action, "auto_hold");
  assert.equal(evidence.automaticHold, true);
  assert.equal(evidence.automaticRollback, false);
  assert.equal(evidence.summary.candidateErrorRate, 1);
  assert.equal(evidence.summary.fallbackRate, 1);
});

test("drift policy rejects identity mismatch and non-limited activation", () => {
  const active = activationPolicy();
  const basePolicy = driftPolicy(active);

  const other = {
    ...active,
    policyId: "other",
    candidateFingerprint: "c".repeat(64),
  };

  assert.throws(
    () => evaluateDriftWindow(basePolicy, other, []),
    /identity does not match/,
  );

  const canary25 = {
    ...active,
    stage: "canary_25" as const,
    trafficFraction: 0.25,
  };
  assert.throws(
    () =>
      buildActiveLimitedDriftPolicy(
        canary25,
        canary25,
        baselineSummary(canary25.policyId),
        {
          policyId: "bad-stage",
          window: {
            size: 10,
            minCandidateSelected: 5,
            minComparableQuestions: 5,
            minCandidateConfidenceSamples: 5,
          },
          thresholds: {
            maxCandidateErrorRate: 0.1,
            maxIncumbentErrorRate: 0.1,
            maxFallbackRate: 0.1,
            maxDisagreementRate: 0.1,
            maxP95LatencyRatio: 2,
            maxMeanCandidateConfidenceDelta: 0.1,
          },
        },
      ),
    /must use limited_active/,
  );
});
