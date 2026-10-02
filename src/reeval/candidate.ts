import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SystemOneProvider } from "../core/provider.js";
import type { TypedResult } from "../core/types.js";
import {
  parseEvalJsonl,
  runEval,
  type EvalCase,
  type EvalCaseResult,
  type EvalRun,
} from "../eval/skeleton.js";
import type { LayaFineTuneCase } from "../finetune/candidate.js";
import type { LayaCheckpointFingerprint } from "./checkpoint.js";

export type ReevalOutcome =
  | "improved"
  | "regressed"
  | "stable_correct"
  | "stable_wrong"
  | "candidate_error"
  | "base_error"
  | "both_error";

export interface ReevalAnswerState {
  status: "ok" | "error";
  correct: boolean;
  confidence?: number;
  error?: string;
}

export interface ReevalQuestionRow {
  caseId: string;
  taskFamily: string;
  questionId: string;
  questionType: "choice" | "noul" | "score";
  tags: readonly string[];
  language?: string;
  base: ReevalAnswerState;
  candidate: ReevalAnswerState;
  outcome: ReevalOutcome;
  improvement: boolean;
  regression: boolean;
}

export interface ConfidenceCalibrationSummary {
  questions: number;
  withConfidence: number;
  coverage: number;
  accuracyOnCovered: number;
  meanConfidence: number;
  brier: number;
  ece10: number;
}

export interface ReevalProviderSummary {
  providerId: string;
  cases: number;
  questions: number;
  accuracy: number;
  caseAccuracy: number;
  providerErrors: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  totalEstimatedCost: number;
  confidenceCalibration: ConfidenceCalibrationSummary;
}

export interface ReevalMetricDelta {
  accuracy: number;
  caseAccuracy: number;
  providerErrors: number;
  latencyP95Ms: number;
  ece10: number;
}

export interface ReevalPairSummary {
  leftProviderId: string;
  rightProviderId: string;
  questions: number;
  improved: number;
  regressed: number;
  stableCorrect: number;
  stableWrong: number;
  candidateErrors: number;
  baseErrors: number;
  bothErrors: number;
}

export interface ReevalSliceSummary {
  dimension: "overall" | "taskFamily" | "questionType" | "language" | "tag";
  value: string;
  questions: number;
  baseCorrect: number;
  candidateCorrect: number;
  baseAccuracy: number;
  candidateAccuracy: number;
  accuracyDelta: number;
  improvements: number;
  regressions: number;
  candidateErrors: number;
}

export interface CandidateReevalOptions {
  reevalId?: string;
  datasetId: string;
  baseCheckpoint: LayaCheckpointFingerprint;
  candidateCheckpoint: LayaCheckpointFingerprint;
  incumbentRun?: EvalRun;
}

export interface CandidateReevalEvidence {
  schemaVersion: "mso.reeval.v0";
  reevalId: string;
  createdAt: string;
  datasetId: string;
  baseProviderId: string;
  candidateProviderId: string;
  baseCheckpoint: LayaCheckpointFingerprint;
  candidateCheckpoint: LayaCheckpointFingerprint;
  providers: {
    base: ReevalProviderSummary;
    candidate: ReevalProviderSummary;
    incumbent?: ReevalProviderSummary;
  };
  deltas: {
    candidateVsBase: ReevalMetricDelta;
    candidateVsIncumbent?: ReevalMetricDelta;
  };
  pairs: readonly ReevalPairSummary[];
  slices: readonly ReevalSliceSummary[];
  regressionCount: number;
  improvementCount: number;
  hasRegression: boolean;
  artifacts: {
    summary: "summary.json";
    baseEval: "base.eval.json";
    candidateEval: "candidate.eval.json";
    incumbentEval?: "incumbent.eval.json";
    validationFixture: "validation.eval.jsonl";
    regressions: "regressions.jsonl";
  };
  promotionInput: {
    candidateEval: "candidate.eval.json";
    note: string;
  };
}

export interface CandidateReevalResult {
  evidence: CandidateReevalEvidence;
  baseRun: EvalRun;
  candidateRun: EvalRun;
  incumbentRun?: EvalRun;
  validationCases: readonly EvalCase[];
  rows: readonly ReevalQuestionRow[];
  regressions: readonly ReevalQuestionRow[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseFineTuneValidationJsonl = (input: string): EvalCase[] => {
  const synthetic: string[] = [];

  for (const [index, raw] of input.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`validation line ${index + 1} is invalid JSON`);
    }
    if (!record(value) || !record(value._mado)) {
      throw new Error(`validation line ${index + 1} is missing _mado metadata`);
    }
    const meta = value._mado;
    if (!record(meta.evaluation)) {
      throw new Error(
        `validation line ${index + 1} lacks _mado.evaluation; regenerate the M0.6 fine-tune pack`,
      );
    }
    const evaluation = meta.evaluation;
    if (!record(evaluation.questions) || !record(evaluation.expected)) {
      throw new Error(
        `validation line ${index + 1} has invalid _mado.evaluation contract`,
      );
    }

    synthetic.push(
      JSON.stringify({
        caseId: meta.caseId,
        taskFamily: meta.taskFamily,
        pattern: evaluation.pattern,
        state: value.state,
        questions: evaluation.questions,
        expected: evaluation.expected,
        ...(Array.isArray(meta.tags) ? { tags: meta.tags } : {}),
        ...(typeof meta.language === "string" ? { language: meta.language } : {}),
      }),
    );
  }

  if (synthetic.length === 0) {
    throw new Error("validation dataset contains no cases");
  }
  return parseEvalJsonl(synthetic.join("\n"));
};

const confidenceOf = (result: TypedResult | undefined): number | undefined =>
  result?.confidence;

const caseMap = (run: EvalRun): Map<string, EvalCaseResult> =>
  new Map(run.cases.map((row) => [row.caseId, row]));

const assertCoverage = (run: EvalRun, cases: readonly EvalCase[]): void => {
  const rows = caseMap(run);
  for (const item of cases) {
    const row = rows.get(item.caseId);
    if (!row) {
      throw new Error(
        `eval run ${run.providerId} missing validation case ${item.caseId}`,
      );
    }
    const judgementIds = new Set(row.judgements.map((j) => j.questionId));
    for (const questionId of Object.keys(item.questions)) {
      if (!judgementIds.has(questionId)) {
        throw new Error(
          `eval run ${run.providerId} missing question ${item.caseId}/${questionId}`,
        );
      }
    }
  }
};

const answerState = (
  row: EvalCaseResult,
  questionId: string,
): ReevalAnswerState => {
  const judgement = row.judgements.find((item) => item.questionId === questionId);
  if (!judgement) {
    return {
      status: "error",
      correct: false,
      error: "missing judgement",
    };
  }
  if (row.error) {
    return {
      status: "error",
      correct: false,
      error: row.error,
    };
  }
  const confidence = confidenceOf(row.response?.results[questionId]);
  return {
    status: "ok",
    correct: judgement.correct,
    ...(confidence === undefined ? {} : { confidence }),
  };
};

const outcomeFor = (
  base: ReevalAnswerState,
  candidate: ReevalAnswerState,
): ReevalOutcome => {
  if (base.status === "error" && candidate.status === "error") return "both_error";
  if (candidate.status === "error") return "candidate_error";
  if (base.status === "error") return "base_error";
  if (!base.correct && candidate.correct) return "improved";
  if (base.correct && !candidate.correct) return "regressed";
  return base.correct ? "stable_correct" : "stable_wrong";
};

const rowsForPair = (
  cases: readonly EvalCase[],
  baseRun: EvalRun,
  candidateRun: EvalRun,
): ReevalQuestionRow[] => {
  assertCoverage(baseRun, cases);
  assertCoverage(candidateRun, cases);
  const baseCases = caseMap(baseRun);
  const candidateCases = caseMap(candidateRun);
  const rows: ReevalQuestionRow[] = [];

  for (const item of cases) {
    const baseCase = baseCases.get(item.caseId);
    const candidateCase = candidateCases.get(item.caseId);
    if (!baseCase || !candidateCase) continue;

    for (const [questionId, question] of Object.entries(item.questions)) {
      const base = answerState(baseCase, questionId);
      const candidate = answerState(candidateCase, questionId);
      const outcome = outcomeFor(base, candidate);
      rows.push({
        caseId: item.caseId,
        taskFamily: item.taskFamily,
        questionId,
        questionType: question.type,
        tags: item.tags ?? [],
        ...(item.language ? { language: item.language } : {}),
        base,
        candidate,
        outcome,
        improvement:
          candidate.status === "ok" &&
          candidate.correct &&
          (base.status === "error" || !base.correct),
        regression:
          base.status === "ok" &&
          base.correct &&
          (candidate.status === "error" || !candidate.correct),
      });
    }
  }
  return rows;
};

const confidenceCalibration = (
  run: EvalRun,
  cases: readonly EvalCase[],
): ConfidenceCalibrationSummary => {
  assertCoverage(run, cases);
  const rows = caseMap(run);
  const points: Array<{ confidence: number; correct: number }> = [];
  let questions = 0;

  for (const item of cases) {
    const row = rows.get(item.caseId);
    if (!row) continue;
    for (const questionId of Object.keys(item.questions)) {
      questions += 1;
      const judgement = row.judgements.find((j) => j.questionId === questionId);
      const confidence = confidenceOf(row.response?.results[questionId]);
      if (!judgement || confidence === undefined) continue;
      points.push({ confidence, correct: judgement.correct ? 1 : 0 });
    }
  }

  if (points.length === 0) {
    return {
      questions,
      withConfidence: 0,
      coverage: 0,
      accuracyOnCovered: 0,
      meanConfidence: 0,
      brier: 0,
      ece10: 0,
    };
  }

  const meanConfidence =
    points.reduce((sum, point) => sum + point.confidence, 0) / points.length;
  const accuracyOnCovered =
    points.reduce((sum, point) => sum + point.correct, 0) / points.length;
  const brier =
    points.reduce(
      (sum, point) => sum + (point.confidence - point.correct) ** 2,
      0,
    ) / points.length;

  let ece10 = 0;
  for (let bin = 0; bin < 10; bin += 1) {
    const lo = bin / 10;
    const hi = (bin + 1) / 10;
    const selected = points.filter((point) =>
      bin === 9
        ? point.confidence >= lo && point.confidence <= hi
        : point.confidence >= lo && point.confidence < hi,
    );
    if (selected.length === 0) continue;
    const binConfidence =
      selected.reduce((sum, point) => sum + point.confidence, 0) /
      selected.length;
    const binAccuracy =
      selected.reduce((sum, point) => sum + point.correct, 0) / selected.length;
    ece10 +=
      (selected.length / points.length) * Math.abs(binAccuracy - binConfidence);
  }

  return {
    questions,
    withConfidence: points.length,
    coverage: points.length / questions,
    accuracyOnCovered,
    meanConfidence,
    brier,
    ece10,
  };
};

const summarizeRun = (
  run: EvalRun,
  cases: readonly EvalCase[],
): ReevalProviderSummary => ({
  providerId: run.providerId,
  cases: run.metrics.cases,
  questions: run.metrics.questions,
  accuracy: run.metrics.accuracy,
  caseAccuracy: run.metrics.caseAccuracy,
  providerErrors: run.metrics.providerErrors,
  latencyP50Ms: run.metrics.latencyP50Ms,
  latencyP95Ms: run.metrics.latencyP95Ms,
  totalEstimatedCost: run.metrics.totalEstimatedCost,
  confidenceCalibration: confidenceCalibration(run, cases),
});

const delta = (
  candidate: ReevalProviderSummary,
  baseline: ReevalProviderSummary,
): ReevalMetricDelta => ({
  accuracy: candidate.accuracy - baseline.accuracy,
  caseAccuracy: candidate.caseAccuracy - baseline.caseAccuracy,
  providerErrors: candidate.providerErrors - baseline.providerErrors,
  latencyP95Ms: candidate.latencyP95Ms - baseline.latencyP95Ms,
  ece10:
    candidate.confidenceCalibration.ece10 -
    baseline.confidenceCalibration.ece10,
});

const pairSummary = (
  leftProviderId: string,
  rightProviderId: string,
  rows: readonly ReevalQuestionRow[],
): ReevalPairSummary => ({
  leftProviderId,
  rightProviderId,
  questions: rows.length,
  improved: rows.filter((row) => row.improvement).length,
  regressed: rows.filter((row) => row.regression).length,
  stableCorrect: rows.filter((row) => row.outcome === "stable_correct").length,
  stableWrong: rows.filter((row) => row.outcome === "stable_wrong").length,
  candidateErrors: rows.filter((row) => row.outcome === "candidate_error").length,
  baseErrors: rows.filter((row) => row.outcome === "base_error").length,
  bothErrors: rows.filter((row) => row.outcome === "both_error").length,
});

const summarizeSlice = (
  dimension: ReevalSliceSummary["dimension"],
  value: string,
  rows: readonly ReevalQuestionRow[],
): ReevalSliceSummary => {
  const baseCorrect = rows.filter(
    (row) => row.base.status === "ok" && row.base.correct,
  ).length;
  const candidateCorrect = rows.filter(
    (row) => row.candidate.status === "ok" && row.candidate.correct,
  ).length;
  return {
    dimension,
    value,
    questions: rows.length,
    baseCorrect,
    candidateCorrect,
    baseAccuracy: rows.length === 0 ? 0 : baseCorrect / rows.length,
    candidateAccuracy: rows.length === 0 ? 0 : candidateCorrect / rows.length,
    accuracyDelta:
      rows.length === 0 ? 0 : (candidateCorrect - baseCorrect) / rows.length,
    improvements: rows.filter((row) => row.improvement).length,
    regressions: rows.filter((row) => row.regression).length,
    candidateErrors: rows.filter((row) => row.candidate.status === "error").length,
  };
};

const slices = (rows: readonly ReevalQuestionRow[]): ReevalSliceSummary[] => {
  const out: ReevalSliceSummary[] = [
    summarizeSlice("overall", "all", rows),
  ];
  const dimensions: Array<{
    dimension: Exclude<ReevalSliceSummary["dimension"], "overall" | "tag">;
    key: (row: ReevalQuestionRow) => string;
  }> = [
    { dimension: "taskFamily", key: (row) => row.taskFamily },
    { dimension: "questionType", key: (row) => row.questionType },
    { dimension: "language", key: (row) => row.language ?? "unknown" },
  ];

  for (const item of dimensions) {
    const values = [...new Set(rows.map(item.key))].sort();
    for (const value of values) {
      out.push(
        summarizeSlice(
          item.dimension,
          value,
          rows.filter((row) => item.key(row) === value),
        ),
      );
    }
  }

  const tags = [...new Set(rows.flatMap((row) => row.tags))].sort();
  for (const tag of tags) {
    out.push(
      summarizeSlice(
        "tag",
        tag,
        rows.filter((row) => row.tags.includes(tag)),
      ),
    );
  }

  return out;
};

export const runCandidateReeval = async (
  cases: readonly EvalCase[],
  baseProvider: SystemOneProvider,
  candidateProvider: SystemOneProvider,
  options: CandidateReevalOptions,
): Promise<CandidateReevalResult> => {
  if (baseProvider.id === candidateProvider.id) {
    throw new Error("base and candidate provider ids must be distinct");
  }
  const reevalId =
    options.reevalId ??
    `reeval-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const baseRun = await runEval(baseProvider, cases, {
    datasetId: options.datasetId,
    runId: `${reevalId}-base`,
  });
  const candidateRun = await runEval(candidateProvider, cases, {
    datasetId: options.datasetId,
    runId: `${reevalId}-candidate`,
  });

  const baseSummary = summarizeRun(baseRun, cases);
  const candidateSummary = summarizeRun(candidateRun, cases);
  const rows = rowsForPair(cases, baseRun, candidateRun);
  const regressions = rows.filter((row) => row.regression);
  const pairSummaries: ReevalPairSummary[] = [
    pairSummary(baseRun.providerId, candidateRun.providerId, rows),
  ];

  let incumbentSummary: ReevalProviderSummary | undefined;
  let candidateVsIncumbent: ReevalMetricDelta | undefined;
  if (options.incumbentRun) {
    assertCoverage(options.incumbentRun, cases);
    incumbentSummary = summarizeRun(options.incumbentRun, cases);
    candidateVsIncumbent = delta(candidateSummary, incumbentSummary);
    const incumbentRows = rowsForPair(
      cases,
      options.incumbentRun,
      candidateRun,
    );
    pairSummaries.push(
      pairSummary(
        options.incumbentRun.providerId,
        candidateRun.providerId,
        incumbentRows,
      ),
    );
  }

  const createdAt = new Date().toISOString();
  const evidence: CandidateReevalEvidence = {
    schemaVersion: "mso.reeval.v0",
    reevalId,
    createdAt,
    datasetId: options.datasetId,
    baseProviderId: baseRun.providerId,
    candidateProviderId: candidateRun.providerId,
    baseCheckpoint: options.baseCheckpoint,
    candidateCheckpoint: options.candidateCheckpoint,
    providers: {
      base: baseSummary,
      candidate: candidateSummary,
      ...(incumbentSummary ? { incumbent: incumbentSummary } : {}),
    },
    deltas: {
      candidateVsBase: delta(candidateSummary, baseSummary),
      ...(candidateVsIncumbent
        ? { candidateVsIncumbent }
        : {}),
    },
    pairs: pairSummaries,
    slices: slices(rows),
    regressionCount: regressions.length,
    improvementCount: rows.filter((row) => row.improvement).length,
    hasRegression: regressions.length > 0,
    artifacts: {
      summary: "summary.json",
      baseEval: "base.eval.json",
      candidateEval: "candidate.eval.json",
      ...(options.incumbentRun ? { incumbentEval: "incumbent.eval.json" } : {}),
      validationFixture: "validation.eval.jsonl",
      regressions: "regressions.jsonl",
    },
    promotionInput: {
      candidateEval: "candidate.eval.json",
      note:
        "Use candidate.eval.json as labeled offline evidence for a candidate-specific Promotion Gate policy. A fine-tuned checkpoint inherits no prior promotion status.",
    },
  };

  return {
    evidence,
    baseRun,
    candidateRun,
    ...(options.incumbentRun ? { incumbentRun: options.incumbentRun } : {}),
    validationCases: cases,
    rows,
    regressions,
  };
};

const jsonl = (rows: readonly unknown[]): string =>
  rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;


const evalCaseJsonl = (cases: readonly EvalCase[]): string =>
  jsonl(
    cases.map((item) => ({
      caseId: item.caseId,
      taskFamily: item.taskFamily,
      pattern: item.pattern,
      state: item.state,
      questions: item.questions,
      expected: item.expected,
      ...(item.tags ? { tags: item.tags } : {}),
      ...(item.language ? { language: item.language } : {}),
    })),
  );

export const writeCandidateReevalArtifacts = async (
  outDir: string,
  result: CandidateReevalResult,
): Promise<void> => {
  await mkdir(outDir, { recursive: true });
  const writes: Promise<void>[] = [
    writeFile(
      join(outDir, "summary.json"),
      `${JSON.stringify(result.evidence, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(outDir, "base.eval.json"),
      `${JSON.stringify(result.baseRun, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(outDir, "candidate.eval.json"),
      `${JSON.stringify(result.candidateRun, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(outDir, "validation.eval.jsonl"),
      evalCaseJsonl(result.validationCases),
      "utf8",
    ),
    writeFile(
      join(outDir, "regressions.jsonl"),
      jsonl(result.regressions),
      "utf8",
    ),
  ];
  if (result.incumbentRun) {
    writes.push(
      writeFile(
        join(outDir, "incumbent.eval.json"),
        `${JSON.stringify(result.incumbentRun, null, 2)}\n`,
        "utf8",
      ),
    );
  }
  await Promise.all(writes);
};
