import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runComparison } from "../src/eval/compare.js";
import {
  buildDisagreementLab,
  writeDisagreementLab,
} from "../src/eval/disagreement.js";
import {
  parseEvalJsonl,
  replayRecordsFromCases,
} from "../src/eval/skeleton.js";
import { MockSystemOneProvider } from "../src/providers/mock.js";
import { ReplaySystemOneProvider } from "../src/providers/replay.js";

const loadSmoke = async () =>
  parseEvalJsonl(await readFile("fixtures/eval/smoke.jsonl", "utf8"));

const layaCandidate = () =>
  new MockSystemOneProvider({
    id: "laya",
    responder: (request) => {
      const base = {
        traceId: request.traceId,
        providerId: "laya",
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
              distribution: { accept: 0.04, maybe: 0.93, reject: 0.03 },
              confidence: 0.93,
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
                blocker: 0.03,
                major: 0.8,
                minor: 0.14,
                cosmetic: 0.03,
              },
              confidence: 0.8,
            },
          },
        };
      }
      return {
        ...base,
        results: {
          sufficient: {
            type: "noul" as const,
            probabilityYes: 0.9,
            confidence: 0.9,
          },
          quality: {
            type: "score" as const,
            expectedScore: 4.2,
            confidence: 0.74,
          },
        },
      };
    },
  });

test("lab prioritizes high-confidence focus-provider mistakes", async () => {
  const cases = await loadSmoke();
  const replay = new ReplaySystemOneProvider({
    records: replayRecordsFromCases(cases),
  });
  const evidence = await runComparison([replay, layaCandidate()], cases, {
    datasetId: "smoke",
    comparisonId: "compare-lab",
  });

  const lab = buildDisagreementLab(evidence, cases, {
    leftProvider: "replay",
    rightProvider: "laya",
    focusProvider: "laya",
    highConfidenceThreshold: 0.8,
    labId: "lab-test",
  });

  assert.equal(lab.schemaVersion, "mso.disagreement.v0");
  assert.equal(lab.summary.total, 1);
  assert.equal(lab.summary.byPriority.p0, 1);
  assert.equal(lab.summary.byCategory.focus_wrong_high_confidence, 1);
  assert.equal(lab.summary.byTaskFamily["asset.qa"], 1);
  assert.equal(lab.summary.byQuestionType.choice, 1);
  assert.equal(lab.summary.byLanguage.en, 1);
  assert.equal(lab.summary.byTag.asset, 1);
  assert.equal(lab.summary.byTag.smoke, 1);

  const record = lab.records[0];
  assert.ok(record);
  assert.equal(record.caseId, "asset.qa.0001");
  assert.equal(record.questionId, "verdict");
  assert.equal(record.priority, "p0");
  assert.equal(record.category, "focus_wrong_high_confidence");
  assert.equal(record.fineTuneCandidate, true);
  assert.equal(record.candidateUse, "model_error_candidate");
  assert.equal(record.focus.answer, "maybe");
  assert.equal(record.other.answer, "accept");
  assert.equal(record.review.status, "pending");
  assert.match(record.state, /clean silhouette/);
  assert.deepEqual(record.tags, ["asset", "smoke"]);
});

test("lab includes focus provider errors as p0 review work", async () => {
  const cases = await loadSmoke();
  const replay = new ReplaySystemOneProvider({
    records: replayRecordsFromCases(cases),
  });
  const broken = new MockSystemOneProvider({
    id: "laya",
    responder: (request) => {
      if (request.traceId === "eval:qa.severity.0001") {
        throw new Error("checkpoint unavailable");
      }
      const record = replayRecordsFromCases(cases).find(
        (item) => item.traceId === request.traceId,
      );
      if (!record) throw new Error("missing fixture");
      return {
        traceId: request.traceId,
        providerId: "laya",
        probabilitySemantics: "provider_defined" as const,
        confidenceSemantics: "provider_defined" as const,
        calibrationStatus: "unknown" as const,
        results: record.results,
      };
    },
  });

  const evidence = await runComparison([replay, broken], cases, {
    datasetId: "smoke",
    comparisonId: "compare-error",
  });
  const lab = buildDisagreementLab(evidence, cases, {
    leftProvider: "replay",
    rightProvider: "laya",
    focusProvider: "laya",
    labId: "lab-error",
  });

  assert.equal(lab.summary.total, 1);
  assert.equal(lab.summary.byCategory.focus_error, 1);
  assert.equal(lab.records[0]?.priority, "p0");
  assert.equal(lab.records[0]?.candidateUse, "provider_error_review");
  assert.equal(lab.records[0]?.fineTuneCandidate, false);
});

test("writer emits compact summary JSON and one-record-per-line review queue", async () => {
  const cases = await loadSmoke();
  const replay = new ReplaySystemOneProvider({
    records: replayRecordsFromCases(cases),
  });
  const evidence = await runComparison([replay, layaCandidate()], cases, {
    datasetId: "smoke",
    comparisonId: "compare-write",
  });
  const lab = buildDisagreementLab(evidence, cases, {
    leftProvider: "replay",
    rightProvider: "laya",
    focusProvider: "laya",
    labId: "lab-write",
  });

  const dir = await mkdtemp(join(tmpdir(), "mso-lab-"));
  try {
    const summaryPath = join(dir, "summary.json");
    const queuePath = join(dir, "queue.jsonl");
    await writeDisagreementLab(summaryPath, queuePath, lab);

    const summary = JSON.parse(await readFile(summaryPath, "utf8")) as {
      summary: { total: number };
      queuePath: string;
    };
    const queueLines = (await readFile(queuePath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean);

    assert.equal(summary.summary.total, 1);
    assert.equal(summary.queuePath, queuePath);
    assert.equal(queueLines.length, 1);
    const row = JSON.parse(queueLines[0] ?? "{}") as {
      recordId?: string;
      review?: { status?: string };
    };
    assert.match(row.recordId ?? "", /asset\.qa\.0001/);
    assert.equal(row.review?.status, "pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
