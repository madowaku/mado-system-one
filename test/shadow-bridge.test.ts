import assert from "node:assert/strict";
import test from "node:test";
import type {
  DecisionRequest,
  DecisionResponse,
} from "../src/core/types.js";
import { MockSystemOneProvider } from "../src/providers/mock.js";
import {
  MemoryShadowEvidenceSink,
  ShadowBridge,
} from "../src/shadow/bridge.js";

const request: DecisionRequest = {
  traceId: "live:asset:001",
  pattern: "gate",
  state: "Generated icon has clean edges and no clipping.",
  questions: {
    verdict: {
      type: "choice",
      prompt: "Choose the asset verdict.",
      options: [
        { id: "accept", label: "Accept" },
        { id: "reject", label: "Reject" },
      ],
    },
  },
  metadata: {
    source: "mado-asset-foundry",
  },
};

const choiceResponse = (
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

test("shadow work never blocks or changes the incumbent response", async () => {
  let releaseShadow: ((value: DecisionResponse) => void) | undefined;
  const shadowPending = new Promise<DecisionResponse>((resolve) => {
    releaseShadow = resolve;
  });

  const incumbent = new MockSystemOneProvider({
    id: "incumbent",
    responder: choiceResponse("incumbent", "accept", 0.9),
  });
  const shadow = new MockSystemOneProvider({
    id: "laya",
    responder: async () => shadowPending,
  });
  const sink = new MemoryShadowEvidenceSink();
  const bridge = new ShadowBridge({
    incumbent,
    shadow,
    sink,
    capture: "full",
  });

  const returned = await withTimeout(bridge.decide(request));
  assert.equal(returned.providerId, "incumbent");
  assert.equal(
    (returned.results.verdict as { selected?: string }).selected,
    "accept",
  );
  assert.equal(sink.records.length, 0);

  assert.ok(releaseShadow);
  releaseShadow(choiceResponse("laya", "reject", 0.88));
  await bridge.flush();

  assert.equal(sink.records.length, 1);
  const trace = sink.records[0];
  assert.ok(trace);
  assert.equal(trace.authoritativeProviderId, "incumbent");
  assert.equal(trace.shadowProviderId, "laya");
  assert.equal(trace.shadowInfluencedExecution, false);
  assert.equal(trace.labelsKnown, false);
  assert.equal(trace.disagreements, 1);
  assert.equal(trace.review.needed, true);
  assert.deepEqual(trace.review.reasons, ["disagreement"]);
  assert.equal(trace.review.candidateUse, "human_label_required");
  assert.equal(trace.request?.state, request.state);
});

test("shadow provider failure is recorded but incumbent still succeeds", async () => {
  const incumbent = new MockSystemOneProvider({
    id: "incumbent",
    responder: choiceResponse("incumbent", "accept", 0.9),
  });
  const shadow = new MockSystemOneProvider({
    id: "laya",
    responder: async () => {
      throw new Error("checkpoint unavailable");
    },
  });
  const sink = new MemoryShadowEvidenceSink();
  const bridge = new ShadowBridge({ incumbent, shadow, sink });

  const returned = await bridge.decide(request);
  assert.equal(returned.providerId, "incumbent");
  await bridge.flush();

  const trace = sink.records[0];
  assert.ok(trace);
  assert.equal(trace.shadow.status, "error");
  assert.match(trace.shadow.error ?? "", /checkpoint unavailable/);
  assert.equal(trace.review.needed, true);
  assert.deepEqual(trace.review.reasons, ["shadow_provider_error"]);
  assert.equal(trace.review.candidateUse, "provider_error_review");
});

test("incumbent failure is never replaced by a successful shadow decision", async () => {
  const incumbent = new MockSystemOneProvider({
    id: "incumbent",
    responder: async () => {
      throw new Error("authoritative provider failed");
    },
  });
  const shadow = new MockSystemOneProvider({
    id: "laya",
    responder: choiceResponse("laya", "accept", 0.99),
  });
  const sink = new MemoryShadowEvidenceSink();
  const bridge = new ShadowBridge({ incumbent, shadow, sink });

  await assert.rejects(
    () => bridge.decide(request),
    /authoritative provider failed/,
  );
  await bridge.flush();

  const trace = sink.records[0];
  assert.ok(trace);
  assert.equal(trace.incumbent.status, "error");
  assert.equal(trace.shadow.status, "ok");
  assert.equal(trace.shadowInfluencedExecution, false);
  assert.deepEqual(trace.review.reasons, ["incumbent_provider_error"]);
});

test("full evidence capture can redact without changing provider input", async () => {
  let seenState = "";
  const incumbent = new MockSystemOneProvider({
    id: "incumbent",
    responder: (incoming) => {
      seenState = incoming.state;
      return choiceResponse("incumbent", "accept", 0.9);
    },
  });
  const shadow = new MockSystemOneProvider({
    id: "laya",
    responder: choiceResponse("laya", "accept", 0.85),
  });
  const sink = new MemoryShadowEvidenceSink();
  const bridge = new ShadowBridge({
    incumbent,
    shadow,
    sink,
    capture: "full",
    redactRequest: (incoming) => ({
      ...incoming,
      state: "[redacted]",
      metadata: { redacted: true },
    }),
  });

  await bridge.decide(request);
  await bridge.flush();

  assert.equal(seenState, request.state);
  assert.equal(sink.records[0]?.request?.state, "[redacted]");
  assert.deepEqual(sink.records[0]?.request?.metadata, { redacted: true });
  assert.equal(sink.records[0]?.review.needed, false);
});

test("minimal capture excludes state, questions, and free-form metadata", async () => {
  const incumbent = new MockSystemOneProvider({
    id: "incumbent",
    responder: choiceResponse("incumbent", "accept", 0.9),
  });
  const shadow = new MockSystemOneProvider({
    id: "laya",
    responder: choiceResponse("laya", "accept", 0.85),
  });
  const sink = new MemoryShadowEvidenceSink();
  const bridge = new ShadowBridge({ incumbent, shadow, sink });

  await bridge.decide(request);
  await bridge.flush();

  const snapshot = sink.records[0]?.request;
  assert.ok(snapshot);
  assert.equal(snapshot.traceId, request.traceId);
  assert.deepEqual(snapshot.questionIds, ["verdict"]);
  assert.equal(snapshot.state, undefined);
  assert.equal(snapshot.questions, undefined);
  assert.equal(snapshot.metadata, undefined);
});
