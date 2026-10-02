import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DecisionResponse } from "../src/core/types.js";
import { runEval, type EvalCase } from "../src/eval/skeleton.js";
import { MockSystemOneProvider } from "../src/providers/mock.js";
import {
  fingerprintLayaOnnxCheckpoint,
} from "../src/reeval/checkpoint.js";
import {
  parseFineTuneValidationJsonl,
  runCandidateReeval,
} from "../src/reeval/candidate.js";

const cases: EvalCase[] = [
  {
    caseId: "c1",
    taskFamily: "asset.qa",
    pattern: "gate",
    state: "asset one",
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
    expected: {
      verdict: { type: "choice", selected: "accept" },
    },
    tags: ["asset"],
    language: "en",
  },
  {
    caseId: "c2",
    taskFamily: "asset.qa",
    pattern: "gate",
    state: "asset two",
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
    expected: {
      verdict: { type: "choice", selected: "reject" },
    },
    tags: ["asset"],
    language: "en",
  },
  {
    caseId: "c3",
    taskFamily: "evidence.quality",
    pattern: "verify",
    state: "evidence one",
    questions: {
      sufficient: {
        type: "noul",
        prompt: "Sufficient?",
      },
    },
    expected: {
      sufficient: { type: "noul", yes: true },
    },
    tags: ["evidence"],
    language: "en",
  },
  {
    caseId: "c4",
    taskFamily: "evidence.quality",
    pattern: "score",
    state: "evidence two",
    questions: {
      quality: {
        type: "score",
        prompt: "Score quality.",
        min: 1,
        max: 5,
      },
    },
    expected: {
      quality: { type: "score", value: 4, tolerance: 0 },
    },
    tags: ["evidence"],
    language: "en",
  },
];

const baseAnswer = (traceId: string): DecisionResponse["results"] => {
  if (traceId === "eval:c1") {
    return {
      verdict: {
        type: "choice",
        selected: "accept",
        distribution: { accept: 0.9, reject: 0.1 },
        confidence: 0.9,
      },
    };
  }
  if (traceId === "eval:c2") {
    return {
      verdict: {
        type: "choice",
        selected: "accept",
        distribution: { accept: 0.8, reject: 0.2 },
        confidence: 0.8,
      },
    };
  }
  if (traceId === "eval:c3") {
    return {
      sufficient: {
        type: "noul",
        probabilityYes: 0.7,
        confidence: 0.7,
      },
    };
  }
  return {
    quality: {
      type: "score",
      expectedScore: 3,
      confidence: 0.6,
    },
  };
};

const candidateAnswer = (traceId: string): DecisionResponse["results"] => {
  if (traceId === "eval:c1") {
    return {
      verdict: {
        type: "choice",
        selected: "reject",
        distribution: { accept: 0.05, reject: 0.95 },
        confidence: 0.95,
      },
    };
  }
  if (traceId === "eval:c2") {
    return {
      verdict: {
        type: "choice",
        selected: "reject",
        distribution: { accept: 0.1, reject: 0.9 },
        confidence: 0.9,
      },
    };
  }
  if (traceId === "eval:c3") {
    return {
      sufficient: {
        type: "noul",
        probabilityYes: 0.85,
        confidence: 0.85,
      },
    };
  }
  return {
    quality: {
      type: "score",
      expectedScore: 4,
      confidence: 0.8,
    },
  };
};

const provider = (
  id: string,
  answer: (traceId: string) => DecisionResponse["results"],
) =>
  new MockSystemOneProvider({
    id,
    responder: (request) => ({
      traceId: request.traceId,
      providerId: id,
      probabilitySemantics: "direct_logits",
      confidenceSemantics: "selected_probability",
      calibrationStatus: "uncalibrated",
      results: answer(request.traceId),
      estimatedCost: 0,
    }),
  });

const fingerprint = (ref: string, digest: string) => ({
  schemaVersion: "mso.laya-checkpoint.v0" as const,
  ref,
  format: "laya-ts-onnx" as const,
  fingerprint: digest,
  artifacts: [],
});

test("candidate re-eval surfaces improvements, regressions, slices, and calibration", async () => {
  const base = provider("laya-base", baseAnswer);
  const candidate = provider("laya-candidate", candidateAnswer);
  const incumbent = provider("incumbent", (traceId) => {
    if (traceId === "eval:c1") return baseAnswer(traceId);
    return candidateAnswer(traceId);
  });
  const incumbentRun = await runEval(incumbent, cases, {
    datasetId: "holdout",
    runId: "incumbent-holdout",
  });

  const result = await runCandidateReeval(cases, base, candidate, {
    datasetId: "holdout",
    reevalId: "reeval-test",
    baseCheckpoint: fingerprint("base", "a".repeat(64)),
    candidateCheckpoint: fingerprint("candidate", "b".repeat(64)),
    incumbentRun,
  });

  assert.equal(result.evidence.schemaVersion, "mso.reeval.v0");
  assert.equal(result.baseRun.metrics.accuracy, 0.5);
  assert.equal(result.candidateRun.metrics.accuracy, 0.75);
  assert.equal(result.evidence.deltas.candidateVsBase.accuracy, 0.25);
  assert.equal(result.evidence.regressionCount, 1);
  assert.equal(result.evidence.improvementCount, 2);
  assert.equal(result.evidence.hasRegression, true);
  assert.equal(result.regressions[0]?.caseId, "c1");
  assert.equal(result.evidence.pairs.length, 2);

  const overall = result.evidence.slices.find(
    (slice) => slice.dimension === "overall",
  );
  assert.ok(overall);
  assert.equal(overall.baseAccuracy, 0.5);
  assert.equal(overall.candidateAccuracy, 0.75);
  assert.equal(overall.regressions, 1);
  assert.equal(overall.improvements, 2);

  const evidenceSlice = result.evidence.slices.find(
    (slice) =>
      slice.dimension === "taskFamily" &&
      slice.value === "evidence.quality",
  );
  assert.ok(evidenceSlice);
  assert.equal(evidenceSlice.baseAccuracy, 0.5);
  assert.equal(evidenceSlice.candidateAccuracy, 1);
  assert.equal(evidenceSlice.accuracyDelta, 0.5);

  assert.equal(
    result.evidence.providers.candidate.confidenceCalibration.coverage,
    1,
  );
  assert.ok(
    result.evidence.providers.candidate.confidenceCalibration.ece10 >= 0,
  );
  assert.equal(
    result.evidence.promotionInput.candidateEval,
    "candidate.eval.json",
  );
});

test("fine-tune validation metadata round-trips into an EvalCase", () => {
  const line = JSON.stringify({
    state: "quality state",
    questions: {
      quality: {
        type: "score",
        instructions: "Score quality.",
        criteria: ["1", "2", "3", "4", "5"],
      },
    },
    gold: {
      quality: {
        label: 3,
        probabilities: {
          "0": 0.01,
          "1": 0.04,
          "2": 0.15,
          "3": 0.7,
          "4": 0.1,
        },
      },
    },
    _mado: {
      caseId: "score-case",
      taskFamily: "evidence.quality",
      recordIds: ["score-case:quality"],
      tags: ["holdout"],
      language: "en",
      evaluation: {
        pattern: "score",
        questions: {
          quality: {
            type: "score",
            prompt: "Score quality.",
            min: 1,
            max: 5,
          },
        },
        expected: {
          quality: {
            type: "score",
            value: 4,
            tolerance: 0,
          },
        },
      },
    },
  });

  const parsed = parseFineTuneValidationJsonl(`${line}\n`);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.pattern, "score");
  assert.deepEqual(parsed[0]?.questions.quality, {
    type: "score",
    prompt: "Score quality.",
    min: 1,
    max: 5,
  });
  assert.deepEqual(parsed[0]?.expected.quality, {
    type: "score",
    value: 4,
    tolerance: 0,
  });
});

test("old fine-tune validation packs without evaluation metadata fail clearly", () => {
  const line = JSON.stringify({
    state: "old pack",
    questions: {},
    gold: {},
    _mado: {
      caseId: "old",
      taskFamily: "asset.qa",
      recordIds: [],
      tags: [],
    },
  });

  assert.throws(
    () => parseFineTuneValidationJsonl(line),
    /regenerate the M0\.6 fine-tune pack/,
  );
});

test("checkpoint fingerprint identifies exact exported ONNX artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mso-reeval-"));
  try {
    await writeFile(join(dir, "rl_agent_config.json"), "{}");
    await writeFile(join(dir, "tokenizer.json"), "{}");
    await writeFile(join(dir, "encoder.onnx"), "encoder-v1");
    await writeFile(join(dir, "head.onnx"), "head-v1");

    const first = await fingerprintLayaOnnxCheckpoint(dir, "candidate-v1");
    const again = await fingerprintLayaOnnxCheckpoint(dir, "candidate-v1");
    assert.equal(first.fingerprint, again.fingerprint);
    assert.equal(first.artifacts.length, 4);

    await writeFile(join(dir, "head.onnx"), "head-v2");
    const changed = await fingerprintLayaOnnxCheckpoint(dir, "candidate-v1");
    assert.notEqual(first.fingerprint, changed.fingerprint);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
