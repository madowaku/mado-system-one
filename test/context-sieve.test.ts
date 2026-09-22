import assert from "node:assert/strict";
import test from "node:test";

import {
  ContextSieve,
  MockSystemOneProvider,
  type DecisionRequest,
  type DecisionResponse,
} from "../src/index.js";

const makeResponse = (
  request: DecisionRequest,
  probabilities: Readonly<Record<string, number>>,
): DecisionResponse => ({
  traceId: request.traceId,
  providerId: "context-fixture",
  probabilitySemantics: "heuristic",
  results: Object.fromEntries(
    Object.keys(request.questions).map((questionId) => [
      questionId,
      {
        type: "noul" as const,
        probabilityYes: probabilities[questionId] ?? 0.5,
      },
    ]),
  ),
});

test("context sieve retains, reversibly hides, and escalates without destructive drops", async () => {
  let observedQuestionIds: readonly string[] = [];

  const provider = new MockSystemOneProvider({
    id: "context-fixture",
    capabilities: {
      inferenceFamily: "encoder_scoring",
      confidenceSemantics: "normalized_entropy",
      calibration: {
        status: "uncalibrated",
      },
      patternSupport: {
        sieve: {
          status: "experimental",
          evidenceRef: "fixture",
        },
      },
    },
    responder: (request) => {
      observedQuestionIds = Object.keys(request.questions);

      return makeResponse(request, {
        "relevance:relevant": 0.94,
        "relevance:stale": 0.08,
        "relevance:ambiguous": 0.52,
        "relevance:irreversible": 0.04,
      });
    },
  });

  const sieve = new ContextSieve({
    provider,
    config: {
      hideThreshold: 0.2,
      retainThreshold: 0.8,
    },
  });

  const result = await sieve.sieve({
    traceId: "ctx-001",
    task: "Fix the failing capability router test.",
    chunks: [
      {
        id: "policy",
        kind: "instruction",
        content: "Never publish secrets.",
        mandatory: true,
      },
      {
        id: "relevant",
        kind: "code",
        content: "CapabilityResolver implementation.",
        restorationRef: "repo:src/capability/resolver.ts",
      },
      {
        id: "stale",
        kind: "tool_output",
        content: "An old unrelated build log.",
        restorationRef: "trace:old-build-log",
      },
      {
        id: "ambiguous",
        kind: "conversation",
        content: "A prior discussion that may explain the intended behavior.",
        restorationRef: "chat:prior-discussion",
      },
      {
        id: "irreversible",
        kind: "document",
        content: "Low relevance text with no restoration source.",
      },
    ],
  });

  assert.equal(observedQuestionIds.includes("relevance:policy"), false);
  assert.deepEqual(result.retainedIds, ["policy", "relevant", "irreversible"]);
  assert.deepEqual(result.hiddenIds, ["stale"]);
  assert.deepEqual(result.escalatedIds, ["ambiguous"]);
  assert.equal(result.reversible, true);

  const irreversible = result.decisions.find(
    (decision) => decision.chunkId === "irreversible",
  );
  assert.deepEqual(irreversible?.reasonCodes, [
    "relevance_below_hide_threshold",
    "non_reversible_context",
  ]);
});

test("context sieve does not invoke the provider for mandatory-only context", async () => {
  let calls = 0;

  const provider = new MockSystemOneProvider({
    responder: (request) => {
      calls += 1;
      return makeResponse(request, {});
    },
  });

  const sieve = new ContextSieve({
    provider,
    config: {
      hideThreshold: 0.2,
      retainThreshold: 0.8,
    },
  });

  const result = await sieve.sieve({
    traceId: "ctx-002",
    task: "Follow the required policy.",
    chunks: [
      {
        id: "policy",
        kind: "instruction",
        content: "Required instruction.",
        mandatory: true,
      },
    ],
  });

  assert.equal(calls, 0);
  assert.deepEqual(result.retainedIds, ["policy"]);
  assert.equal(result.providerId, undefined);
});

test("context sieve requires an uncertainty band between hide and retain", () => {
  const provider = new MockSystemOneProvider({
    responder: {
      traceId: "unused",
      providerId: "mock",
      probabilitySemantics: "heuristic",
      results: {},
    },
  });

  assert.throws(
    () =>
      new ContextSieve({
        provider,
        config: {
          hideThreshold: 0.8,
          retainThreshold: 0.8,
        },
      }),
    /hideThreshold < retainThreshold/,
  );
});
