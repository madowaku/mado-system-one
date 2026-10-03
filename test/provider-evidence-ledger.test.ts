import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PromotionReviewRecord } from "../src/promotion/gate.js";
import type { MultiShadowSessionRecord } from "../src/shadow/multi.js";
import {
  createProviderEvidenceLedger,
  deriveProviderEvidenceState,
  ingestMultiShadowSessions,
  ingestProviderReviews,
  verifyProviderEvidenceLedger,
} from "../src/evidence/provider-ledger.js";
import {
  createProviderEvidenceLedgerFile,
  mutateProviderEvidenceLedger,
  readProviderEvidenceLedger,
  writeDerivedProviderEvidenceSnapshot,
} from "../src/evidence/provider-ledger-io.js";

const session = (
  traceId: string,
  capturedAt: string,
  options: {
    clefAgreement: boolean;
    layaError?: string;
  },
): MultiShadowSessionRecord => {
  const incumbent = {
    providerId: "incumbent",
    status: "ok" as const,
    modelId: "incumbent-model",
    wallLatencyMs: traceId.endsWith("1") ? 10 : 12,
    responseLatencyMs: traceId.endsWith("1") ? 9 : 11,
    estimatedCost: 0.01,
  };
  const laya = options.layaError
    ? {
        providerId: "laya",
        status: "error" as const,
        wallLatencyMs: 5,
        error: options.layaError,
      }
    : {
        providerId: "laya",
        status: "ok" as const,
        modelId: "laya-model",
        wallLatencyMs: 4,
        responseLatencyMs: 3,
        estimatedCost: 0,
      };
  const clef = {
    providerId: "clef-flash",
    status: "ok" as const,
    modelId: "clef-flash",
    wallLatencyMs: traceId.endsWith("1") ? 20 : 18,
    responseLatencyMs: traceId.endsWith("1") ? 19 : 17,
    estimatedCost: 0.001,
  };

  const layaPair = {
    schemaVersion: "mso.shadow.v0" as const,
    traceId,
    capturedAt,
    mode: "shadow" as const,
    authoritativeProviderId: "incumbent",
    shadowProviderId: "laya",
    shadowInfluencedExecution: false as const,
    labelsKnown: false as const,
    incumbent,
    shadow: laya,
    comparableQuestions: options.layaError ? 0 : 1,
    agreements: options.layaError ? 0 : 1,
    disagreements: 0,
    agreementRate: options.layaError ? 0 : 1,
    shadowLagAfterIncumbentMs: 0,
    review: options.layaError
      ? {
          needed: true,
          reasons: ["shadow_provider_error" as const],
          candidateUse: "provider_error_review" as const,
        }
      : {
          needed: false,
          reasons: [],
          candidateUse: "none" as const,
        },
    questions: [
      {
        questionId: "verdict",
        type: "choice" as const,
        comparable: !options.layaError,
        ...(!options.layaError ? { agreement: true } : {}),
        incumbent: {
          status: "ok" as const,
          answer: "accept",
          confidence: traceId.endsWith("1") ? 0.9 : 0.88,
        },
        shadow: options.layaError
          ? {
              status: "error" as const,
              error: options.layaError,
            }
          : {
              status: "ok" as const,
              answer: "accept",
              confidence: 0.8,
            },
      },
    ],
  };

  const clefPair = {
    schemaVersion: "mso.shadow.v0" as const,
    traceId,
    capturedAt,
    mode: "shadow" as const,
    authoritativeProviderId: "incumbent",
    shadowProviderId: "clef-flash",
    shadowInfluencedExecution: false as const,
    labelsKnown: false as const,
    incumbent,
    shadow: clef,
    comparableQuestions: 1,
    agreements: options.clefAgreement ? 1 : 0,
    disagreements: options.clefAgreement ? 0 : 1,
    agreementRate: options.clefAgreement ? 1 : 0,
    shadowLagAfterIncumbentMs: 8,
    review: options.clefAgreement
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
        agreement: options.clefAgreement,
        incumbent: {
          status: "ok" as const,
          answer: "accept",
          confidence: traceId.endsWith("1") ? 0.9 : 0.88,
        },
        shadow: {
          status: "ok" as const,
          answer: options.clefAgreement ? "accept" : "reject",
          confidence: traceId.endsWith("1") ? 0.85 : 0.75,
        },
      },
    ],
  };

  const pairTraces = [layaPair, clefPair];
  const reviewItems = pairTraces
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
      pattern: "gate",
      questionIds: ["verdict"],
      state: "[redacted]",
      metadata: {
        taskFamily: "asset.qa",
      },
    },
    incumbent,
    shadows: {
      laya,
      "clef-flash": clef,
    },
    pairTraces,
    summary: {
      shadowProviders: 2,
      successfulShadows: options.layaError ? 1 : 2,
      failedShadows: options.layaError ? 1 : 0,
      comparableQuestions: (options.layaError ? 0 : 1) + 1,
      agreements: (options.layaError ? 0 : 1) + (options.clefAgreement ? 1 : 0),
      disagreements: options.clefAgreement ? 0 : 1,
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
  traceId: "live:1",
  questionId: "verdict",
  shadowProviderId: "clef-flash",
  label: "shadow_correct",
  source: "human",
  reviewedAt: "2026-10-03T14:40:00.000Z",
  reviewer: "operator",
};

test("provider evidence ledger derives longitudinal provider memory without routing authority", () => {
  let ledger = createProviderEvidenceLedger(
    "asset-qa-provider-memory",
    "asset.qa",
    new Date("2026-10-03T14:30:00.000Z"),
  );

  ledger = ingestMultiShadowSessions(
    ledger,
    [
      session("live:1", "2026-10-03T14:31:00.000Z", {
        clefAgreement: false,
      }),
    ],
    {
      sourceRef: "evidence/multi-shadow/batch-001.jsonl",
      eventId: "sessions-001",
      now: new Date("2026-10-03T14:32:00.000Z"),
    },
  );

  ledger = ingestMultiShadowSessions(
    ledger,
    [
      session("live:2", "2026-10-03T14:33:00.000Z", {
        clefAgreement: true,
        layaError: "checkpoint unavailable",
      }),
    ],
    {
      sourceRef: "evidence/multi-shadow/batch-002.jsonl",
      eventId: "sessions-002",
      now: new Date("2026-10-03T14:34:00.000Z"),
    },
  );

  ledger = ingestProviderReviews(ledger, [review], {
    sourceRef: "evidence/reviews/review-001.jsonl",
    eventId: "reviews-001",
    now: new Date("2026-10-03T14:41:00.000Z"),
  });

  const state = deriveProviderEvidenceState(ledger);
  assert.equal(state.runtimeAuthorityManaged, false);
  assert.equal(state.automaticRoutingDecision, false);
  assert.equal(state.sessionCount, 2);
  assert.equal(state.reviewCount, 1);
  assert.equal(state.eventCount, 3);

  const clef = state.providers["clef-flash"];
  assert.ok(clef);
  assert.equal(clef.metrics.observations, 2);
  assert.equal(clef.metrics.shadowObservations, 2);
  assert.equal(clef.metrics.errors, 0);
  assert.equal(clef.metrics.comparableQuestions, 2);
  assert.equal(clef.metrics.agreements, 1);
  assert.equal(clef.metrics.disagreements, 1);
  assert.equal(clef.metrics.agreementRate, 0.5);
  assert.equal(clef.metrics.costSamples, 2);
  assert.equal(clef.metrics.totalEstimatedCost, 0.002);
  assert.equal(clef.metrics.reviewedQuestions, 1);
  assert.equal(clef.metrics.reviewedCorrect, 1);
  assert.equal(clef.metrics.reviewedAccuracy, 1);
  assert.equal(clef.byPattern[0]?.pattern, "gate");
  assert.equal(clef.byTaskFamily[0]?.taskFamily, "asset.qa");
  assert.equal(clef.timeline.length, 2);

  const cluster = clef.disagreementClusters.find(
    (item) => item.questionId === "verdict",
  );
  assert.ok(cluster);
  assert.equal(cluster.observations, 2);
  assert.equal(cluster.disagreements, 1);
  assert.equal(cluster.reviewedQuestions, 1);
  assert.equal(cluster.shadowCorrect, 1);

  const laya = state.providers.laya;
  assert.ok(laya);
  assert.equal(laya.metrics.observations, 2);
  assert.equal(laya.metrics.errors, 1);
  assert.equal(laya.metrics.errorRate, 0.5);

  const incumbent = state.providers.incumbent;
  assert.ok(incumbent);
  assert.equal(incumbent.metrics.observations, 2);
  assert.equal(incumbent.metrics.incumbentObservations, 2);
  assert.equal(incumbent.metrics.confidenceSamples, 2);
  assert.equal(incumbent.metrics.reviewNeededObservations, 0);
});

test("ledger rejects duplicate session ingestion and orphan reviews", () => {
  const base = createProviderEvidenceLedger("ledger", "asset.qa");
  const first = ingestMultiShadowSessions(
    base,
    [
      session("live:1", "2026-10-03T14:31:00.000Z", {
        clefAgreement: false,
      }),
    ],
    { sourceRef: "batch-1" },
  );

  assert.throws(
    () =>
      ingestMultiShadowSessions(
        first,
        [
          session("live:1", "2026-10-03T14:31:00.000Z", {
            clefAgreement: false,
          }),
        ],
        { sourceRef: "batch-1-again" },
      ),
    /already ingested/,
  );

  assert.throws(
    () =>
      ingestProviderReviews(
        first,
        [
          {
            ...review,
            traceId: "missing-trace",
          },
        ],
        { sourceRef: "orphan-review" },
      ),
    /no matching shadow observation/,
  );
});

test("hash chain detects historical tampering", () => {
  const base = createProviderEvidenceLedger("ledger", "asset.qa");
  const ledger = ingestMultiShadowSessions(
    base,
    [
      session("live:1", "2026-10-03T14:31:00.000Z", {
        clefAgreement: false,
      }),
    ],
    { sourceRef: "batch-1", eventId: "sessions-1" },
  );

  const tampered = structuredClone(ledger);
  const event = tampered.events[0];
  assert.ok(event);
  if (event.payload.type === "sessions_ingested") {
    const observation = event.payload.data.observations[0];
    assert.ok(observation);
    (observation as { wallLatencyMs: number }).wallLatencyMs = 999;
  }

  assert.throws(
    () => verifyProviderEvidenceLedger(tampered),
    /hash mismatch/,
  );
});

test("provider evidence ledger file IO is atomic, locked, and snapshot-ready", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mso-provider-ledger-"));
  try {
    const path = join(dir, "ledger.json");
    const snapshotPath = join(dir, "snapshot.json");
    const ledger = createProviderEvidenceLedger("ledger-io", "asset.qa");
    await createProviderEvidenceLedgerFile(path, ledger);

    await mutateProviderEvidenceLedger(path, (current) =>
      ingestMultiShadowSessions(
        current,
        [
          session("live:1", "2026-10-03T14:31:00.000Z", {
            clefAgreement: false,
          }),
        ],
        { sourceRef: "batch-1" },
      ),
    );

    const loaded = await readProviderEvidenceLedger(path);
    assert.equal(loaded.events.length, 1);
    await writeDerivedProviderEvidenceSnapshot(snapshotPath, loaded);

    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as {
      providers: Record<string, unknown>;
      automaticRoutingDecision: boolean;
    };
    assert.ok(snapshot.providers["clef-flash"]);
    assert.equal(snapshot.automaticRoutingDecision, false);

    await writeFile(`${path}.lock`, "held", "utf8");
    await assert.rejects(
      () => mutateProviderEvidenceLedger(path, (current) => current),
      /locked by another writer/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
