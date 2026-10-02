import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TypedQuestion } from "../core/types.js";
import type { DisagreementRecord } from "../eval/disagreement.js";
import { toLayaQuestions, type LayaQuestionDef } from "../providers/laya.js";

export type FineTuneLabel = string | boolean | number;

export type SoftTarget =
  | {
      type: "choice";
      probabilities: Readonly<Record<string, number>>;
      source: "teacher" | "human" | "verified_outcome" | "deterministic_invariant";
      sourceRef?: string;
    }
  | {
      type: "noul";
      probabilities: Readonly<{ false: number; true: number }>;
      source: "teacher" | "human" | "verified_outcome" | "deterministic_invariant";
      sourceRef?: string;
    }
  | {
      type: "score";
      distribution: readonly number[];
      source: "teacher" | "human" | "verified_outcome" | "deterministic_invariant";
      sourceRef?: string;
    };

export interface FineTuneAnnotation {
  schemaVersion: "mso.finetune-annotation.v0";
  recordId: string;
  decision: "include" | "exclude";
  reviewedLabel?: FineTuneLabel;
  labelSource?: "human" | "verified_outcome" | "deterministic_invariant";
  reviewedAt?: string;
  reviewer?: string;
  softTarget?: SoftTarget;
  note?: string;
}

export type HeldReason =
  | "source_not_finetune_candidate"
  | "missing_annotation"
  | "annotation_excluded"
  | "missing_reviewed_label"
  | "missing_soft_target"
  | "soft_target_type_mismatch"
  | "soft_target_argmax_mismatch";

export interface HeldCandidate {
  recordId: string;
  caseId: string;
  taskFamily: string;
  questionId: string;
  reason: HeldReason;
}

export interface LayaGoldQuestion {
  label: string | number | boolean;
  probabilities: Readonly<Record<string, number>>;
}

export interface LayaFineTuneCase {
  state: string;
  questions: Readonly<Record<string, LayaQuestionDef>>;
  gold: Readonly<Record<string, LayaGoldQuestion>>;
  _mado: {
    caseId: string;
    taskFamily: string;
    recordIds: readonly string[];
    tags: readonly string[];
    language?: string;
  };
}

export interface FineTunePackOptions {
  packId?: string;
  validationFraction?: number;
  splitSeed?: string;
}

export interface FineTunePackManifest {
  schemaVersion: "mso.finetune-pack.v0";
  packId: string;
  createdAt: string;
  recipe: "laya-rlcd-soft-targets";
  layaDatasetSchema: "{state,questions,gold}";
  calibration: {
    owner: "laya-trainer";
    note: string;
  };
  split: {
    grouping: "caseId";
    stratify: "taskFamily";
    seed: string;
    validationFraction: number;
  };
  counts: {
    sourceRecords: number;
    trainingReadyRecords: number;
    heldRecords: number;
    trainingReadyCases: number;
    trainCases: number;
    validationCases: number;
  };
  heldByReason: Readonly<Record<HeldReason, number>>;
  byQuestionType: Readonly<Record<string, number>>;
  byTaskFamily: Readonly<Record<string, number>>;
  bySoftTargetSource: Readonly<Record<string, number>>;
  artifacts: {
    train: "train.jsonl";
    validation: "validation.jsonl";
    held: "held.jsonl";
    manifest: "manifest.json";
  };
  next: {
    trainingInput: "train.jsonl";
    holdoutInput: "validation.jsonl";
    note: string;
  };
}

export interface FineTunePack {
  manifest: FineTunePackManifest;
  train: readonly LayaFineTuneCase[];
  validation: readonly LayaFineTuneCase[];
  held: readonly HeldCandidate[];
}

interface ReadyRecord {
  source: DisagreementRecord;
  annotation: FineTuneAnnotation;
  question: LayaQuestionDef;
  gold: LayaGoldQuestion;
  softTargetSource: SoftTarget["source"];
}

const count = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1;
};

const probability = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite probability in [0,1]`);
  }
  return value;
};

const normalizeObject = (
  values: Readonly<Record<string, number>>,
  keys: readonly string[],
  label: string,
): Record<string, number> => {
  const allowed = new Set(keys);
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} contains unknown key: ${key}`);
    }
  }
  const out: Record<string, number> = {};
  let total = 0;
  for (const key of keys) {
    const value = probability(values[key] ?? 0, `${label}.${key}`);
    out[key] = value;
    total += value;
  }
  if (total <= 0) throw new Error(`${label} must contain positive probability mass`);
  for (const key of keys) out[key] = (out[key] ?? 0) / total;
  return out;
};

const normalizeArray = (
  values: readonly number[],
  expectedLength: number,
  label: string,
): number[] => {
  if (values.length !== expectedLength) {
    throw new Error(
      `${label} length must be ${expectedLength}; got ${values.length}`,
    );
  }
  const checked = values.map((value, index) =>
    probability(value, `${label}[${index}]`),
  );
  const total = checked.reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new Error(`${label} must contain positive probability mass`);
  return checked.map((value) => value / total);
};

const argmax = (values: readonly number[]): number => {
  let best = 0;
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index] ?? -1) > (values[best] ?? -1)) best = index;
  }
  return best;
};

const labelMatches = (
  question: TypedQuestion,
  reviewedLabel: FineTuneLabel,
  gold: LayaGoldQuestion,
): boolean => {
  if (question.type === "choice") {
    if (typeof reviewedLabel !== "string") return false;
    const entries = question.options.map((option) => [
      option.id,
      gold.probabilities[option.id] ?? 0,
    ] as const);
    const best = entries[argmax(entries.map((item) => item[1]))];
    return best?.[0] === reviewedLabel;
  }

  if (question.type === "noul") {
    if (typeof reviewedLabel !== "boolean") return false;
    const predicted =
      (gold.probabilities.true ?? 0) >= (gold.probabilities.false ?? 0);
    return predicted === reviewedLabel;
  }

  if (typeof reviewedLabel !== "number" || !Number.isFinite(reviewedLabel)) {
    return false;
  }
  const keys = Array.from(
    { length: question.max - question.min + 1 },
    (_, index) => String(index),
  );
  const bestIndex = argmax(keys.map((key) => gold.probabilities[key] ?? 0));
  const nearestReviewed = Math.max(
    question.min,
    Math.min(question.max, Math.round(reviewedLabel)),
  );
  return question.min + bestIndex === nearestReviewed;
};

const buildGold = (
  record: DisagreementRecord,
  annotation: FineTuneAnnotation,
): { gold?: LayaGoldQuestion; reason?: HeldReason; source?: SoftTarget["source"] } => {
  const soft = annotation.softTarget;
  if (!soft) return { reason: "missing_soft_target" };
  if (soft.type !== record.question.type) {
    return { reason: "soft_target_type_mismatch" };
  }

  const question = record.question;
  if (question.type === "choice" && soft.type === "choice") {
    const keys = question.options.map((option) => option.id);
    const probabilities = normalizeObject(
      soft.probabilities,
      keys,
      `${record.recordId}.softTarget.probabilities`,
    );
    return {
      gold: {
        label: String(annotation.reviewedLabel),
        probabilities,
      },
      source: soft.source,
    };
  }

  if (question.type === "noul" && soft.type === "noul") {
    const probabilities = normalizeObject(
      soft.probabilities,
      ["false", "true"],
      `${record.recordId}.softTarget.probabilities`,
    );
    return {
      gold: {
        label: annotation.reviewedLabel === true ? "true" : "false",
        probabilities,
      },
      source: soft.source,
    };
  }

  if (question.type === "score" && soft.type === "score") {
    if (!Number.isInteger(question.min) || !Number.isInteger(question.max)) {
      throw new Error(
        `${record.recordId} score question requires integer bounds for Laya fine-tuning`,
      );
    }
    const levelCount = question.max - question.min + 1;
    const distribution = normalizeArray(
      soft.distribution,
      levelCount,
      `${record.recordId}.softTarget.distribution`,
    );
    const probabilities = Object.fromEntries(
      distribution.map((value, index) => [String(index), value]),
    );
    return {
      gold: {
        label: argmax(distribution),
        probabilities,
      },
      source: soft.source,
    };
  }

  return { reason: "soft_target_type_mismatch" };
};

const hold = (
  record: DisagreementRecord,
  reason: HeldReason,
): HeldCandidate => ({
  recordId: record.recordId,
  caseId: record.caseId,
  taskFamily: record.taskFamily,
  questionId: record.questionId,
  reason,
});

const toReady = (
  record: DisagreementRecord,
  annotation: FineTuneAnnotation | undefined,
): { ready?: ReadyRecord; held?: HeldCandidate } => {
  if (!record.fineTuneCandidate) {
    return { held: hold(record, "source_not_finetune_candidate") };
  }
  if (!annotation) return { held: hold(record, "missing_annotation") };
  if (annotation.decision === "exclude") {
    return { held: hold(record, "annotation_excluded") };
  }
  if (annotation.reviewedLabel === undefined) {
    return { held: hold(record, "missing_reviewed_label") };
  }

  const built = buildGold(record, annotation);
  if (!built.gold || !built.source) {
    return { held: hold(record, built.reason ?? "missing_soft_target") };
  }
  if (!labelMatches(record.question, annotation.reviewedLabel, built.gold)) {
    return { held: hold(record, "soft_target_argmax_mismatch") };
  }

  const layaQuestion = toLayaQuestions({
    [record.questionId]: record.question,
  })[record.questionId];
  if (!layaQuestion) {
    throw new Error(`failed to translate question for ${record.recordId}`);
  }
  return {
    ready: {
      source: record,
      annotation,
      question: layaQuestion,
      gold: built.gold,
      softTargetSource: built.source,
    },
  };
};

const stableScore = (seed: string, value: string): string =>
  createHash("sha256").update(seed).update("\0").update(value).digest("hex");

const splitCases = (
  cases: readonly LayaFineTuneCase[],
  validationFraction: number,
  seed: string,
): { train: LayaFineTuneCase[]; validation: LayaFineTuneCase[] } => {
  const byFamily = new Map<string, LayaFineTuneCase[]>();
  for (const item of cases) {
    const family = item._mado.taskFamily;
    byFamily.set(family, [...(byFamily.get(family) ?? []), item]);
  }

  const train: LayaFineTuneCase[] = [];
  const validation: LayaFineTuneCase[] = [];
  for (const [family, group] of [...byFamily.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const sorted = [...group].sort((a, b) =>
      stableScore(seed, `${family}:${a._mado.caseId}`).localeCompare(
        stableScore(seed, `${family}:${b._mado.caseId}`),
      ),
    );
    const validationCount =
      sorted.length < 2
        ? 0
        : Math.min(
            sorted.length - 1,
            Math.max(1, Math.round(sorted.length * validationFraction)),
          );
    validation.push(...sorted.slice(0, validationCount));
    train.push(...sorted.slice(validationCount));
  }

  return {
    train: train.sort((a, b) => a._mado.caseId.localeCompare(b._mado.caseId)),
    validation: validation.sort((a, b) =>
      a._mado.caseId.localeCompare(b._mado.caseId),
    ),
  };
};

const aggregateCases = (ready: readonly ReadyRecord[]): LayaFineTuneCase[] => {
  const groups = new Map<string, ReadyRecord[]>();
  for (const item of ready) {
    groups.set(item.source.caseId, [...(groups.get(item.source.caseId) ?? []), item]);
  }

  const cases: LayaFineTuneCase[] = [];
  for (const [caseId, rows] of groups) {
    const first = rows[0];
    if (!first) continue;
    for (const row of rows) {
      if (
        row.source.state !== first.source.state ||
        row.source.taskFamily !== first.source.taskFamily
      ) {
        throw new Error(`case ${caseId} has inconsistent state or taskFamily`);
      }
    }

    const questions: Record<string, LayaQuestionDef> = {};
    const gold: Record<string, LayaGoldQuestion> = {};
    for (const row of rows) {
      if (questions[row.source.questionId]) {
        throw new Error(
          `case ${caseId} contains duplicate questionId ${row.source.questionId}`,
        );
      }
      questions[row.source.questionId] = row.question;
      gold[row.source.questionId] = row.gold;
    }

    const tags = [...new Set(rows.flatMap((row) => row.source.tags))].sort();
    const language = first.source.language;
    cases.push({
      state: first.source.state,
      questions,
      gold,
      _mado: {
        caseId,
        taskFamily: first.source.taskFamily,
        recordIds: rows.map((row) => row.source.recordId).sort(),
        tags,
        ...(language ? { language } : {}),
      },
    });
  }
  return cases;
};

export const buildFineTunePack = (
  records: readonly DisagreementRecord[],
  annotations: readonly FineTuneAnnotation[],
  options: FineTunePackOptions = {},
): FineTunePack => {
  const validationFraction = options.validationFraction ?? 0.2;
  if (
    !Number.isFinite(validationFraction) ||
    validationFraction <= 0 ||
    validationFraction >= 0.5
  ) {
    throw new Error("validationFraction must be > 0 and < 0.5");
  }
  const splitSeed = options.splitSeed ?? "mso-laya-finetune-v0";

  const annotationMap = new Map<string, FineTuneAnnotation>();
  for (const annotation of annotations) {
    if (annotationMap.has(annotation.recordId)) {
      throw new Error(`duplicate fine-tune annotation: ${annotation.recordId}`);
    }
    annotationMap.set(annotation.recordId, annotation);
  }

  const ready: ReadyRecord[] = [];
  const held: HeldCandidate[] = [];
  for (const record of records) {
    const result = toReady(record, annotationMap.get(record.recordId));
    if (result.ready) ready.push(result.ready);
    if (result.held) held.push(result.held);
  }

  const cases = aggregateCases(ready);
  const split = splitCases(cases, validationFraction, splitSeed);
  const heldByReason = {
    source_not_finetune_candidate: 0,
    missing_annotation: 0,
    annotation_excluded: 0,
    missing_reviewed_label: 0,
    missing_soft_target: 0,
    soft_target_type_mismatch: 0,
    soft_target_argmax_mismatch: 0,
  } satisfies Record<HeldReason, number>;
  for (const item of held) heldByReason[item.reason] += 1;

  const byQuestionType: Record<string, number> = {};
  const byTaskFamily: Record<string, number> = {};
  const bySoftTargetSource: Record<string, number> = {};
  for (const item of ready) {
    count(byQuestionType, item.source.questionType);
    count(byTaskFamily, item.source.taskFamily);
    count(bySoftTargetSource, item.softTargetSource);
  }

  const started = new Date();
  const packId =
    options.packId ?? `finetune-${started.toISOString().replace(/[:.]/g, "-")}`;
  return {
    manifest: {
      schemaVersion: "mso.finetune-pack.v0",
      packId,
      createdAt: started.toISOString(),
      recipe: "laya-rlcd-soft-targets",
      layaDatasetSchema: "{state,questions,gold}",
      calibration: {
        owner: "laya-trainer",
        note:
          "Laya fine-tune trainer holds out its own calibration slice from train.jsonl; validation.jsonl must remain untouched for post-training evaluation.",
      },
      split: {
        grouping: "caseId",
        stratify: "taskFamily",
        seed: splitSeed,
        validationFraction,
      },
      counts: {
        sourceRecords: records.length,
        trainingReadyRecords: ready.length,
        heldRecords: held.length,
        trainingReadyCases: cases.length,
        trainCases: split.train.length,
        validationCases: split.validation.length,
      },
      heldByReason,
      byQuestionType,
      byTaskFamily,
      bySoftTargetSource,
      artifacts: {
        train: "train.jsonl",
        validation: "validation.jsonl",
        held: "held.jsonl",
        manifest: "manifest.json",
      },
      next: {
        trainingInput: "train.jsonl",
        holdoutInput: "validation.jsonl",
        note:
          "Train only on train.jsonl, keep validation.jsonl fully held out, fit calibration on the trainer-owned calibration slice, then evaluate the new checkpoint before any promotion decision.",
      },
    },
    train: split.train,
    validation: split.validation,
    held: held.sort((a, b) => a.recordId.localeCompare(b.recordId)),
  };
};

const jsonl = (rows: readonly unknown[]): string =>
  rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

export const writeFineTunePack = async (
  outDir: string,
  pack: FineTunePack,
): Promise<void> => {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(join(outDir, "train.jsonl"), jsonl(pack.train), "utf8"),
    writeFile(join(outDir, "validation.jsonl"), jsonl(pack.validation), "utf8"),
    writeFile(join(outDir, "held.jsonl"), jsonl(pack.held), "utf8"),
    writeFile(
      join(outDir, "manifest.json"),
      `${JSON.stringify(pack.manifest, null, 2)}\n`,
      "utf8",
    ),
  ]);
};
