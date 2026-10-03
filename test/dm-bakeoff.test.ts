import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionRequest, DecisionResponse } from "../src/core/types.js";
import type { EvalCase } from "../src/eval/skeleton.js";
import {
  parseShadowBakeoffPolicy,
  runCrossProviderBakeoff,
  type ShadowBakeoffPolicy,
} from "../src/eval/bakeoff.js";
import { MockSystemOneProvider } from "../src/providers/mock.js";

const cases: EvalCase[] = [
  {
    caseId: "route-1",
    taskFamily: "routing",
    pattern: "route",
    state: "route alpha",
    questions: {
      target: {
        type: "choice",
        prompt: "Choose target.",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    },
    expected: {
      target: { type: "choice", selected: "a" },
    },
  },
  {
    caseId: "route-2",
    taskFamily: "routing",
    pattern: "route",
    state: "route beta",
    questions: {
      target: {
        type: "choice",
        prompt: "Choose target.",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    },
    expected: {
      target: { type: "choice", selected: "b" },
    },
  },
  {
    caseId: "gate-1",
    taskFamily: "safety.gate",
    pattern: "gate",
    state: "gate alpha",
    questions: {
      allow: {
        type: "noul",
        prompt: "Allow?",
      },
    },
    expected: {
      allow: { type: "noul", yes: true },
    },
  },
  {
    caseId: "score-1",
    taskFamily: "quality",
    pattern: "score",
    state: "score alpha",
    questions: {
      quality: {
        type: "score",
        prompt: "Rate quality.",
        min: 1,
        max: 5,
      },
    },
    expected: {
      quality: { type: "score", value: 4 },
    },
  },
];

const responseFor = (
  id: string,
  request: DecisionRequest,
  quality: "incumbent" | "good" | "bad",
): DecisionResponse => {
  const caseId = String(request.metadata?.evalCaseId ?? "");

  if (caseId === "route-1" || caseId === "route-2") {
    const expected = caseId === "route-1" ? "a" : "b";
    const selected = quality === "bad" ? (expected === "a" ? "b" : "a") : expected;
    const selectedProbability = quality === "incumbent" ? 0.9 : quality === "good" ? 0.8 : 0.95;
    return {
      traceId: request.traceId,
      providerId: id,
      probabilitySemantics: "direct_logits",
      confidenceSemantics: "selected_probability",
      calibrationStatus: "uncalibrated",
      results: {
        target: {
          type: "choice",
          selected,
          distribution:
            selected === "a"
              ? { a: selectedProbability, b: 1 - selectedProbability }
              : { a: 1 - selectedProbability, b: selectedProbability },
          confidence: selectedProbability,
        },
      },
      estimatedCost: 0,
    };
  }

  if (caseId === "gate-1") {
    const probabilityYes =
      quality === "incumbent" ? 0.9 : quality === "good" ? 0.8 : 0.05;
    return {
      traceId: request.traceId,
      providerId: id,
      probabilitySemantics: "direct_logits",
      confidenceSemantics: "selected_probability",
      calibrationStatus: "uncalibrated",
      results: {
        allow: {
          type: "noul",
          probabilityYes,
          confidence: Math.max(probabilityYes, 1 - probabilityYes),
        },
      },
      estimatedCost: 0,
    };
  }

  const expectedScore = quality === "bad" ? 2 : 4;
  const confidence = quality === "incumbent" ? 0.9 : quality === "good" ? 0.8 : 0.95;
  return {
    traceId: request.traceId,
    providerId: id,
    probabilitySemantics: "direct_logits",
    confidenceSemantics: "selected_probability",
    calibrationStatus: "uncalibrated",
    results: {
      quality: {
        type: "score",
        expectedScore,
        confidence,
      },
    },
    estimatedCost: 0,
  };
};

const provider = (
  id: string,
  quality: "incumbent" | "good" | "bad",
): MockSystemOneProvider =>
  new MockSystemOneProvider({
    id,
    capabilities: {
      probabilitySemantics: "direct_logits",
      confidenceSemantics: "selected_probability",
      calibration: { status: "uncalibrated" },
    },
    responder: (request) => responseFor(id, request, quality),
  });

const policy: ShadowBakeoffPolicy = {
  schemaVersion: "mso.dm-shadow-policy.v0",
  policyId: "test-shadow-entry",
  minQuestions: 4,
  minAccuracy: 0.75,
  maxProviderErrorRate: 0,
  minCalibrationCoverage: 1,
  maxEce10: 0.25,
  maxBrier: 0.1,
  minComparableQuestionsWithIncumbent: 4,
  maxReviewLoadRate: 0.5,
};

test("cross-provider bake-off emits calibration evidence and only plans passing shadows", async () => {
  const evidence = await runCrossProviderBakeoff(
    [
      provider("incumbent", "incumbent"),
      provider("candidate-good", "good"),
      provider("candidate-bad", "bad"),
    ],
    cases,
    {
      datasetId: "dm-bakeoff-fixture",
      incumbentProviderId: "incumbent",
      policy,
      bakeoffId: "dm-bakeoff-test",
    },
  );

  assert.equal(evidence.schemaVersion, "mso.dm-bakeoff.v0");
  assert.equal(evidence.automaticSelection, false);
  assert.equal(evidence.runtimeAuthorityChange, false);
  assert.deepEqual(evidence.shadowCandidates, ["candidate-good"]);

  const incumbent = evidence.assessments.find(
    (item) => item.providerId === "incumbent",
  );
  assert.ok(incumbent);
  assert.equal(incumbent.readiness, "reference_incumbent");

  const good = evidence.assessments.find(
    (item) => item.providerId === "candidate-good",
  );
  assert.ok(good);
  assert.equal(good.readiness, "eligible_for_shadow");
  assert.equal(good.offline.accuracy, 1);
  assert.equal(good.offline.calibration.coverage, 1);
  assert.ok(good.offline.calibration.ece10 <= 0.25);
  assert.equal(
    good.offline.calibration.sourceCounts.choice_selected_probability,
    2,
  );
  assert.equal(
    good.offline.calibration.sourceCounts.noul_predicted_probability,
    1,
  );
  assert.equal(good.offline.calibration.sourceCounts.reported_confidence, 1);
  assert.equal(good.incumbentPair?.reviewLoadRate, 0);
  assert.deepEqual(good.shadowPlan, {
    mode: "shadow",
    authoritativeProviderId: "incumbent",
    shadowProviderId: "candidate-good",
    shadowInfluencedExecution: false,
    automaticActivation: false,
  });

  const bad = evidence.assessments.find(
    (item) => item.providerId === "candidate-bad",
  );
  assert.ok(bad);
  assert.equal(bad.readiness, "blocked");
  assert.equal(bad.offline.accuracy, 0);
  assert.ok(bad.offline.calibration.ece10 > 0.9);
  assert.equal(bad.incumbentPair?.reviewLoadRate, 1);
  assert.ok(bad.checks.some((check) => check.id === "accuracy" && check.status === "fail"));
  assert.equal(bad.shadowPlan, undefined);
});

test("missing calibration evidence yields insufficient_evidence rather than silent eligibility", async () => {
  const scoreOnlyCases: EvalCase[] = [
    {
      caseId: "score-no-confidence",
      taskFamily: "quality",
      pattern: "score",
      state: "score",
      questions: {
        quality: {
          type: "score",
          prompt: "Rate.",
          min: 1,
          max: 5,
        },
      },
      expected: {
        quality: { type: "score", value: 4 },
      },
    },
  ];

  const noConfidence = new MockSystemOneProvider({
    id: "no-confidence",
    responder: (request) => ({
      traceId: request.traceId,
      providerId: "no-confidence",
      probabilitySemantics: "provider_defined",
      results: {
        quality: {
          type: "score",
          expectedScore: 4,
        },
      },
    }),
  });

  const evidence = await runCrossProviderBakeoff(
    [
      new MockSystemOneProvider({
        id: "incumbent",
        responder: (request) => ({
          traceId: request.traceId,
          providerId: "incumbent",
          probabilitySemantics: "direct_logits",
          confidenceSemantics: "selected_probability",
          results: {
            quality: {
              type: "score",
              expectedScore: 4,
              confidence: 0.9,
            },
          },
        }),
      }),
      noConfidence,
    ],
    scoreOnlyCases,
    {
      datasetId: "no-confidence",
      incumbentProviderId: "incumbent",
      policy: {
        ...policy,
        policyId: "needs-confidence",
        minQuestions: 1,
        minComparableQuestionsWithIncumbent: 1,
        maxReviewLoadRate: undefined,
      } as unknown as ShadowBakeoffPolicy,
    },
  );

  const assessment = evidence.assessments.find(
    (item) => item.providerId === "no-confidence",
  );
  assert.ok(assessment);
  assert.equal(assessment.offline.calibration.coverage, 0);
  assert.equal(assessment.readiness, "insufficient_evidence");
  assert.ok(
    assessment.checks.some(
      (check) =>
        check.id === "calibration_coverage" &&
        check.status === "insufficient",
    ),
  );
});

test("shadow policy parser rejects probabilities outside [0, 1]", () => {
  assert.throws(
    () =>
      parseShadowBakeoffPolicy({
        ...policy,
        minAccuracy: 1.2,
      }),
    /minAccuracy must be in \[0, 1\]/,
  );
});
