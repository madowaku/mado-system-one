import assert from "node:assert/strict";
import test from "node:test";

import {
  MockSystemOneProvider,
  ProviderContractError,
  validateDecisionResponse,
  type DecisionRequest,
  type DecisionResponse,
} from "../src/index.js";

const request: DecisionRequest = {
  traceId: "trace-001",
  pattern: "route",
  state: "User asks to inspect a repository.",
  questions: {
    capability: {
      type: "choice",
      prompt: "Which capability should handle this?",
      options: [
        { id: "github", label: "GitHub" },
        { id: "browser", label: "Browser" },
      ],
      allowAbstain: true,
    },
    needsSpecialist: {
      type: "noul",
      prompt: "Does this require a specialized capability?",
    },
    difficulty: {
      type: "score",
      prompt: "How difficult is the task?",
      min: 1,
      max: 5,
    },
  },
};

const validResponse: DecisionResponse = {
  traceId: request.traceId,
  providerId: "mock",
  probabilitySemantics: "heuristic",
  results: {
    capability: {
      type: "choice",
      selected: "github",
      distribution: {
        github: 0.9,
        browser: 0.1,
      },
      confidence: 0.9,
    },
    needsSpecialist: {
      type: "noul",
      probabilityYes: 0.95,
    },
    difficulty: {
      type: "score",
      expectedScore: 2.5,
    },
  },
};

test("valid decision response satisfies the core contract", () => {
  assert.doesNotThrow(() => validateDecisionResponse(request, validResponse));
});

test("mock provider returns a validated typed decision", async () => {
  const provider = new MockSystemOneProvider({
    responder: validResponse,
  });

  const response = await provider.decide(request);

  assert.equal(response.providerId, "mock");
  assert.equal(response.results.capability?.type, "choice");
  assert.equal(
    response.results.capability?.type === "choice"
      ? response.results.capability.selected
      : null,
    "github",
  );
});

test("provider contract rejects distributions that do not sum to one", () => {
  const invalid: DecisionResponse = {
    ...validResponse,
    results: {
      ...validResponse.results,
      capability: {
        type: "choice",
        selected: "github",
        distribution: {
          github: 0.9,
          browser: 0.9,
        },
      },
    },
  };

  assert.throws(
    () => validateDecisionResponse(request, invalid),
    ProviderContractError,
  );
});

test("provider contract rejects a missing question result", () => {
  const invalid: DecisionResponse = {
    ...validResponse,
    results: {
      capability: validResponse.results.capability!,
      needsSpecialist: validResponse.results.needsSpecialist!,
    },
  };

  assert.throws(
    () => validateDecisionResponse(request, invalid),
    /missing result for question: difficulty/,
  );
});
