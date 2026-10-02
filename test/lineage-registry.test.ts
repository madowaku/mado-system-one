import assert from "node:assert/strict";
import test from "node:test";
import type { PromotionGateEvidence } from "../src/promotion/gate.js";
import type { CandidateReevalEvidence } from "../src/reeval/candidate.js";
import type { LayaCheckpointFingerprint } from "../src/reeval/checkpoint.js";
import {
  appendLineageEvent,
  assertPromotionEvidence,
  createCheckpointLineageRegistry,
  deriveLineageState,
  planRollback,
  recordRollback,
  verifyLineageRegistry,
} from "../src/lineage/registry.js";

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

const base = checkpoint("base-v1", "a".repeat(64));
const candidate = checkpoint("candidate-v2", "b".repeat(64));

const reeval = (): CandidateReevalEvidence => ({
  schemaVersion: "mso.reeval.v0",
  reevalId: "reeval-v2",
  createdAt: "2026-10-02T00:00:00.000Z",
  datasetId: "holdout",
  baseProviderId: "laya-base",
  candidateProviderId: "laya-candidate",
  baseCheckpoint: base,
  candidateCheckpoint: candidate,
  providers: {
    base: {
      providerId: "laya-base",
      cases: 10,
      questions: 10,
      accuracy: 0.8,
      caseAccuracy: 0.8,
      providerErrors: 0,
      latencyP50Ms: 10,
      latencyP95Ms: 15,
      totalEstimatedCost: 0,
      confidenceCalibration: {
        questions: 10,
        withConfidence: 10,
        coverage: 1,
        accuracyOnCovered: 0.8,
        meanConfidence: 0.8,
        brier: 0.1,
        ece10: 0.05,
      },
    },
    candidate: {
      providerId: "laya-candidate",
      cases: 10,
      questions: 10,
      accuracy: 0.9,
      caseAccuracy: 0.9,
      providerErrors: 0,
      latencyP50Ms: 11,
      latencyP95Ms: 16,
      totalEstimatedCost: 0,
      confidenceCalibration: {
        questions: 10,
        withConfidence: 10,
        coverage: 1,
        accuracyOnCovered: 0.9,
        meanConfidence: 0.86,
        brier: 0.08,
        ece10: 0.04,
      },
    },
  },
  deltas: {
    candidateVsBase: {
      accuracy: 0.1,
      caseAccuracy: 0.1,
      providerErrors: 0,
      latencyP95Ms: 1,
      ece10: -0.01,
    },
  },
  pairs: [],
  slices: [],
  regressionCount: 0,
  improvementCount: 1,
  hasRegression: false,
  artifacts: {
    summary: "summary.json",
    baseEval: "base.eval.json",
    candidateEval: "candidate.eval.json",
    validationFixture: "validation.eval.jsonl",
    regressions: "regressions.jsonl",
  },
  promotionInput: {
    candidateEval: "candidate.eval.json",
    note: "candidate promotion input",
  },
});

const gate = (): PromotionGateEvidence => ({
  schemaVersion: "mso.promotion-gate.v0",
  gateId: "gate-v2",
  createdAt: "2026-10-02T00:10:00.000Z",
  policyId: "asset-qa-v2",
  candidateProviderId: "laya-candidate",
  decisionSurface: "asset.qa",
  maxEligibleStage: "promoted",
  action: "eligible_for_promotion",
  automaticPromotion: false,
  metrics: {
    offlineCases: 10,
    offlineAccuracy: 0.9,
    offlineProviderErrorRate: 0,
    shadowTraces: 20,
    comparableQuestions: 20,
    shadowAgreementRate: 0.95,
    shadowProviderErrorRate: 0,
    highConfidenceDisagreementQuestions: 0,
    highConfidenceDisagreementRate: 0,
    disagreementQuestions: 1,
    reviewedDisagreements: 1,
    disagreementReviewCoverage: 1,
    reviewedShadowAccuracy: 1,
    p95IncumbentWallLatencyMs: 12,
    p95ShadowWallLatencyMs: 16,
    p95LatencyRatio: 1.333,
    p95ShadowLagMs: 5,
  },
  transitions: [],
  blockingReasons: [],
});

const seededRegistry = () => {
  let registry = createCheckpointLineageRegistry(
    "asset-qa-laya",
    "asset.qa",
    new Date("2026-10-02T00:00:00.000Z"),
  );
  registry = appendLineageEvent(
    registry,
    {
      type: "checkpoint_registered",
      data: {
        checkpointId: "base",
        checkpoint: base,
        origin: "base",
        knownGood: true,
        knownGoodEvidenceRef: "baseline-approval:asset.qa:v1",
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
        checkpointId: "candidate",
        checkpoint: candidate,
        origin: "fine_tune",
        knownGood: false,
        parentCheckpointId: "base",
        fineTunePackRef: "pack-v2",
        reevalEvidenceRef: "reeval/summary.json",
        reevalId: "reeval-v2",
      },
    },
    {
      eventId: "register-candidate",
      now: new Date("2026-10-02T00:02:00.000Z"),
    },
  );
  return registry;
};

test("lineage registry records promotion and restores a known-good ancestor", () => {
  let registry = seededRegistry();
  assertPromotionEvidence(registry, "candidate", gate(), reeval());

  registry = appendLineageEvent(
    registry,
    {
      type: "promotion_recorded",
      data: {
        checkpointId: "candidate",
        gateId: "gate-v2",
        gateEvidenceRef: "promotion/gate-v2.json",
        reevalId: "reeval-v2",
        reevalEvidenceRef: "reeval/summary.json",
        rollbackTargetId: "base",
      },
    },
    {
      eventId: "promote-candidate",
      now: new Date("2026-10-02T00:11:00.000Z"),
    },
  );

  let state = deriveLineageState(registry);
  assert.equal(state.recordedHeadCheckpointId, "candidate");
  assert.equal(state.checkpoints.candidate?.lifecycle, "promoted");
  assert.equal(state.checkpoints.base?.knownGood, true);
  assert.deepEqual(state.checkpoints.base?.childCheckpointIds, ["candidate"]);

  const plan = planRollback(registry, "base", {
    reason: "candidate regression incident",
    planId: "rollback-plan-1",
    now: new Date("2026-10-02T00:12:00.000Z"),
  });
  assert.deepEqual(plan.path, ["candidate", "base"]);
  assert.equal(plan.targetKnownGood, true);
  assert.equal(plan.automaticExecution, false);
  assert.equal(plan.runtimeAuthorityChanged, false);

  registry = recordRollback(
    registry,
    plan,
    "ops-change-123",
    {
      eventId: "record-rollback",
      now: new Date("2026-10-02T00:13:00.000Z"),
    },
  );

  state = deriveLineageState(registry);
  assert.equal(state.recordedHeadCheckpointId, "base");
  assert.equal(state.checkpoints.candidate?.lifecycle, "rolled_back");
  assert.equal(state.checkpoints.base?.lifecycle, "restored");
  assert.equal(state.checkpoints.candidate?.rollbackCount, 1);
  assert.equal(state.checkpoints.base?.promotionCount, 0);
});

test("hash chain detects event tampering", () => {
  const registry = seededRegistry();
  const first = registry.events[0];
  assert.ok(first);
  assert.equal(first.payload.type, "checkpoint_registered");
  if (first.payload.type !== "checkpoint_registered") {
    throw new Error("expected registration event");
  }
  const tampered = {
    ...registry,
    events: [
      {
        ...first,
        payload: {
          type: "checkpoint_registered" as const,
          data: {
            ...first.payload.data,
            knownGood: false,
          },
        },
      },
      ...registry.events.slice(1),
    ],
  };

  assert.throws(
    () => verifyLineageRegistry(tampered),
    /hash mismatch/,
  );
});

test("duplicate checkpoint fingerprint is rejected", () => {
  const registry = seededRegistry();
  assert.throws(
    () =>
      appendLineageEvent(registry, {
        type: "checkpoint_registered",
        data: {
          checkpointId: "duplicate",
          checkpoint: { ...candidate, ref: "same-bytes-new-name" },
          origin: "imported",
          knownGood: false,
        },
      }),
    /fingerprint already registered/,
  );
});

test("promotion requires matching eligible gate and re-eval ancestry", () => {
  const registry = seededRegistry();

  assert.throws(
    () =>
      assertPromotionEvidence(
        registry,
        "candidate",
        {
          ...gate(),
          action: "eligible_for_candidate",
          maxEligibleStage: "candidate",
        },
        reeval(),
      ),
    /not eligible_for_promotion/,
  );

  assert.throws(
    () =>
      assertPromotionEvidence(
        registry,
        "candidate",
        gate(),
        {
          ...reeval(),
          baseCheckpoint: checkpoint("wrong-base", "c".repeat(64)),
        },
      ),
    /base fingerprint does not match/,
  );
});

test("rollback target must be a known-good ancestor", () => {
  let registry = seededRegistry();
  registry = appendLineageEvent(registry, {
    type: "checkpoint_registered",
    data: {
      checkpointId: "other-root",
      checkpoint: checkpoint("other", "d".repeat(64)),
      origin: "imported",
      knownGood: true,
      knownGoodEvidenceRef: "baseline-approval:other-root",
    },
  });
  registry = appendLineageEvent(registry, {
    type: "promotion_recorded",
    data: {
      checkpointId: "candidate",
      gateId: "gate-v2",
      gateEvidenceRef: "promotion/gate-v2.json",
      reevalId: "reeval-v2",
      reevalEvidenceRef: "reeval/summary.json",
      rollbackTargetId: "base",
    },
  });

  assert.throws(
    () =>
      planRollback(registry, "other-root", {
        reason: "invalid cross-tree rollback",
      }),
    /must be an ancestor/,
  );
});

test("rollback plan becomes stale after any registry event", () => {
  let registry = seededRegistry();
  registry = appendLineageEvent(registry, {
    type: "promotion_recorded",
    data: {
      checkpointId: "candidate",
      gateId: "gate-v2",
      gateEvidenceRef: "promotion/gate-v2.json",
      reevalId: "reeval-v2",
      reevalEvidenceRef: "reeval/summary.json",
      rollbackTargetId: "base",
    },
  });
  const plan = planRollback(registry, "base", {
    reason: "incident",
    planId: "stale-plan",
  });

  registry = appendLineageEvent(registry, {
    type: "checkpoint_registered",
    data: {
      checkpointId: "audit-only",
      checkpoint: checkpoint("audit-only", "e".repeat(64)),
      origin: "imported",
      knownGood: false,
    },
  });

  assert.throws(
    () => recordRollback(registry, plan, "ops-change-456"),
    /plan is stale/,
  );
});


test("rollback safety can be attested and later revoked", () => {
  let registry = seededRegistry();
  registry = appendLineageEvent(registry, {
    type: "rollback_safety_set",
    data: {
      checkpointId: "candidate",
      eligible: true,
      evidenceRef: "ops-approval:candidate:v2",
      reason: "shadow and holdout accepted",
    },
  });

  let state = deriveLineageState(registry);
  assert.equal(state.checkpoints.candidate?.knownGood, true);
  assert.equal(
    state.checkpoints.candidate?.knownGoodEvidenceRef,
    "ops-approval:candidate:v2",
  );

  registry = appendLineageEvent(registry, {
    type: "rollback_safety_set",
    data: {
      checkpointId: "candidate",
      eligible: false,
      evidenceRef: "incident:regression-77",
      reason: "rollback target revoked after incident",
    },
  });

  state = deriveLineageState(registry);
  assert.equal(state.checkpoints.candidate?.knownGood, false);
  assert.equal(
    state.checkpoints.candidate?.knownGoodEvidenceRef,
    "incident:regression-77",
  );
});

test("promotion refuses a stale candidate branch once a newer head exists", () => {
  let registry = seededRegistry();
  registry = appendLineageEvent(registry, {
    type: "promotion_recorded",
    data: {
      checkpointId: "candidate",
      gateId: "gate-v2",
      gateEvidenceRef: "promotion/gate-v2.json",
      reevalId: "reeval-v2",
      reevalEvidenceRef: "reeval/summary.json",
      rollbackTargetId: "base",
    },
  });

  registry = appendLineageEvent(registry, {
    type: "checkpoint_registered",
    data: {
      checkpointId: "stale-sibling",
      checkpoint: checkpoint("stale-sibling", "f".repeat(64)),
      origin: "fine_tune",
      knownGood: false,
      parentCheckpointId: "base",
      reevalEvidenceRef: "reeval/stale.json",
      reevalId: "reeval-stale",
    },
  });

  assert.throws(
    () =>
      appendLineageEvent(registry, {
        type: "promotion_recorded",
        data: {
          checkpointId: "stale-sibling",
          gateId: "gate-stale",
          gateEvidenceRef: "promotion/gate-stale.json",
          reevalId: "reeval-stale",
          reevalEvidenceRef: "reeval/stale.json",
          rollbackTargetId: "base",
        },
      }),
    /does not match recorded head/,
  );
});

test("rollback source assertion must match recorded head", () => {
  let registry = seededRegistry();
  registry = appendLineageEvent(registry, {
    type: "promotion_recorded",
    data: {
      checkpointId: "candidate",
      gateId: "gate-v2",
      gateEvidenceRef: "promotion/gate-v2.json",
      reevalId: "reeval-v2",
      reevalEvidenceRef: "reeval/summary.json",
      rollbackTargetId: "base",
    },
  });

  assert.throws(
    () =>
      planRollback(registry, "base", {
        fromCheckpointId: "base",
        reason: "wrong operator assumption",
      }),
    /does not match recorded head/,
  );
});
