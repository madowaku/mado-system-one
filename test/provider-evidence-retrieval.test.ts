import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SystemOnePattern } from "../src/core/types.js";
import type { PromotionReviewRecord } from "../src/promotion/gate.js";
import type { MultiShadowSessionRecord } from "../src/shadow/multi.js";
import {
  createProviderEvidenceLedger,
  ingestMultiShadowSessions,
  ingestProviderReviews,
} from "../src/evidence/provider-ledger.js";
import {
  buildProviderSuitabilityContextPack,
} from "../src/evidence/provider-retrieval.js";
import {
  parseProviderSuitabilityContextPack,
  readProviderSuitabilityContextPack,
  writeProviderSuitabilityContextPack,
} from "../src/evidence/provider-retrieval-io.js";

const session = (
  traceId: string,
  pattern: SystemOnePattern,
  taskFamily: string,
  clefAgreement: boolean,
): MultiShadowSessionRecord => {
  const capturedAt =
    traceId === "live:gate:1"
      ? "2026-10-03T14:40:00.000Z"
      : "2026-10-03T14:45:00.000Z";
  const incumbent = {
    providerId: "incumbent",
    status: "ok" as const,
    modelId: "incumbent-model",
    wallLatencyMs: 10,
    responseLatencyMs: 9,
    estimatedCost: 0.01,
  };
  const laya = {
    providerId: "laya",
    status: "ok" as const,
    modelId: "laya-model",
    wallLatencyMs: 5,
    responseLatencyMs: 4,
    estimatedCost: 0,
  };
  const clef = {
    providerId: "clef-flash",
    status: "ok" as const,
    modelId: "clef-flash",
    wallLatencyMs: 20,
    responseLatencyMs: 18,
    estimatedCost: 0.001,
  };

  const makePair = (
    providerId: "laya" | "clef-flash",
    shadow: typeof laya | typeof clef,
    agreement: boolean,
    confidence: number,
  ) => ({
    schemaVersion: "mso.shadow.v0" as const,
    traceId,
    capturedAt,
    mode: "shadow" as const,
    authoritativeProviderId: "incumbent",
    shadowProviderId: providerId,
    shadowInfluencedExecution: false as const,
    labelsKnown: false as const,
    incumbent,
    shadow,
    comparableQuestions: 1,
    agreements: agreement ? 1 : 0,
    disagreements: agreement ? 0 : 1,
    agreementRate: agreement ? 1 : 0,
    shadowLagAfterIncumbentMs: providerId === "laya" ? 0 : 8,
    review: agreement
      ? {
          needed: false,
          reasons: [],
          candidateUse: "none" as const,
        }
      : {
          needed: true,
          reasons: ["disagreement" as const],
          candidateUse: "human_label_required" as const,
        },
    questions: [
      {
        questionId: "verdict",
        type: "choice" as const,
        comparable: true,
        agreement,
        incumbent: {
          status: "ok" as const,
          answer: "accept",
          confidence: 0.9,
        },
        shadow: {
          status: "ok" as const,
          answer: agreement ? "accept" : "reject",
          confidence,
        },
      },
    ],
  });

  const layaPair = makePair("laya", laya, true, 0.8);
  const clefPair = makePair("clef-flash", clef, clefAgreement, 0.85);
  const reviewItems = [layaPair, clefPair]
    .filter((pair) => pair.review.needed)
    .map((pair) => ({
      shadowProviderId: pair.shadowProviderId,
      reasons: pair.review.reasons,
      candidateUse: pair.review.candidateUse,
    }));

  return {
    schemaVersion: "mso.multi-shadow.v0",
    sessionId: `multi-shadow:${traceId}`,
    traceId,
    capturedAt,
    mode: "multi_shadow",
    authoritativeProviderId: "incumbent",
    shadowProviderIds: ["laya", "clef-flash"],
    shadowInfluencedExecution: false,
    labelsKnown: false,
    request: {
      traceId,
      pattern,
      questionIds: ["verdict"],
      state: "sensitive raw state that must not enter context pack",
      metadata: { taskFamily },
    },
    incumbent,
    shadows: {
      laya,
      "clef-flash": clef,
    },
    pairTraces: [layaPair, clefPair],
    summary: {
      shadowProviders: 2,
      successfulShadows: 2,
      failedShadows: 0,
      comparableQuestions: 2,
      agreements: 1 + (clefAgreement ? 1 : 0),
      disagreements: clefAgreement ? 0 : 1,
      providersNeedingReview: reviewItems.length,
    },
    review: {
      needed: reviewItems.length > 0,
      providerIds: reviewItems.map((item) => item.shadowProviderId),
      items: reviewItems,
    },
  };
};

const review: PromotionReviewRecord = {
  schemaVersion: "mso.review.v0",
  traceId: "live:gate:1",
  questionId: "verdict",
  shadowProviderId: "clef-flash",
  label: "shadow_correct",
  source: "human",
  reviewedAt: "2026-10-03T14:50:00.000Z",
  reviewer: "operator",
};

const ledgerFixture = () => {
  let ledger = createProviderEvidenceLedger(
    "asset-qa-provider-memory",
    "asset.qa",
    new Date("2026-10-03T14:30:00.000Z"),
  );
  ledger = ingestMultiShadowSessions(
    ledger,
    [session("live:gate:1", "gate", "asset.qa", false)],
    {
      sourceRef: "multi-shadow:asset-qa:batch-001",
      eventId: "sessions-001",
      now: new Date("2026-10-03T14:41:00.000Z"),
    },
  );
  ledger = ingestMultiShadowSessions(
    ledger,
    [session("live:route:1", "route", "billing", true)],
    {
      sourceRef: "multi-shadow:billing:batch-002",
      eventId: "sessions-002",
      now: new Date("2026-10-03T14:46:00.000Z"),
    },
  );
  ledger = ingestProviderReviews(ledger, [review], {
    sourceRef: "human-review:asset-qa:001",
    eventId: "reviews-001",
    now: new Date("2026-10-03T14:51:00.000Z"),
  });
  return ledger;
};

test("suitability context retrieves exact evidence without ranking providers", () => {
  const ledger = ledgerFixture();
  const pack = buildProviderSuitabilityContextPack(ledger, {
    pattern: "gate",
    taskFamily: "asset.qa",
    providerIds: ["laya", "clef-flash"],
    maxRecentWindowsPerProvider: 1,
    maxDisagreementClustersPerProvider: 2,
    packId: "asset-qa-gate-context",
    now: new Date("2026-10-03T14:55:00.000Z"),
  });

  assert.equal(pack.schemaVersion, "mso.provider-suitability-context.v0");
  assert.equal(pack.packId, "asset-qa-gate-context");
  assert.equal(pack.ledgerHeadEventHash, ledger.events.at(-1)?.eventHash);
  assert.equal(pack.evidenceOnly, true);
  assert.equal(pack.automaticProviderRanking, false);
  assert.equal(pack.automaticRoutingDecision, false);
  assert.equal(pack.runtimeAuthorityManaged, false);
  assert.equal(pack.requiresPolicyDecision, true);
  assert.equal(pack.providerOrder, "lexicographic");
  assert.deepEqual(
    pack.providers.map((item) => item.providerId),
    ["clef-flash", "laya"],
  );

  const clef = pack.providers.find((item) => item.providerId === "clef-flash");
  assert.ok(clef);
  assert.equal(clef.matchScope, "pattern_and_task_family");
  assert.equal(clef.evidenceStatus, "observed_reviewed");
  assert.equal(clef.exactContext.metrics.observations, 1);
  assert.equal(clef.exactContext.metrics.disagreements, 1);
  assert.equal(clef.exactContext.metrics.reviewedQuestions, 1);
  assert.equal(clef.exactContext.metrics.reviewedAccuracy, 1);
  assert.equal(clef.reviewedQuestionCoverage, 1);
  assert.equal(clef.patternContext.metrics.observations, 1);
  assert.equal(clef.taskFamilyContext?.metrics.observations, 1);
  assert.equal(clef.overallContext.metrics.observations, 2);
  assert.equal(clef.recentWindows.length, 1);
  assert.equal(clef.disagreementClusters.length, 1);
  assert.equal(clef.disagreementClusters[0]?.questionId, "verdict");
  assert.equal(clef.disagreementClusters[0]?.shadowCorrect, 1);
  assert.deepEqual(clef.sourceRefs, [
    "human-review:asset-qa:001",
    "multi-shadow:asset-qa:batch-001",
  ]);

  const laya = pack.providers.find((item) => item.providerId === "laya");
  assert.ok(laya);
  assert.equal(laya.evidenceStatus, "observed_unreviewed");
  assert.equal(laya.exactContext.metrics.agreements, 1);

  assert.doesNotMatch(
    JSON.stringify(pack),
    /sensitive raw state that must not enter context pack/,
  );
});

test("explicit unknown provider is retained as no evidence instead of being guessed away", () => {
  const pack = buildProviderSuitabilityContextPack(ledgerFixture(), {
    pattern: "gate",
    taskFamily: "asset.qa",
    providerIds: ["future-provider"],
  });

  assert.equal(pack.providers.length, 1);
  assert.equal(pack.providers[0]?.providerId, "future-provider");
  assert.equal(pack.providers[0]?.matchScope, "no_evidence");
  assert.equal(pack.providers[0]?.evidenceStatus, "no_matching_evidence");
  assert.equal(pack.providers[0]?.exactContext.metrics.observations, 0);
  assert.deepEqual(pack.providers[0]?.sourceRefs, []);
  assert.deepEqual(pack.omittedProviderIds, [
    "clef-flash",
    "incumbent",
    "laya",
  ]);
});

test("provider bound refuses implicit truncation instead of creating a hidden ranking", () => {
  assert.throws(
    () =>
      buildProviderSuitabilityContextPack(ledgerFixture(), {
        pattern: "gate",
        maxProviders: 2,
      }),
    /pass providerIds explicitly to avoid implicit truncation or ranking/,
  );
});

test("task-family miss falls back descriptively without inventing exact evidence", () => {
  const pack = buildProviderSuitabilityContextPack(ledgerFixture(), {
    pattern: "gate",
    taskFamily: "unseen.family",
    providerIds: ["clef-flash"],
  });

  const clef = pack.providers[0];
  assert.ok(clef);
  assert.equal(clef.exactContext.metrics.observations, 0);
  assert.equal(clef.patternContext.metrics.observations, 1);
  assert.equal(clef.taskFamilyContext?.metrics.observations, 0);
  assert.equal(clef.matchScope, "pattern_only");
  assert.equal(clef.evidenceStatus, "no_matching_evidence");
});

test("context pack IO preserves evidence-only invariants", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mso-provider-context-"));
  try {
    const path = join(dir, "context.json");
    const pack = buildProviderSuitabilityContextPack(ledgerFixture(), {
      pattern: "gate",
      taskFamily: "asset.qa",
      providerIds: ["clef-flash"],
      packId: "io-pack",
    });
    await writeProviderSuitabilityContextPack(path, pack);
    const loaded = await readProviderSuitabilityContextPack(path);
    assert.equal(loaded.packId, "io-pack");
    assert.equal(loaded.automaticProviderRanking, false);

    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    raw.automaticRoutingDecision = true;
    assert.throws(
      () => parseProviderSuitabilityContextPack(raw),
      /violates evidence-only authority invariants/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
