import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionRequest } from "../src/core/types.js";
import {
  LayaSystemOneProvider,
  fromLayaAnswers,
  toLayaQuestions,
  type LayaRunner,
} from "../src/providers/laya.js";

const request: DecisionRequest = {
  traceId: "laya-test",
  pattern: "verify",
  state: "A generated asset passed all basic visual checks.",
  questions: {
    verdict: {
      type: "choice",
      prompt: "Choose a verdict.",
      options: [
        { id: "accept", label: "Accept", description: "ready to keep" },
        { id: "reject", label: "Reject", description: "discard" },
      ],
    },
    quality: {
      type: "score",
      prompt: "Rate quality.",
      min: 2,
      max: 4,
      labels: { 2: "low", 3: "medium", 4: "high" },
    },
    sufficient: {
      type: "noul",
      prompt: "Is the evidence sufficient?",
    },
  },
};

test("question translation preserves ids and maps score bounds to zero-based Laya levels", () => {
  const questions = toLayaQuestions(request.questions);
  assert.deepEqual(questions.verdict, {
    type: "choice",
    instructions: "Choose a verdict.",
    criteria: { accept: "ready to keep", reject: "discard" },
  });
  assert.deepEqual(questions.quality, {
    type: "score",
    instructions: "Rate quality.",
    criteria: ["low", "medium", "high"],
  });
  assert.deepEqual(questions.sufficient, {
    type: "noul",
    instructions: "Is the evidence sufficient?",
  });
});

test("answer translation uses answer_confidence and restores score offset", () => {
  const results = fromLayaAnswers(request.questions, {
    verdict: {
      type: "choice",
      choice: "accept",
      probabilities: { accept: 0.8, reject: 0.2 },
      confidence: 0.31,
      answer_confidence: 0.8,
    },
    quality: {
      type: "score",
      score: 1.4,
      probabilities: { "0": 0.1, "1": 0.4, "2": 0.5 },
      confidence: 0.42,
      answer_confidence: 0.5,
    },
    sufficient: {
      type: "noul",
      noul: 0.91,
      confidence: 0.91,
      answer_confidence: 0.91,
    },
  });

  assert.deepEqual(results.verdict, {
    type: "choice",
    selected: "accept",
    distribution: { accept: 0.8, reject: 0.2 },
    confidence: 0.8,
  });
  assert.deepEqual(results.quality, {
    type: "score",
    expectedScore: 3.4,
    distribution: [0.1, 0.4, 0.5],
  });
  assert.deepEqual(results.sufficient, {
    type: "noul",
    probabilityYes: 0.91,
  });
});

test("provider emits a valid MADO response with zero local inference cost", async () => {
  const seen: { questions?: unknown; options?: unknown } = {};
  const runner: LayaRunner = {
    async predict(_state, questions, options) {
      seen.questions = questions;
      seen.options = options;
      return {
        model: "english",
        routing: { model: "english", reason: "test" },
        usage: { input_tokens: 42, output_tokens: 0 },
        answers: {
          verdict: {
            type: "choice",
            choice: "accept",
            probabilities: { accept: 0.75, reject: 0.25 },
            answer_confidence: 0.75,
          },
          quality: {
            type: "score",
            score: 2,
            probabilities: { "0": 0.05, "1": 0.1, "2": 0.85 },
            answer_confidence: 0.85,
          },
          sufficient: {
            type: "noul",
            noul: 0.88,
            answer_confidence: 0.88,
          },
        },
      };
    },
  };

  const provider = new LayaSystemOneProvider({
    runner,
    model: "english",
    language: "en",
    minConfidence: 0.6,
  });
  const response = await provider.decide(request);

  assert.equal(response.providerId, "laya");
  assert.equal(response.modelId, "english");
  assert.equal(response.estimatedCost, 0);
  assert.equal(response.probabilitySemantics, "direct_logits");
  assert.equal(response.confidenceSemantics, "selected_probability");
  assert.deepEqual(seen.options, {
    model: "english",
    lang: "en",
    minConfidence: 0.6,
  });
  assert.deepEqual(response.metadata?.routing, { model: "english", reason: "test" });
});

test("adapter rejects score ranges Laya cannot encode safely", () => {
  assert.throws(
    () =>
      toLayaQuestions({
        bad: { type: "score", prompt: "bad", min: 0.5, max: 3.5 },
      }),
    /integer bounds/,
  );
});
