import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionRequest } from "../src/core/types.js";
import {
  ClefSystemOneProvider,
  CloudflareWorkersAiClefRunner,
  fromClefAnswers,
  toClefQuestions,
  type ClefRunner,
} from "../src/providers/clef.js";

const request: DecisionRequest = {
  traceId: "clef-test",
  pattern: "route",
  state: "Checkout failures block all orders.",
  questions: {
    team: {
      type: "choice",
      prompt: "Which team owns this?",
      options: [
        { id: "billing", label: "Billing" },
        { id: "technical", label: "Technical" },
      ],
    },
    severity: {
      type: "score",
      prompt: "How severe is this?",
      min: 2,
      max: 4,
      labels: { 2: "minor", 3: "major", 4: "critical" },
    },
    urgent: {
      type: "noul",
      prompt: "Is this urgent?",
    },
  },
};

test("Clef question translation uses System One criteria and preserves MADO score offset", () => {
  const questions = toClefQuestions(request.questions);
  assert.deepEqual(questions.team, {
    type: "choice",
    instructions: "Which team owns this?",
    criteria: { billing: "Billing", technical: "Technical" },
  });
  assert.deepEqual(questions.severity, {
    type: "score",
    instructions: "How severe is this?",
    criteria: ["minor", "major", "critical"],
  });
});

test("Clef answer translation preserves API confidence and restores score offset", () => {
  const results = fromClefAnswers(request.questions, {
    team: {
      type: "choice",
      choice: "technical",
      confidence: 0.72,
      probabilities: { billing: 0.1, technical: 0.9 },
    },
    severity: {
      type: "score",
      score: 1.7,
      confidence: 0.61,
      legend: { "0": "minor", "1": "major", "2": "critical" },
      probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
    },
    urgent: {
      type: "noul",
      noul: 0.97,
    },
  });

  assert.deepEqual(results.team, {
    type: "choice",
    selected: "technical",
    distribution: { billing: 0.1, technical: 0.9 },
    confidence: 0.72,
  });
  assert.deepEqual(results.severity, {
    type: "score",
    expectedScore: 3.7,
    distribution: [0.1, 0.2, 0.7],
    confidence: 0.61,
  });
  assert.deepEqual(results.urgent, {
    type: "noul",
    probabilityYes: 0.97,
  });
});

test("Clef provider stays text-only at intake and does not inherit calibration", async () => {
  const runner: ClefRunner = {
    async run(input) {
      assert.equal(input.model, "clef-flash");
      return {
        model: "clef-flash",
        usage: { input_tokens: 123 },
        answers: {
          team: {
            type: "choice",
            choice: "technical",
            confidence: 0.88,
            probabilities: { billing: 0.03, technical: 0.97 },
          },
          severity: {
            type: "score",
            score: 2,
            confidence: 0.9,
            probabilities: { "0": 0.01, "1": 0.09, "2": 0.9 },
          },
          urgent: { type: "noul", noul: 0.99 },
        },
      };
    },
  };

  const provider = new ClefSystemOneProvider({
    runner,
    model: "clef-flash",
  });
  const response = await provider.decide(request);

  assert.equal(response.providerId, "clef-flash");
  assert.equal(response.probabilitySemantics, "direct_logits");
  assert.equal(response.confidenceSemantics, "provider_defined");
  assert.equal(response.calibrationStatus, "unknown");
  assert.deepEqual(provider.capabilities().modalities, ["text"]);

  await assert.rejects(
    () => provider.decide({ ...request, modality: "text+vision" }),
    /currently enables text only/,
  );
});

test("Cloudflare runner unwraps Workers AI result and sends the correct model endpoint", async () => {
  let seenUrl = "";
  let seenAuth = "";
  let seenBody: unknown;

  const fetchImpl: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    const headers = new Headers(init?.headers);
    seenAuth = headers.get("Authorization") ?? "";
    seenBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        success: true,
        result: {
          model: "clef-flash",
          answers: {
            urgent: { type: "noul", noul: 0.91 },
          },
          usage: { input_tokens: 10 },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const runner = new CloudflareWorkersAiClefRunner({
    accountId: "acct 1",
    apiToken: "secret-token",
    model: "clef-flash",
    fetchImpl,
  });

  const result = await runner.run({
    model: "clef-flash",
    state: "state",
    questions: {
      urgent: { type: "noul", instructions: "Urgent?" },
    },
  });

  assert.match(seenUrl, /accounts\/acct%201\/ai\/run\/@cf\/cloudflare\/clef-flash$/);
  assert.equal(seenAuth, "Bearer secret-token");
  assert.deepEqual(seenBody, {
    model: "clef-flash",
    state: "state",
    questions: {
      urgent: { type: "noul", instructions: "Urgent?" },
    },
  });
  assert.equal(result.answers.urgent && "noul" in result.answers.urgent
    ? result.answers.urgent.noul
    : null, 0.91);
});
