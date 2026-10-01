import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SystemOneProvider } from "../core/provider.js";
import type { TypedResult } from "../core/types.js";
import type { EvalCase, EvalCaseResult, EvalRun } from "./skeleton.js";
import { runEval } from "./skeleton.js";

export interface CompareOptions {
  datasetId: string;
  comparisonId?: string;
  scoreAgreementTolerance?: number;
}

export interface ProviderAnswerSnapshot {
  providerId: string;
  status: "ok" | "error";
  correct: boolean;
  answer?: string | boolean | number | null;
  rawValue?: number;
  confidence?: number;
  error?: string;
}

export interface PairQuestionComparison {
  left: string;
  right: string;
  comparable: boolean;
  agreement?: boolean;
  answerDelta?: number;
  confidenceDelta?: number;
  correctness?: "both_correct" | "left_only" | "right_only" | "both_wrong";
}

export interface QuestionComparison {
  questionId: string;
  type: "choice" | "noul" | "score";
  providers: Readonly<Record<string, ProviderAnswerSnapshot>>;
  pairs: readonly PairQuestionComparison[];
}

export interface CaseComparison {
  caseId: string;
  taskFamily: string;
  questions: readonly QuestionComparison[];
}

export interface PairSummary {
  left: string;
  right: string;
  comparableQuestions: number;
  agreements: number;
  disagreements: number;
  agreementRate: number;
  bothCorrect: number;
  leftOnlyCorrect: number;
  rightOnlyCorrect: number;
  bothWrong: number;
  meanAnswerDelta?: number;
  meanConfidenceDelta?: number;
}

export interface ComparisonEvidence {
  schemaVersion: "mso.compare.v0";
  comparisonId: string;
  datasetId: string;
  createdAt: string;
  providerIds: readonly string[];
  scoreAgreementTolerance: number;
  runs: readonly EvalRun[];
  pairs: readonly PairSummary[];
  cases: readonly CaseComparison[];
}

const confidenceOf = (result: TypedResult): number | undefined => result.confidence;

const answerOf = (
  result: TypedResult,
): { answer: string | boolean | number | null; rawValue?: number } => {
  switch (result.type) {
    case "choice":
      return { answer: result.selected };
    case "noul":
      return {
        answer: result.probabilityYes >= 0.5,
        rawValue: result.probabilityYes,
      };
    case "score":
      return {
        answer: result.expectedScore,
        rawValue: result.expectedScore,
      };
  }
};

const judgementCorrect = (
  row: EvalCaseResult | undefined,
  questionId: string,
): boolean => row?.judgements.find((item) => item.questionId === questionId)?.correct ?? false;

const snapshot = (
  providerId: string,
  row: EvalCaseResult | undefined,
  questionId: string,
): ProviderAnswerSnapshot => {
  if (!row || row.error) {
    return {
      providerId,
      status: "error",
      correct: false,
      error: row?.error ?? "missing case result",
    };
  }
  const result = row.response?.results[questionId];
  if (!result) {
    return {
      providerId,
      status: "error",
      correct: false,
      error: "missing question result",
    };
  }
  const projected = answerOf(result);
  return {
    providerId,
    status: "ok",
    correct: judgementCorrect(row, questionId),
    answer: projected.answer,
    ...(projected.rawValue === undefined ? {} : { rawValue: projected.rawValue }),
    ...(confidenceOf(result) === undefined ? {} : { confidence: confidenceOf(result) }),
  };
};

const comparePair = (
  left: ProviderAnswerSnapshot,
  right: ProviderAnswerSnapshot,
  type: QuestionComparison["type"],
  scoreTolerance: number,
): PairQuestionComparison => {
  const base = { left: left.providerId, right: right.providerId };
  if (left.status !== "ok" || right.status !== "ok") {
    return { ...base, comparable: false };
  }

  let agreement: boolean;
  let answerDelta: number | undefined;
  if (type === "score") {
    const l = Number(left.answer);
    const r = Number(right.answer);
    answerDelta = Math.abs(l - r);
    agreement = answerDelta <= scoreTolerance;
  } else if (type === "noul") {
    agreement = left.answer === right.answer;
    if (left.rawValue !== undefined && right.rawValue !== undefined) {
      answerDelta = Math.abs(left.rawValue - right.rawValue);
    }
  } else {
    agreement = left.answer === right.answer;
  }

  const correctness =
    left.correct && right.correct
      ? "both_correct"
      : left.correct
        ? "left_only"
        : right.correct
          ? "right_only"
          : "both_wrong";

  const confidenceDelta =
    left.confidence !== undefined && right.confidence !== undefined
      ? Math.abs(left.confidence - right.confidence)
      : undefined;

  return {
    ...base,
    comparable: true,
    agreement,
    ...(answerDelta === undefined ? {} : { answerDelta }),
    ...(confidenceDelta === undefined ? {} : { confidenceDelta }),
    correctness,
  };
};

const mean = (values: readonly number[]): number | undefined =>
  values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const summarizePair = (
  left: string,
  right: string,
  cases: readonly CaseComparison[],
): PairSummary => {
  const rows = cases.flatMap((item) =>
    item.questions
      .flatMap((question) => question.pairs)
      .filter((pair) => pair.left === left && pair.right === right),
  );
  const comparable = rows.filter((row) => row.comparable);
  const agreements = comparable.filter((row) => row.agreement === true).length;
  const answerDeltas = comparable.flatMap((row) =>
    row.answerDelta === undefined ? [] : [row.answerDelta],
  );
  const confidenceDeltas = comparable.flatMap((row) =>
    row.confidenceDelta === undefined ? [] : [row.confidenceDelta],
  );
  const meanAnswerDelta = mean(answerDeltas);
  const meanConfidenceDelta = mean(confidenceDeltas);

  return {
    left,
    right,
    comparableQuestions: comparable.length,
    agreements,
    disagreements: comparable.length - agreements,
    agreementRate: comparable.length === 0 ? 0 : agreements / comparable.length,
    bothCorrect: comparable.filter((row) => row.correctness === "both_correct").length,
    leftOnlyCorrect: comparable.filter((row) => row.correctness === "left_only").length,
    rightOnlyCorrect: comparable.filter((row) => row.correctness === "right_only").length,
    bothWrong: comparable.filter((row) => row.correctness === "both_wrong").length,
    ...(meanAnswerDelta === undefined ? {} : { meanAnswerDelta }),
    ...(meanConfidenceDelta === undefined ? {} : { meanConfidenceDelta }),
  };
};

export const runComparison = async (
  providers: readonly SystemOneProvider[],
  cases: readonly EvalCase[],
  options: CompareOptions,
): Promise<ComparisonEvidence> => {
  if (providers.length < 2) {
    throw new Error("comparison requires at least two providers");
  }
  const providerIds = providers.map((provider) => provider.id);
  if (new Set(providerIds).size !== providerIds.length) {
    throw new Error("comparison provider ids must be unique");
  }
  const scoreAgreementTolerance = options.scoreAgreementTolerance ?? 0.5;
  if (!Number.isFinite(scoreAgreementTolerance) || scoreAgreementTolerance < 0) {
    throw new Error("scoreAgreementTolerance must be a finite non-negative number");
  }

  const comparisonId =
    options.comparisonId ?? `compare-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runs: EvalRun[] = [];
  for (const provider of providers) {
    runs.push(
      await runEval(provider, cases, {
        datasetId: options.datasetId,
        runId: `${comparisonId}-${provider.id}`,
      }),
    );
  }

  const runRows = new Map(
    runs.map((run) => [
      run.providerId,
      new Map(run.cases.map((row) => [row.caseId, row])),
    ]),
  );

  const comparisons: CaseComparison[] = cases.map((evalCase) => {
    const questions: QuestionComparison[] = Object.entries(evalCase.questions).map(
      ([questionId, question]) => {
        const snapshots: Record<string, ProviderAnswerSnapshot> = {};
        for (const providerId of providerIds) {
          snapshots[providerId] = snapshot(
            providerId,
            runRows.get(providerId)?.get(evalCase.caseId),
            questionId,
          );
        }

        const pairs: PairQuestionComparison[] = [];
        for (let i = 0; i < providerIds.length; i += 1) {
          for (let j = i + 1; j < providerIds.length; j += 1) {
            const leftId = providerIds[i];
            const rightId = providerIds[j];
            if (!leftId || !rightId) continue;
            const left = snapshots[leftId];
            const right = snapshots[rightId];
            if (!left || !right) continue;
            pairs.push(comparePair(left, right, question.type, scoreAgreementTolerance));
          }
        }

        return {
          questionId,
          type: question.type,
          providers: snapshots,
          pairs,
        };
      },
    );
    return { caseId: evalCase.caseId, taskFamily: evalCase.taskFamily, questions };
  });

  const pairSummaries: PairSummary[] = [];
  for (let i = 0; i < providerIds.length; i += 1) {
    for (let j = i + 1; j < providerIds.length; j += 1) {
      const left = providerIds[i];
      const right = providerIds[j];
      if (left && right) pairSummaries.push(summarizePair(left, right, comparisons));
    }
  }

  return {
    schemaVersion: "mso.compare.v0",
    comparisonId,
    datasetId: options.datasetId,
    createdAt: new Date().toISOString(),
    providerIds,
    scoreAgreementTolerance,
    runs,
    pairs: pairSummaries,
    cases: comparisons,
  };
};

export const writeComparisonEvidence = async (
  path: string,
  evidence: ComparisonEvidence,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
};
