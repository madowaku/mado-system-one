import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  DisagreementRecord,
  DisagreementCategory,
} from "../src/eval/disagreement.js";
import {
  buildFineTunePack,
  writeFineTunePack,
  type FineTuneAnnotation,
} from "../src/finetune/candidate.js";
import {
  parseFineTuneAnnotationsJsonl,
} from "../src/finetune/io.js";

const baseRecord = (
  overrides: Partial<DisagreementRecord> & Pick<
    DisagreementRecord,
    "recordId" | "caseId" | "questionId" | "questionType" | "question" | "expected"
  >,
): DisagreementRecord => ({
  recordId: overrides.recordId,
  labId: "lab-1",
  comparisonId: "compare-1",
  datasetId: "fixture",
  caseId: overrides.caseId,
  taskFamily: overrides.taskFamily ?? "asset.qa",
  questionId: overrides.questionId,
  questionType: overrides.questionType,
  state: overrides.state ?? `state for ${overrides.caseId}`,
  question: overrides.question,
  expected: overrides.expected,
  tags: overrides.tags ?? ["reviewed"],
  language: overrides.language ?? "en",
  leftProvider: "replay",
  rightProvider: "laya",
  focusProvider: "laya",
  otherProvider: "replay",
  left: {
    providerId: "replay",
    status: "ok",
    correct: true,
    answer: "baseline",
    confidence: 0.9,
  },
  right: {
    providerId: "laya",
    status: "ok",
    correct: false,
    answer: "candidate",
    confidence: 0.9,
  },
  focus: {
    providerId: "laya",
    status: "ok",
    correct: false,
    answer: "candidate",
    confidence: 0.9,
  },
  other: {
    providerId: "replay",
    status: "ok",
    correct: true,
    answer: "baseline",
    confidence: 0.9,
  },
  pair: {
    left: "replay",
    right: "laya",
    comparable: true,
    agreement: false,
    correctness: "left_only",
  },
  priority: overrides.priority ?? "p0",
  category:
    overrides.category ??
    ("focus_wrong_high_confidence" satisfies DisagreementCategory),
  fineTuneCandidate: overrides.fineTuneCandidate ?? true,
  candidateUse: overrides.candidateUse ?? "model_error_candidate",
  review: { status: "pending" },
});

const records: DisagreementRecord[] = [
  baseRecord({
    recordId: "case-a:verdict",
    caseId: "case-a",
    questionId: "verdict",
    questionType: "choice",
    question: {
      type: "choice",
      prompt: "Choose verdict.",
      options: [
        { id: "accept", label: "Accept", description: "ready" },
        { id: "reject", label: "Reject", description: "discard" },
      ],
    },
    expected: { type: "choice", selected: "accept" },
  }),
  baseRecord({
    recordId: "case-a:sufficient",
    caseId: "case-a",
    questionId: "sufficient",
    questionType: "noul",
    question: {
      type: "noul",
      prompt: "Is evidence sufficient?",
    },
    expected: { type: "noul", yes: true },
  }),
  baseRecord({
    recordId: "case-b:verdict",
    caseId: "case-b",
    questionId: "verdict",
    questionType: "choice",
    question: {
      type: "choice",
      prompt: "Choose verdict.",
      options: [
        { id: "accept", label: "Accept" },
        { id: "reject", label: "Reject" },
      ],
    },
    expected: { type: "choice", selected: "reject" },
  }),
  baseRecord({
    recordId: "case-c:quality",
    caseId: "case-c",
    taskFamily: "evidence.quality",
    questionId: "quality",
    questionType: "score",
    question: {
      type: "score",
      prompt: "Score quality.",
      min: 1,
      max: 5,
    },
    expected: { type: "score", value: 4, tolerance: 1 },
  }),
];

const annotations: FineTuneAnnotation[] = [
  {
    schemaVersion: "mso.finetune-annotation.v0",
    recordId: "case-a:verdict",
    decision: "include",
    reviewedLabel: "accept",
    labelSource: "human",
    reviewedAt: "2026-10-02T00:00:00.000Z",
    softTarget: {
      type: "choice",
      probabilities: { accept: 0.8, reject: 0.2 },
      source: "teacher",
      sourceRef: "teacher-run-1",
    },
  },
  {
    schemaVersion: "mso.finetune-annotation.v0",
    recordId: "case-a:sufficient",
    decision: "include",
    reviewedLabel: true,
    labelSource: "human",
    reviewedAt: "2026-10-02T00:01:00.000Z",
    softTarget: {
      type: "noul",
      probabilities: { false: 0.1, true: 0.9 },
      source: "teacher",
    },
  },
  {
    schemaVersion: "mso.finetune-annotation.v0",
    recordId: "case-b:verdict",
    decision: "include",
    reviewedLabel: "reject",
    labelSource: "verified_outcome",
    reviewedAt: "2026-10-02T00:02:00.000Z",
    softTarget: {
      type: "choice",
      probabilities: { accept: 0.15, reject: 0.85 },
      source: "verified_outcome",
    },
  },
  {
    schemaVersion: "mso.finetune-annotation.v0",
    recordId: "case-c:quality",
    decision: "include",
    reviewedLabel: 4,
    labelSource: "human",
    reviewedAt: "2026-10-02T00:03:00.000Z",
    softTarget: {
      type: "score",
      distribution: [0.02, 0.05, 0.13, 0.65, 0.15],
      source: "teacher",
    },
  },
];

test("candidate compiler emits Laya {state,questions,gold} soft-target cases", () => {
  const pack = buildFineTunePack(records, annotations, {
    packId: "pack-test",
    validationFraction: 0.25,
    splitSeed: "stable",
  });

  assert.equal(pack.manifest.recipe, "laya-rlcd-soft-targets");
  assert.equal(pack.manifest.counts.trainingReadyRecords, 4);
  assert.equal(pack.manifest.counts.trainingReadyCases, 3);
  assert.equal(pack.manifest.counts.heldRecords, 0);
  assert.equal(pack.manifest.byQuestionType.choice, 2);
  assert.equal(pack.manifest.byQuestionType.noul, 1);
  assert.equal(pack.manifest.byQuestionType.score, 1);

  const all = [...pack.train, ...pack.validation];
  const caseA = all.find((item) => item._mado.caseId === "case-a");
  assert.ok(caseA);
  assert.deepEqual(caseA._mado.recordIds, ["case-a:sufficient", "case-a:verdict"]);
  assert.deepEqual(caseA.questions.verdict, {
    type: "choice",
    instructions: "Choose verdict.",
    criteria: { accept: "ready", reject: "discard" },
  });
  assert.deepEqual(caseA.gold.verdict, {
    label: "accept",
    probabilities: { accept: 0.8, reject: 0.2 },
  });
  assert.deepEqual(caseA.gold.sufficient, {
    label: "true",
    probabilities: { false: 0.1, true: 0.9 },
  });

  const caseC = all.find((item) => item._mado.caseId === "case-c");
  assert.ok(caseC);
  assert.deepEqual(caseC.questions.quality, {
    type: "score",
    instructions: "Score quality.",
    criteria: ["1", "2", "3", "4", "5"],
  });
  assert.deepEqual(caseC.gold.quality, {
    label: 3,
    probabilities: {
      "0": 0.02,
      "1": 0.05,
      "2": 0.13,
      "3": 0.65,
      "4": 0.15,
    },
  });
});

test("caseId grouping prevents train/validation leakage", () => {
  const pack = buildFineTunePack(records, annotations, {
    validationFraction: 0.25,
    splitSeed: "stable",
  });

  const trainIds = new Set(pack.train.map((item) => item._mado.caseId));
  const validationIds = new Set(pack.validation.map((item) => item._mado.caseId));
  for (const id of trainIds) assert.equal(validationIds.has(id), false);

  const assetCases = [...pack.train, ...pack.validation].filter(
    (item) => item._mado.taskFamily === "asset.qa",
  );
  assert.equal(assetCases.length, 2);
  assert.equal(
    pack.validation.filter((item) => item._mado.taskFamily === "asset.qa").length,
    1,
  );
});

test("hard-reviewed records without soft targets are held, not one-hot encoded", () => {
  const pack = buildFineTunePack(
    [records[0]!],
    [
      {
        schemaVersion: "mso.finetune-annotation.v0",
        recordId: "case-a:verdict",
        decision: "include",
        reviewedLabel: "accept",
        labelSource: "human",
      },
    ],
  );

  assert.equal(pack.manifest.counts.trainingReadyRecords, 0);
  assert.equal(pack.manifest.heldByReason.missing_soft_target, 1);
  assert.equal(pack.held[0]?.reason, "missing_soft_target");
});

test("soft target whose argmax contradicts reviewed label is held", () => {
  const pack = buildFineTunePack(
    [records[0]!],
    [
      {
        schemaVersion: "mso.finetune-annotation.v0",
        recordId: "case-a:verdict",
        decision: "include",
        reviewedLabel: "accept",
        labelSource: "human",
        softTarget: {
          type: "choice",
          probabilities: { accept: 0.1, reject: 0.9 },
          source: "teacher",
        },
      },
    ],
  );

  assert.equal(pack.manifest.heldByReason.soft_target_argmax_mismatch, 1);
  assert.equal(pack.train.length, 0);
});

test("writer emits train, validation, held and manifest artifacts", async () => {
  const pack = buildFineTunePack(records, annotations, {
    packId: "pack-write",
    validationFraction: 0.25,
    splitSeed: "stable",
  });
  const dir = await mkdtemp(join(tmpdir(), "mso-finetune-"));

  try {
    await writeFineTunePack(dir, pack);
    const manifest = JSON.parse(
      await readFile(join(dir, "manifest.json"), "utf8"),
    ) as { packId?: string; counts?: { trainingReadyRecords?: number } };
    const trainText = await readFile(join(dir, "train.jsonl"), "utf8");
    const validationText = await readFile(join(dir, "validation.jsonl"), "utf8");
    const heldText = await readFile(join(dir, "held.jsonl"), "utf8");

    assert.equal(manifest.packId, "pack-write");
    assert.equal(manifest.counts?.trainingReadyRecords, 4);
    assert.match(trainText + validationText, /"gold"/);
    assert.equal(heldText, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("annotation parser rejects duplicate record ids", () => {
  const line = JSON.stringify(annotations[0]);
  assert.throws(
    () => parseFineTuneAnnotationsJsonl(`${line}\n${line}\n`),
    /duplicate fine-tune annotation/,
  );
});
