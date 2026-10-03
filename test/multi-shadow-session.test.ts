import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  DecisionRequest,
  DecisionResponse,
} from "../src/core/types.js";
import { MockSystemOneProvider } from "../src/providers/mock.js";
import {
  extractShadowTracesForProvider,
  MemoryMultiShadowEvidenceSink,
  MultiShadowSession,
  parseMultiShadowSessionJsonl,
  PartitionedMultiShadowEvidenceSink,
  writeExtractedShadowTraces,
} from "../src/shadow/multi.js";

const request: DecisionRequest = {
  traceId: "live:multi:001",
  pattern: "gate",
  state: "Generated icon is centered and fully inside the frame.",
  questions: {
    verdict: {
      type: "choice",
      prompt: "Choose verdict.",
      options: [
        { id: "accept", label: "Accept" },
        { id: "reject", label: "Reject" },
      ],
    },
  },
  metadata: {
    source: "multi-shadow-test",
  },
};

const response = (
  providerId: string,
  selected: "accept" | "reject",
  confidence: number,
): DecisionResponse => ({
  traceId: request.traceId,
  providerId,
  modelId: `${providerId}-model`,
  probabilitySemantics: "direct_logits",
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
  estimatedCost: 0,
});

const withTimeout = async <T>(promise: Promise<T>, ms = 200): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("timed out waiting for incumbent")), ms);
    }),
  ]);

test("multi-shadow returns incumbent once, does not wait for shadows, and writes one shared session", async () => {
  let incumbentCalls = 0;
  let releaseA: ((value: DecisionResponse) => void) | undefined;
  let releaseB: ((value: DecisionResponse) => void) | undefined;

  const pendingA = new Promise<DecisionResponse>((resolve) => {
    releaseA = resolve;
  });
  const pendingB = new Promise<DecisionResponse>((resolve) => {
    releaseB = resolve;
  });

  const incumbent = new MockSystemOneProvider({
    id: "incumbent",
    responder: () => {
      incumbentCalls += 1;
      return response("incumbent", "accept", 0.9);
    },
  });
  const shadowA = new MockSystemOneProvider({
    id: "laya",
    responder: async () => pendingA,
  });
  const shadowB = new MockSystemOneProvider({
    id: "clef-flash",
    responder: async () => pendingB,
  });
  const sink = new MemoryMultiShadowEvidenceSink();
  const multi = new MultiShadowSession({
    incumbent,
    shadows: [shadowA, shadowB],
    sink,
    capture: "full",
  });

  const returned = await withTimeout(multi.decide(request));
  assert.equal(returned.providerId, "incumbent");
  assert.equal(incumbentCalls, 1);
  assert.equal(sink.records.length, 0);

  assert.ok(releaseA);
  assert.ok(releaseB);
  releaseA(response("laya", "accept", 0.8));
  releaseB(response("clef-flash", "reject", 0.85));
  await multi.flush();

  assert.equal(incumbentCalls, 1);
  assert.equal(sink.records.length, 1);
  const session = sink.records[0];
  assert.ok(session);
  assert.equal(session.schemaVersion, "mso.multi-shadow.v0");
  assert.equal(session.authoritativeProviderId, "incumbent");
  assert.deepEqual(session.shadowProviderIds, ["laya", "clef-flash"]);
  assert.equal(session.shadowInfluencedExecution, false);
  assert.equal(session.labelsKnown, false);
  assert.equal(session.request?.state, request.state);
  assert.equal(session.summary.shadowProviders, 2);
  assert.equal(session.summary.successfulShadows, 2);
  assert.equal(session.summary.failedShadows, 0);
  assert.equal(session.summary.disagreements, 1);
  assert.equal(session.summary.providersNeedingReview, 1);
  assert.deepEqual(session.review.providerIds, ["clef-flash"]);
  assert.equal(session.pairTraces.length, 2);

  const laya = session.pairTraces.find(
    (trace) => trace.shadowProviderId === "laya",
  );
  const clef = session.pairTraces.find(
    (trace) => trace.shadowProviderId === "clef-flash",
  );
  assert.ok(laya);
  assert.ok(clef);
  assert.equal(laya.review.needed, false);
  assert.equal(clef.review.needed, true);
  assert.deepEqual(clef.review.reasons, ["disagreement"]);
});

test("one shadow failure stays observational and shares one review item", async () => {
  const incumbent = new MockSystemOneProvider({
    id: "incumbent",
    responder: response("incumbent", "accept", 0.9),
  });
  const good = new MockSystemOneProvider({
    id: "laya",
    responder: response("laya", "accept", 0.8),
  });
  const broken = new MockSystemOneProvider({
    id: "clef",
    responder: async () => {
      throw new Error("hosted provider unavailable");
    },
  });
  const sink = new MemoryMultiShadowEvidenceSink();
  const multi = new MultiShadowSession({
    incumbent,
    shadows: [good, broken],
    sink,
  });

  const returned = await multi.decide(request);
  assert.equal(returned.providerId, "incumbent");
  await multi.flush();

  const session = sink.records[0];
  assert.ok(session);
  assert.equal(session.summary.successfulShadows, 1);
  assert.equal(session.summary.failedShadows, 1);
  assert.deepEqual(session.review.providerIds, ["clef"]);
  assert.deepEqual(session.review.items[0]?.reasons, [
    "shadow_provider_error",
  ]);
  assert.equal(session.shadows.clef?.status, "error");
  assert.match(session.shadows.clef?.error ?? "", /hosted provider unavailable/);
});

test("incumbent failure is not rescued by shadows but still produces shared evidence", async () => {
  const incumbent = new MockSystemOneProvider({
    id: "incumbent",
    responder: async () => {
      throw new Error("authoritative path failed");
    },
  });
  const shadowA = new MockSystemOneProvider({
    id: "laya",
    responder: response("laya", "accept", 0.8),
  });
  const shadowB = new MockSystemOneProvider({
    id: "clef-flash",
    responder: response("clef-flash", "accept", 0.85),
  });
  const sink = new MemoryMultiShadowEvidenceSink();
  const multi = new MultiShadowSession({
    incumbent,
    shadows: [shadowA, shadowB],
    sink,
  });

  await assert.rejects(() => multi.decide(request), /authoritative path failed/);
  await multi.flush();

  const session = sink.records[0];
  assert.ok(session);
  assert.equal(session.incumbent.status, "error");
  assert.equal(session.review.needed, true);
  assert.deepEqual(session.review.providerIds, ["laya", "clef-flash"]);
  for (const pair of session.pairTraces) {
    assert.deepEqual(pair.review.reasons, ["incumbent_provider_error"]);
    assert.equal(pair.shadowInfluencedExecution, false);
  }
});

test("partitioned sink writes one shared review record instead of one row per candidate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mso-multi-shadow-"));
  try {
    const sessionPath = join(dir, "sessions.jsonl");
    const reviewPath = join(dir, "review.jsonl");
    const sink = new PartitionedMultiShadowEvidenceSink({
      sessionPath,
      reviewQueuePath: reviewPath,
    });

    const multi = new MultiShadowSession({
      incumbent: new MockSystemOneProvider({
        id: "incumbent",
        responder: response("incumbent", "accept", 0.9),
      }),
      shadows: [
        new MockSystemOneProvider({
          id: "laya",
          responder: response("laya", "reject", 0.8),
        }),
        new MockSystemOneProvider({
          id: "clef-flash",
          responder: response("clef-flash", "reject", 0.85),
        }),
      ],
      sink,
    });

    await multi.decide(request);
    await multi.flush();

    const sessions = (await readFile(sessionPath, "utf8")).trim().split("\n");
    const reviews = (await readFile(reviewPath, "utf8")).trim().split("\n");
    assert.equal(sessions.length, 1);
    assert.equal(reviews.length, 1);

    const parsed = parseMultiShadowSessionJsonl(await readFile(reviewPath, "utf8"));
    assert.equal(parsed.length, 1);
    assert.deepEqual(parsed[0]?.review.providerIds, ["laya", "clef-flash"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("candidate-specific extraction materializes legacy mso.shadow.v0 traces for Promotion Gate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mso-multi-extract-"));
  try {
    const sink = new MemoryMultiShadowEvidenceSink();
    const multi = new MultiShadowSession({
      incumbent: new MockSystemOneProvider({
        id: "incumbent",
        responder: response("incumbent", "accept", 0.9),
      }),
      shadows: [
        new MockSystemOneProvider({
          id: "laya",
          responder: response("laya", "accept", 0.8),
        }),
        new MockSystemOneProvider({
          id: "clef-flash",
          responder: response("clef-flash", "reject", 0.85),
        }),
      ],
      sink,
    });

    await multi.decide(request);
    await multi.flush();

    const traces = extractShadowTracesForProvider(
      sink.records,
      "clef-flash",
    );
    assert.equal(traces.length, 1);
    assert.equal(traces[0]?.schemaVersion, "mso.shadow.v0");
    assert.equal(traces[0]?.shadowProviderId, "clef-flash");
    assert.equal(traces[0]?.traceId, request.traceId);

    const path = join(dir, "clef-flash.shadow.jsonl");
    await writeExtractedShadowTraces(path, traces);
    const line = JSON.parse((await readFile(path, "utf8")).trim()) as {
      schemaVersion: string;
      shadowProviderId: string;
    };
    assert.equal(line.schemaVersion, "mso.shadow.v0");
    assert.equal(line.shadowProviderId, "clef-flash");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("multi-shadow rejects duplicate provider identities", () => {
  const incumbent = new MockSystemOneProvider({
    id: "same",
    responder: response("same", "accept", 0.9),
  });
  const same = new MockSystemOneProvider({
    id: "same",
    responder: response("same", "accept", 0.8),
  });
  const other = new MockSystemOneProvider({
    id: "other",
    responder: response("other", "accept", 0.8),
  });

  assert.throws(
    () =>
      new MultiShadowSession({
        incumbent,
        shadows: [same, other],
        sink: new MemoryMultiShadowEvidenceSink(),
      }),
    /provider ids must be unique/,
  );
});
