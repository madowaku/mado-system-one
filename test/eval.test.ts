import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EvalFixtureError,
  parseEvalJsonl,
  replayRecordsFromCases,
  runEval,
} from "../src/eval/skeleton.js";
import { ReplaySystemOneProvider } from "../src/providers/replay.js";

const loadSmoke = async () =>
  parseEvalJsonl(await readFile("fixtures/eval/smoke.jsonl", "utf8"));

test("smoke fixture runs through replay provider with perfect expected accuracy", async () => {
  const cases = await loadSmoke();
  const provider = new ReplaySystemOneProvider({ records: replayRecordsFromCases(cases) });
  const timestamps = [
    new Date("2026-10-01T00:00:00.000Z"),
    new Date("2026-10-01T00:00:01.000Z"),
  ];
  const run = await runEval(provider, cases, {
    datasetId: "smoke",
    runId: "test-run",
    now: () => timestamps.shift() ?? new Date("2026-10-01T00:00:01.000Z"),
  });

  assert.equal(run.schemaVersion, "mso.eval.v0");
  assert.equal(run.providerId, "replay");
  assert.equal(run.metrics.cases, 3);
  assert.equal(run.metrics.questions, 4);
  assert.equal(run.metrics.accuracy, 1);
  assert.equal(run.metrics.caseAccuracy, 1);
  assert.equal(run.metrics.providerErrors, 0);
  assert.equal(run.metrics.totalEstimatedCost, 0);
});

test("runner records provider errors without aborting the whole eval", async () => {
  const cases = await loadSmoke();
  const provider = new ReplaySystemOneProvider({
    records: replayRecordsFromCases(cases.slice(0, 1)),
  });
  const run = await runEval(provider, cases.slice(0, 2), {
    datasetId: "error-path",
    runId: "error-run",
  });

  assert.equal(run.metrics.cases, 2);
  assert.equal(run.metrics.providerErrors, 1);
  assert.equal(run.metrics.correctCases, 1);
  assert.equal(run.metrics.accuracy, 0.5);
  assert.match(run.cases[1]?.error ?? "", /no replay record/);
});

test("fixture parser rejects duplicate case ids", () => {
  const line = JSON.stringify({
    caseId: "duplicate",
    taskFamily: "asset.qa",
    pattern: "gate",
    state: "state",
    questions: {
      verdict: {
        type: "choice",
        prompt: "verdict",
        options: [{ id: "accept", label: "Accept" }],
      },
    },
    expected: { verdict: { type: "choice", selected: "accept" } },
  });

  assert.throws(() => parseEvalJsonl(`${line}\n${line}\n`), EvalFixtureError);
});
