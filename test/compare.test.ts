import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runComparison } from "../src/eval/compare.js";
import {
  parseEvalJsonl,
  replayRecordsFromCases,
} from "../src/eval/skeleton.js";
import { MockSystemOneProvider } from "../src/providers/mock.js";
import { ReplaySystemOneProvider } from "../src/providers/replay.js";

const loadSmoke = async () =>
  parseEvalJsonl(await readFile("fixtures/eval/smoke.jsonl", "utf8"));

const candidate = (id: string) =>
  new MockSystemOneProvider({
    id,
    responder: (request) => {
      const base = {
        traceId: request.traceId,
        providerId: id,
        probabilitySemantics: "direct_logits" as const,
        confidenceSemantics: "selected_probability" as const,
        calibrationStatus: "uncalibrated" as const,
        estimatedCost: 0,
      };

      if (request.traceId === "eval:asset.qa.0001") {
        return {
          ...base,
          results: {
            verdict: {
              type: "choice" as const,
              selected: "maybe",
              distribution: { accept: 0.25, maybe: 0.6, reject: 0.15 },
              confidence: 0.6,
            },
          },
        };
      }
      if (request.traceId === "eval:qa.severity.0001") {
        return {
          ...base,
          results: {
            severity: {
              type: "choice" as const,
              selected: "major",
              distribution: {
                blocker: 0.05,
                major: 0.7,
                minor: 0.2,
                cosmetic: 0.05,
              },
              confidence: 0.7,
            },
          },
        };
      }
      return {
        ...base,
        results: {
          sufficient: {
            type: "noul" as const,
            probabilityYes: 0.8,
            confidence: 0.8,
          },
          quality: {
            type: "score" as const,
            expectedScore: 4.0,
            distribution: [0.01, 0.02, 0.07, 0.3, 0.6],
            confidence: 0.6,
          },
        },
      };
    },
  });

test("comparison separates agreement from correctness", async () => {
  const cases = await loadSmoke();
  const replay = new ReplaySystemOneProvider({
    records: replayRecordsFromCases(cases),
  });
  const laya = candidate("laya");

  const evidence = await runComparison([replay, laya], cases, {
    datasetId: "smoke",
    comparisonId: "compare-test",
    scoreAgreementTolerance: 0.5,
  });

  assert.equal(evidence.schemaVersion, "mso.compare.v0");
  assert.deepEqual(evidence.providerIds, ["replay", "laya"]);
  assert.equal(evidence.pairs.length, 1);

  const pair = evidence.pairs[0];
  assert.ok(pair);
  assert.equal(pair.comparableQuestions, 4);
  assert.equal(pair.agreements, 3);
  assert.equal(pair.disagreements, 1);
  assert.equal(pair.agreementRate, 0.75);
  assert.equal(pair.bothCorrect, 3);
  assert.equal(pair.leftOnlyCorrect, 1);
  assert.equal(pair.rightOnlyCorrect, 0);
  assert.equal(pair.bothWrong, 0);

  const asset = evidence.cases.find((row) => row.caseId === "asset.qa.0001");
  const verdict = asset?.questions.find((row) => row.questionId === "verdict");
  assert.equal(verdict?.pairs[0]?.agreement, false);
  assert.equal(verdict?.pairs[0]?.correctness, "left_only");
  assert.equal(verdict?.pairs[0]?.confidenceDelta, 0.32);
});

test("three providers produce every pair without changing the runner shape", async () => {
  const cases = await loadSmoke();
  const replay = new ReplaySystemOneProvider({
    records: replayRecordsFromCases(cases),
  });

  const evidence = await runComparison(
    [replay, candidate("laya"), candidate("jev-fixture")],
    cases,
    {
      datasetId: "smoke",
      comparisonId: "tri-test",
    },
  );

  assert.equal(evidence.providerIds.length, 3);
  assert.equal(evidence.pairs.length, 3);
  assert.deepEqual(
    evidence.pairs.map((pair) => [pair.left, pair.right]),
    [
      ["replay", "laya"],
      ["replay", "jev-fixture"],
      ["laya", "jev-fixture"],
    ],
  );
  assert.equal(evidence.pairs[2]?.agreementRate, 1);
});

test("comparison refuses duplicate provider ids", async () => {
  const cases = await loadSmoke();
  await assert.rejects(
    () =>
      runComparison([candidate("same"), candidate("same")], cases, {
        datasetId: "smoke",
      }),
    /provider ids must be unique/,
  );
});
