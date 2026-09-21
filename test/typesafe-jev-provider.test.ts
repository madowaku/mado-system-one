import assert from "node:assert/strict";
import test from "node:test";

import {
  MADO_ABSTAIN_OPTION_ID,
  TypeSafeJevProvider,
  TypeSafeJevProviderError,
  type DecisionRequest,
  type TypeSafeSystemOneClient,
} from "../src/index.js";

test("maps Choice, Noul, and Score through one TypeSafe systemOne request", async () => {
  let capturedRequest: Parameters<TypeSafeSystemOneClient["systemOne"]>[0] | undefined;
  let capturedOptions: Parameters<TypeSafeSystemOneClient["systemOne"]>[1] | undefined;

  const client: TypeSafeSystemOneClient = {
    async systemOne(request, options) {
      capturedRequest = request;
      capturedOptions = options;

      return {
        model: "jev-fixture",
        answers: {
          capability: {
            type: "choice",
            choice: "github",
            confidence: 0.72,
            probabilities: {
              github: 0.72,
              browser: 0.18,
              [MADO_ABSTAIN_OPTION_ID]: 0.1,
            },
          },
          needsCapability: {
            type: "noul",
            noul: 0.94,
          },
          difficulty: {
            type: "score",
            score: 1.25,
            confidence: 0.7,
            probabilities: {
              "0": 0.1,
              "1": 0.55,
              "2": 0.35,
            },
          },
        },
        usage: {
          input_tokens: 123,
          output_tokens: 0,
        },
      };
    },
  };

  const provider = new TypeSafeJevProvider({
    client,
    model: "jev-fixture",
    timeoutMs: 500,
  });

  const request: DecisionRequest = {
    traceId: "jev-001",
    pattern: "route",
    state: "Inspect a connected GitHub repository.",
    budget: {
      maxLatencyMs: 250,
    },
    questions: {
      capability: {
        type: "choice",
        prompt: "Which capability fits?",
        options: [
          { id: "github", label: "GitHub" },
          { id: "browser", label: "Browser" },
        ],
        allowAbstain: true,
      },
      needsCapability: {
        type: "noul",
        prompt: "Is a specialized capability needed?",
      },
      difficulty: {
        type: "score",
        prompt: "How difficult is the task?",
        min: 1,
        max: 3,
        labels: {
          1: "easy",
          2: "medium",
          3: "hard",
        },
      },
    },
  };

  const response = await provider.decide(request);

  assert.equal(capturedRequest?.state, request.state);
  assert.equal(capturedRequest?.model, "jev-fixture");
  assert.equal(capturedOptions?.timeout, 250);

  const choice = response.results.capability;
  assert.equal(choice?.type, "choice");
  if (choice?.type === "choice") {
    assert.equal(choice.selected, "github");
    assert.equal(choice.distribution.github, 0.72);
    assert.equal(choice.abstainProbability, 0.1);
    assert.equal(choice.abstained, false);
  }

  const noul = response.results.needsCapability;
  assert.equal(noul?.type, "noul");
  if (noul?.type === "noul") {
    assert.equal(noul.probabilityYes, 0.94);
  }

  const score = response.results.difficulty;
  assert.equal(score?.type, "score");
  if (score?.type === "score") {
    assert.equal(score.expectedScore, 2.25);
    assert.deepEqual(score.distribution, [0.1, 0.55, 0.35]);
  }

  assert.equal(response.modelId, "jev-fixture");
  assert.equal(response.probabilitySemantics, "provider_defined");
  assert.deepEqual(response.metadata?.usage, {
    inputTokens: 123,
    outputTokens: 0,
  });
});

test("preserves explicit TypeSafe abstention instead of forcing a candidate", async () => {
  const client: TypeSafeSystemOneClient = {
    async systemOne() {
      return {
        model: "jev-fixture",
        answers: {
          route: {
            type: "choice",
            choice: MADO_ABSTAIN_OPTION_ID,
            confidence: 0.8,
            probabilities: {
              github: 0.1,
              browser: 0.1,
              [MADO_ABSTAIN_OPTION_ID]: 0.8,
            },
          },
        },
        usage: {
          input_tokens: 20,
          output_tokens: 0,
        },
      };
    },
  };

  const provider = new TypeSafeJevProvider({ client });

  const response = await provider.decide({
    traceId: "jev-002",
    pattern: "route",
    state: "A request outside the candidate registry.",
    questions: {
      route: {
        type: "choice",
        prompt: "Which candidate fits?",
        options: [
          { id: "github", label: "GitHub" },
          { id: "browser", label: "Browser" },
        ],
        allowAbstain: true,
      },
    },
  });

  const result = response.results.route;
  assert.equal(result?.type, "choice");
  if (result?.type === "choice") {
    assert.equal(result.selected, null);
    assert.equal(result.abstained, true);
    assert.equal(result.abstainProbability, 0.8);
    assert.deepEqual(result.distribution, {
      github: 0.1,
      browser: 0.1,
    });
  }
});

test("rejects unsupported multi-select Choice requests before network execution", async () => {
  let called = false;

  const client: TypeSafeSystemOneClient = {
    async systemOne() {
      called = true;
      throw new Error("should not run");
    },
  };

  const provider = new TypeSafeJevProvider({ client });

  await assert.rejects(
    provider.decide({
      traceId: "jev-003",
      pattern: "rank",
      state: "Rank several candidates.",
      questions: {
        candidates: {
          type: "choice",
          prompt: "Choose candidates.",
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
          maxSelections: 2,
        },
      },
    }),
    TypeSafeJevProviderError,
  );

  assert.equal(called, false);
});

test("rejects non-text modality before network execution", async () => {
  let called = false;

  const client: TypeSafeSystemOneClient = {
    async systemOne() {
      called = true;
      throw new Error("should not run");
    },
  };

  const provider = new TypeSafeJevProvider({ client });

  await assert.rejects(
    provider.decide({
      traceId: "jev-004",
      pattern: "verify",
      state: "Screenshot payload placeholder.",
      modality: "vision",
      questions: {
        visible: {
          type: "noul",
          prompt: "Is the button visible?",
        },
      },
    }),
    /text modality only/,
  );

  assert.equal(called, false);
});
