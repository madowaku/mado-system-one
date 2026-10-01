import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvalCase, EvalExpected } from "./skeleton.js";
import type {
  ComparisonEvidence,
  PairQuestionComparison,
  ProviderAnswerSnapshot,
} from "./compare.js";

export type DisagreementPriority = "p0" | "p1" | "p2" | "p3";

export type DisagreementCategory =
  | "focus_error"
  | "other_error"
  | "both_error"
  | "focus_wrong_high_confidence"
  | "focus_wrong"
  | "other_wrong"
  | "both_wrong"
  | "both_correct_disagreement";

export interface DisagreementLabOptions {
  leftProvider: string;
  rightProvider: string;
  focusProvider?: string;
  highConfidenceThreshold?: number;
  includeProviderErrors?: boolean;
  labId?: string;
}

export interface DisagreementReviewState {
  status: "pending";
}

export interface DisagreementRecord {
  recordId: string;
  labId: string;
  comparisonId: string;
  datasetId: string;
  caseId: string;
  taskFamily: string;
  questionId: string;
  questionType: "choice" | "noul" | "score";
  state: string;
  question: EvalCase["questions"][string];
  expected: EvalExpected;
  tags: readonly string[];
  language?: string;
  leftProvider: string;
  rightProvider: string;
  focusProvider: string;
  otherProvider: string;
  left: ProviderAnswerSnapshot;
  right: ProviderAnswerSnapshot;
  focus: ProviderAnswerSnapshot;
  other: ProviderAnswerSnapshot;
  pair: PairQuestionComparison;
  priority: DisagreementPriority;
  category: DisagreementCategory;
  fineTuneCandidate: boolean;
  candidateUse:
    | "model_error_candidate"
    | "ground_truth_review"
    | "baseline_review"
    | "calibration_review"
    | "provider_error_review";
  review: DisagreementReviewState;
}

export interface DisagreementSummary {
  total: number;
  byPriority: Readonly<Record<DisagreementPriority, number>>;
  byCategory: Readonly<Record<DisagreementCategory, number>>;
  byTaskFamily: Readonly<Record<string, number>>;
  byQuestionType: Readonly<Record<string, number>>;
  byLanguage: Readonly<Record<string, number>>;
  byTag: Readonly<Record<string, number>>;
}

export interface DisagreementLab {
  schemaVersion: "mso.disagreement.v0";
  labId: string;
  comparisonId: string;
  datasetId: string;
  createdAt: string;
  leftProvider: string;
  rightProvider: string;
  focusProvider: string;
  otherProvider: string;
  highConfidenceThreshold: number;
  summary: DisagreementSummary;
  records: readonly DisagreementRecord[];
}

const priorityRank: Readonly<Record<DisagreementPriority, number>> = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
};

const emptyCategoryCounts = (): Record<DisagreementCategory, number> => ({
  focus_error: 0,
  other_error: 0,
  both_error: 0,
  focus_wrong_high_confidence: 0,
  focus_wrong: 0,
  other_wrong: 0,
  both_wrong: 0,
  both_correct_disagreement: 0,
});

const increment = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1;
};

const findPair = (
  pair: PairQuestionComparison,
  left: string,
  right: string,
): boolean =>
  (pair.left === left && pair.right === right) ||
  (pair.left === right && pair.right === left);

const classify = (
  focus: ProviderAnswerSnapshot,
  other: ProviderAnswerSnapshot,
  highConfidenceThreshold: number,
): Pick<
  DisagreementRecord,
  "priority" | "category" | "fineTuneCandidate" | "candidateUse"
> => {
  if (focus.status === "error" && other.status === "error") {
    return {
      priority: "p0",
      category: "both_error",
      fineTuneCandidate: false,
      candidateUse: "provider_error_review",
    };
  }
  if (focus.status === "error") {
    return {
      priority: "p0",
      category: "focus_error",
      fineTuneCandidate: false,
      candidateUse: "provider_error_review",
    };
  }
  if (other.status === "error") {
    return {
      priority: "p2",
      category: "other_error",
      fineTuneCandidate: false,
      candidateUse: "provider_error_review",
    };
  }

  if (!focus.correct && other.correct) {
    const highConfidence =
      focus.confidence !== undefined && focus.confidence >= highConfidenceThreshold;
    return {
      priority: highConfidence ? "p0" : "p1",
      category: highConfidence ? "focus_wrong_high_confidence" : "focus_wrong",
      fineTuneCandidate: true,
      candidateUse: "model_error_candidate",
    };
  }
  if (focus.correct && !other.correct) {
    return {
      priority: "p2",
      category: "other_wrong",
      fineTuneCandidate: false,
      candidateUse: "baseline_review",
    };
  }
  if (!focus.correct && !other.correct) {
    return {
      priority: "p1",
      category: "both_wrong",
      fineTuneCandidate: false,
      candidateUse: "ground_truth_review",
    };
  }
  return {
    priority: "p3",
    category: "both_correct_disagreement",
    fineTuneCandidate: false,
    candidateUse: "calibration_review",
  };
};

const buildSummary = (records: readonly DisagreementRecord[]): DisagreementSummary => {
  const byPriority: Record<DisagreementPriority, number> = {
    p0: 0,
    p1: 0,
    p2: 0,
    p3: 0,
  };
  const byCategory = emptyCategoryCounts();
  const byTaskFamily: Record<string, number> = {};
  const byQuestionType: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};
  const byTag: Record<string, number> = {};

  for (const record of records) {
    byPriority[record.priority] += 1;
    byCategory[record.category] += 1;
    increment(byTaskFamily, record.taskFamily);
    increment(byQuestionType, record.questionType);
    increment(byLanguage, record.language ?? "unknown");
    for (const tag of record.tags) increment(byTag, tag);
  }

  return {
    total: records.length,
    byPriority,
    byCategory,
    byTaskFamily,
    byQuestionType,
    byLanguage,
    byTag,
  };
};

export const buildDisagreementLab = (
  evidence: ComparisonEvidence,
  cases: readonly EvalCase[],
  options: DisagreementLabOptions,
): DisagreementLab => {
  const {
    leftProvider,
    rightProvider,
    focusProvider = rightProvider,
    includeProviderErrors = true,
  } = options;
  const highConfidenceThreshold = options.highConfidenceThreshold ?? 0.8;

  if (leftProvider === rightProvider) {
    throw new Error("disagreement pair requires two different providers");
  }
  if (!evidence.providerIds.includes(leftProvider) || !evidence.providerIds.includes(rightProvider)) {
    throw new Error("disagreement pair providers must exist in comparison evidence");
  }
  if (focusProvider !== leftProvider && focusProvider !== rightProvider) {
    throw new Error("focusProvider must be one of the selected pair providers");
  }
  if (
    !Number.isFinite(highConfidenceThreshold) ||
    highConfidenceThreshold < 0 ||
    highConfidenceThreshold > 1
  ) {
    throw new Error("highConfidenceThreshold must be in [0, 1]");
  }

  const otherProvider =
    focusProvider === leftProvider ? rightProvider : leftProvider;
  const labId =
    options.labId ?? `lab-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const fixtures = new Map(cases.map((item) => [item.caseId, item]));
  const records: DisagreementRecord[] = [];

  for (const comparedCase of evidence.cases) {
    const fixture = fixtures.get(comparedCase.caseId);
    if (!fixture) {
      throw new Error(`comparison case missing from fixture: ${comparedCase.caseId}`);
    }

    for (const comparedQuestion of comparedCase.questions) {
      const pair = comparedQuestion.pairs.find((item) =>
        findPair(item, leftProvider, rightProvider),
      );
      if (!pair) continue;

      const left = comparedQuestion.providers[leftProvider];
      const right = comparedQuestion.providers[rightProvider];
      if (!left || !right) {
        throw new Error(
          `comparison snapshots missing for ${comparedCase.caseId}/${comparedQuestion.questionId}`,
        );
      }

      const isError = left.status === "error" || right.status === "error";
      const isDisagreement = pair.comparable && pair.agreement === false;
      if (!isDisagreement && !(includeProviderErrors && isError)) continue;

      const focus = comparedQuestion.providers[focusProvider];
      const other = comparedQuestion.providers[otherProvider];
      const question = fixture.questions[comparedQuestion.questionId];
      const expected = fixture.expected[comparedQuestion.questionId];
      if (!focus || !other || !question || !expected) {
        throw new Error(
          `fixture/comparison mismatch for ${comparedCase.caseId}/${comparedQuestion.questionId}`,
        );
      }

      const classification = classify(focus, other, highConfidenceThreshold);
      records.push({
        recordId: `${comparedCase.caseId}:${comparedQuestion.questionId}:${leftProvider}:vs:${rightProvider}`,
        labId,
        comparisonId: evidence.comparisonId,
        datasetId: evidence.datasetId,
        caseId: comparedCase.caseId,
        taskFamily: comparedCase.taskFamily,
        questionId: comparedQuestion.questionId,
        questionType: comparedQuestion.type,
        state: fixture.state,
        question,
        expected,
        tags: fixture.tags ?? [],
        ...(fixture.language ? { language: fixture.language } : {}),
        leftProvider,
        rightProvider,
        focusProvider,
        otherProvider,
        left,
        right,
        focus,
        other,
        pair,
        ...classification,
        review: { status: "pending" },
      });
    }
  }

  records.sort((a, b) => {
    const priority = priorityRank[a.priority] - priorityRank[b.priority];
    if (priority !== 0) return priority;
    const aConfidence = a.focus.confidence ?? -1;
    const bConfidence = b.focus.confidence ?? -1;
    if (aConfidence !== bConfidence) return bConfidence - aConfidence;
    return a.recordId.localeCompare(b.recordId);
  });

  return {
    schemaVersion: "mso.disagreement.v0",
    labId,
    comparisonId: evidence.comparisonId,
    datasetId: evidence.datasetId,
    createdAt: new Date().toISOString(),
    leftProvider,
    rightProvider,
    focusProvider,
    otherProvider,
    highConfidenceThreshold,
    summary: buildSummary(records),
    records,
  };
};

export const writeDisagreementLab = async (
  summaryPath: string,
  queuePath: string,
  lab: DisagreementLab,
): Promise<void> => {
  await mkdir(dirname(summaryPath), { recursive: true });
  await mkdir(dirname(queuePath), { recursive: true });

  const summary = {
    schemaVersion: lab.schemaVersion,
    labId: lab.labId,
    comparisonId: lab.comparisonId,
    datasetId: lab.datasetId,
    createdAt: lab.createdAt,
    leftProvider: lab.leftProvider,
    rightProvider: lab.rightProvider,
    focusProvider: lab.focusProvider,
    otherProvider: lab.otherProvider,
    highConfidenceThreshold: lab.highConfidenceThreshold,
    summary: lab.summary,
    queuePath,
  };

  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(
    queuePath,
    lab.records.map((record) => JSON.stringify(record)).join("\n") +
      (lab.records.length > 0 ? "\n" : ""),
    "utf8",
  );
};
