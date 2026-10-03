import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SystemOneProvider } from "../core/provider.js";
import type {
  CalibrationStatus,
  ConfidenceSemantics,
  ProbabilitySemantics,
  SystemOnePattern,
  TypedResult,
} from "../core/types.js";
import {
  runComparison,
  type ComparisonEvidence,
  type PairSummary,
} from "./compare.js";
import type { EvalCase, EvalRun } from "./skeleton.js";

export type CalibrationConfidenceSource =
  | "choice_selected_probability"
  | "noul_predicted_probability"
  | "reported_confidence";

export interface CalibrationBin {
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number;
  accuracy: number;
  absoluteGap: number;
}

export interface DecisionConfidenceCalibration {
  questions: number;
  withConfidence: number;
  coverage: number;
  accuracyOnCovered: number;
  meanConfidence: number;
  brier: number;
  ece10: number;
  signedGap: number;
  sourceCounts: Partial<Record<CalibrationConfidenceSource, number>>;
  bins: readonly CalibrationBin[];
  interpretation: "correctness_alignment";
}

export interface CalibrationSliceSummary {
  dimension: "overall" | "pattern" | "taskFamily" | "questionType";
  value: string;
  questions: number;
  accuracy: number;
  calibration: DecisionConfidenceCalibration;
}

export interface ShadowBakeoffPolicy {
  schemaVersion: "mso.dm-shadow-policy.v0";
  policyId: string;
  minQuestions: number;
  minAccuracy: number;
  maxProviderErrorRate: number;
  minCalibrationCoverage: number;
  maxEce10: number;
  maxBrier: number;
  minComparableQuestionsWithIncumbent: number;
  maxLatencyP95Ms?: number;
  maxAverageEstimatedCostPerCase?: number;
  maxReviewLoadRate?: number;
}

export type ShadowBakeoffCheckStatus = "pass" | "fail" | "insufficient";

export interface ShadowBakeoffCheck {
  id:
    | "questions"
    | "accuracy"
    | "provider_error_rate"
    | "calibration_coverage"
    | "ece10"
    | "brier"
    | "comparable_with_incumbent"
    | "latency_p95"
    | "average_estimated_cost"
    | "review_load";
  status: ShadowBakeoffCheckStatus;
  actual: number;
  operator: ">=" | "<=";
  threshold: number;
  detail: string;
}

export interface ProviderOfflineSummary {
  providerId: string;
  probabilitySemantics: ProbabilitySemantics;
  confidenceSemantics: ConfidenceSemantics;
  providerReportedCalibrationStatus: CalibrationStatus;
  cases: number;
  questions: number;
  accuracy: number;
  caseAccuracy: number;
  providerErrors: number;
  providerErrorRate: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  totalEstimatedCost: number;
  averageEstimatedCostPerCase: number;
  calibration: DecisionConfidenceCalibration;
  calibrationSlices: readonly CalibrationSliceSummary[];
}

export interface IncumbentPairSummary {
  incumbentProviderId: string;
  candidateProviderId: string;
  comparableQuestions: number;
  agreements: number;
  disagreements: number;
  agreementRate: number;
  reviewLoadRate: number;
  meanAnswerDelta?: number;
  meanConfidenceDelta?: number;
}

export type ShadowReadiness =
  | "reference_incumbent"
  | "eligible_for_shadow"
  | "blocked"
  | "insufficient_evidence";

export interface ProviderShadowAssessment {
  providerId: string;
  readiness: ShadowReadiness;
  offline: ProviderOfflineSummary;
  incumbentPair?: IncumbentPairSummary;
  checks: readonly ShadowBakeoffCheck[];
  shadowPlan?: {
    mode: "shadow";
    authoritativeProviderId: string;
    shadowProviderId: string;
    shadowInfluencedExecution: false;
    automaticActivation: false;
  };
}

export interface CrossProviderBakeoffEvidence {
  schemaVersion: "mso.dm-bakeoff.v0";
  bakeoffId: string;
  datasetId: string;
  createdAt: string;
  incumbentProviderId: string;
  providerIds: readonly string[];
  policy: ShadowBakeoffPolicy;
  comparison: ComparisonEvidence;
  assessments: readonly ProviderShadowAssessment[];
  shadowCandidates: readonly string[];
  automaticSelection: false;
  runtimeAuthorityChange: false;
  requiresHumanReview: true;
}

export interface CrossProviderBakeoffOptions {
  datasetId: string;
  incumbentProviderId: string;
  policy: ShadowBakeoffPolicy;
  bakeoffId?: string;
  scoreAgreementTolerance?: number;
}

interface CalibrationRow {
  pattern: SystemOnePattern;
  taskFamily: string;
  questionType: "choice" | "noul" | "score";
  correct: boolean;
  confidence?: number;
  source?: CalibrationConfidenceSource;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
};

const probability = (value: unknown, label: string): number => {
  const parsed = finite(value, label);
  if (parsed < 0 || parsed > 1) {
    throw new Error(`${label} must be in [0, 1]`);
  }
  return parsed;
};

const nonNegativeInteger = (value: unknown, label: string): number => {
  const parsed = finite(value, label);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
};

export const parseShadowBakeoffPolicy = (value: unknown): ShadowBakeoffPolicy => {
  if (!record(value)) throw new Error("shadow bake-off policy must be an object");
  if (value.schemaVersion !== "mso.dm-shadow-policy.v0") {
    throw new Error("shadow bake-off policy schemaVersion must be mso.dm-shadow-policy.v0");
  }
  if (typeof value.policyId !== "string" || !value.policyId) {
    throw new Error("shadow bake-off policyId must be non-empty");
  }

  const out: ShadowBakeoffPolicy = {
    schemaVersion: "mso.dm-shadow-policy.v0",
    policyId: value.policyId,
    minQuestions: nonNegativeInteger(value.minQuestions, "minQuestions"),
    minAccuracy: probability(value.minAccuracy, "minAccuracy"),
    maxProviderErrorRate: probability(
      value.maxProviderErrorRate,
      "maxProviderErrorRate",
    ),
    minCalibrationCoverage: probability(
      value.minCalibrationCoverage,
      "minCalibrationCoverage",
    ),
    maxEce10: probability(value.maxEce10, "maxEce10"),
    maxBrier: probability(value.maxBrier, "maxBrier"),
    minComparableQuestionsWithIncumbent: nonNegativeInteger(
      value.minComparableQuestionsWithIncumbent,
      "minComparableQuestionsWithIncumbent",
    ),
    ...(value.maxLatencyP95Ms === undefined
      ? {}
      : {
          maxLatencyP95Ms: Math.max(
            0,
            finite(value.maxLatencyP95Ms, "maxLatencyP95Ms"),
          ),
        }),
    ...(value.maxAverageEstimatedCostPerCase === undefined
      ? {}
      : {
          maxAverageEstimatedCostPerCase: Math.max(
            0,
            finite(
              value.maxAverageEstimatedCostPerCase,
              "maxAverageEstimatedCostPerCase",
            ),
          ),
        }),
    ...(value.maxReviewLoadRate === undefined
      ? {}
      : {
          maxReviewLoadRate: probability(
            value.maxReviewLoadRate,
            "maxReviewLoadRate",
          ),
        }),
  };

  return out;
};

const calibrationConfidence = (
  result: TypedResult | undefined,
): { confidence: number; source: CalibrationConfidenceSource } | undefined => {
  if (!result) return undefined;

  if (result.type === "choice") {
    if (result.selected === null) return undefined;
    const selectedProbability = result.distribution[result.selected];
    if (
      typeof selectedProbability === "number" &&
      Number.isFinite(selectedProbability) &&
      selectedProbability >= 0 &&
      selectedProbability <= 1
    ) {
      return {
        confidence: selectedProbability,
        source: "choice_selected_probability",
      };
    }
  }

  if (result.type === "noul") {
    const yes = result.probabilityYes;
    if (Number.isFinite(yes) && yes >= 0 && yes <= 1) {
      return {
        confidence: Math.max(yes, 1 - yes),
        source: "noul_predicted_probability",
      };
    }
  }

  if (
    result.confidence !== undefined &&
    Number.isFinite(result.confidence) &&
    result.confidence >= 0 &&
    result.confidence <= 1
  ) {
    return {
      confidence: result.confidence,
      source: "reported_confidence",
    };
  }

  return undefined;
};

const rowsForRun = (
  run: EvalRun,
  cases: readonly EvalCase[],
): CalibrationRow[] => {
  const caseById = new Map(cases.map((item) => [item.caseId, item]));
  const rows: CalibrationRow[] = [];

  for (const resultCase of run.cases) {
    const fixture = caseById.get(resultCase.caseId);
    if (!fixture) {
      throw new Error(
        `eval run ${run.providerId} contains unknown case ${resultCase.caseId}`,
      );
    }

    for (const [questionId, question] of Object.entries(fixture.questions)) {
      const judgement = resultCase.judgements.find(
        (item) => item.questionId === questionId,
      );
      if (!judgement) {
        throw new Error(
          `eval run ${run.providerId} missing judgement ${fixture.caseId}/${questionId}`,
        );
      }
      const point = calibrationConfidence(resultCase.response?.results[questionId]);
      rows.push({
        pattern: fixture.pattern,
        taskFamily: fixture.taskFamily,
        questionType: question.type,
        correct: judgement.correct,
        ...(point
          ? { confidence: point.confidence, source: point.source }
          : {}),
      });
    }
  }

  return rows;
};

const summarizeCalibration = (
  rows: readonly CalibrationRow[],
): DecisionConfidenceCalibration => {
  const points = rows.filter(
    (
      row,
    ): row is CalibrationRow & {
      confidence: number;
      source: CalibrationConfidenceSource;
    } => row.confidence !== undefined && row.source !== undefined,
  );

  const sourceCounts: Partial<Record<CalibrationConfidenceSource, number>> = {};
  for (const point of points) {
    sourceCounts[point.source] = (sourceCounts[point.source] ?? 0) + 1;
  }

  if (points.length === 0) {
    return {
      questions: rows.length,
      withConfidence: 0,
      coverage: 0,
      accuracyOnCovered: 0,
      meanConfidence: 0,
      brier: 0,
      ece10: 0,
      signedGap: 0,
      sourceCounts,
      bins: [],
      interpretation: "correctness_alignment",
    };
  }

  const accuracyOnCovered =
    points.filter((point) => point.correct).length / points.length;
  const meanConfidence =
    points.reduce((sum, point) => sum + point.confidence, 0) / points.length;
  const brier =
    points.reduce(
      (sum, point) =>
        sum + (point.confidence - (point.correct ? 1 : 0)) ** 2,
      0,
    ) / points.length;

  const bins: CalibrationBin[] = [];
  let ece10 = 0;
  for (let bin = 0; bin < 10; bin += 1) {
    const lower = bin / 10;
    const upper = (bin + 1) / 10;
    const selected = points.filter((point) =>
      bin === 9
        ? point.confidence >= lower && point.confidence <= upper
        : point.confidence >= lower && point.confidence < upper,
    );
    if (selected.length === 0) continue;

    const binConfidence =
      selected.reduce((sum, point) => sum + point.confidence, 0) /
      selected.length;
    const binAccuracy =
      selected.filter((point) => point.correct).length / selected.length;
    const absoluteGap = Math.abs(binAccuracy - binConfidence);
    ece10 += (selected.length / points.length) * absoluteGap;
    bins.push({
      lower,
      upper,
      count: selected.length,
      meanConfidence: binConfidence,
      accuracy: binAccuracy,
      absoluteGap,
    });
  }

  return {
    questions: rows.length,
    withConfidence: points.length,
    coverage: rows.length === 0 ? 0 : points.length / rows.length,
    accuracyOnCovered,
    meanConfidence,
    brier,
    ece10,
    signedGap: meanConfidence - accuracyOnCovered,
    sourceCounts,
    bins,
    interpretation: "correctness_alignment",
  };
};

const calibrationSlices = (
  rows: readonly CalibrationRow[],
): CalibrationSliceSummary[] => {
  const out: CalibrationSliceSummary[] = [];
  const summarize = (
    dimension: CalibrationSliceSummary["dimension"],
    value: string,
    selected: readonly CalibrationRow[],
  ): void => {
    out.push({
      dimension,
      value,
      questions: selected.length,
      accuracy:
        selected.length === 0
          ? 0
          : selected.filter((row) => row.correct).length / selected.length,
      calibration: summarizeCalibration(selected),
    });
  };

  summarize("overall", "all", rows);

  for (const pattern of [...new Set(rows.map((row) => row.pattern))].sort()) {
    summarize(
      "pattern",
      pattern,
      rows.filter((row) => row.pattern === pattern),
    );
  }
  for (const taskFamily of [
    ...new Set(rows.map((row) => row.taskFamily)),
  ].sort()) {
    summarize(
      "taskFamily",
      taskFamily,
      rows.filter((row) => row.taskFamily === taskFamily),
    );
  }
  for (const questionType of [
    ...new Set(rows.map((row) => row.questionType)),
  ].sort()) {
    summarize(
      "questionType",
      questionType,
      rows.filter((row) => row.questionType === questionType),
    );
  }

  return out;
};

const offlineSummary = (
  run: EvalRun,
  cases: readonly EvalCase[],
): ProviderOfflineSummary => {
  const rows = rowsForRun(run, cases);
  return {
    providerId: run.providerId,
    probabilitySemantics: run.providerCapabilities.probabilitySemantics,
    confidenceSemantics: run.providerCapabilities.confidenceSemantics,
    providerReportedCalibrationStatus:
      run.providerCapabilities.calibration.status,
    cases: run.metrics.cases,
    questions: run.metrics.questions,
    accuracy: run.metrics.accuracy,
    caseAccuracy: run.metrics.caseAccuracy,
    providerErrors: run.metrics.providerErrors,
    providerErrorRate:
      run.metrics.cases === 0
        ? 0
        : run.metrics.providerErrors / run.metrics.cases,
    latencyP50Ms: run.metrics.latencyP50Ms,
    latencyP95Ms: run.metrics.latencyP95Ms,
    totalEstimatedCost: run.metrics.totalEstimatedCost,
    averageEstimatedCostPerCase:
      run.metrics.cases === 0
        ? 0
        : run.metrics.totalEstimatedCost / run.metrics.cases,
    calibration: summarizeCalibration(rows),
    calibrationSlices: calibrationSlices(rows),
  };
};

const pairWithIncumbent = (
  pair: PairSummary,
  incumbentProviderId: string,
  candidateProviderId: string,
): IncumbentPairSummary => ({
  incumbentProviderId,
  candidateProviderId,
  comparableQuestions: pair.comparableQuestions,
  agreements: pair.agreements,
  disagreements: pair.disagreements,
  agreementRate: pair.agreementRate,
  reviewLoadRate:
    pair.comparableQuestions === 0
      ? 0
      : pair.disagreements / pair.comparableQuestions,
  ...(pair.meanAnswerDelta === undefined
    ? {}
    : { meanAnswerDelta: pair.meanAnswerDelta }),
  ...(pair.meanConfidenceDelta === undefined
    ? {}
    : { meanConfidenceDelta: pair.meanConfidenceDelta }),
});

const findIncumbentPair = (
  comparison: ComparisonEvidence,
  incumbentProviderId: string,
  candidateProviderId: string,
): IncumbentPairSummary | undefined => {
  const pair = comparison.pairs.find(
    (item) =>
      (item.left === incumbentProviderId &&
        item.right === candidateProviderId) ||
      (item.left === candidateProviderId &&
        item.right === incumbentProviderId),
  );
  return pair
    ? pairWithIncumbent(pair, incumbentProviderId, candidateProviderId)
    : undefined;
};

const minCheck = (
  id: ShadowBakeoffCheck["id"],
  actual: number,
  threshold: number,
  detail: string,
  evidenceCheck = false,
): ShadowBakeoffCheck => ({
  id,
  status:
    actual >= threshold ? "pass" : evidenceCheck ? "insufficient" : "fail",
  actual,
  operator: ">=",
  threshold,
  detail,
});

const maxCheck = (
  id: ShadowBakeoffCheck["id"],
  actual: number,
  threshold: number,
  detail: string,
): ShadowBakeoffCheck => ({
  id,
  status: actual <= threshold ? "pass" : "fail",
  actual,
  operator: "<=",
  threshold,
  detail,
});

const checksFor = (
  offline: ProviderOfflineSummary,
  pair: IncumbentPairSummary | undefined,
  policy: ShadowBakeoffPolicy,
): ShadowBakeoffCheck[] => {
  const checks: ShadowBakeoffCheck[] = [
    minCheck(
      "questions",
      offline.questions,
      policy.minQuestions,
      "minimum labeled question evidence",
      true,
    ),
    minCheck(
      "accuracy",
      offline.accuracy,
      policy.minAccuracy,
      "offline labeled-question accuracy",
    ),
    maxCheck(
      "provider_error_rate",
      offline.providerErrorRate,
      policy.maxProviderErrorRate,
      "provider error rate across eval cases",
    ),
    minCheck(
      "calibration_coverage",
      offline.calibration.coverage,
      policy.minCalibrationCoverage,
      "fraction of questions with comparable decision confidence",
      true,
    ),
    maxCheck(
      "ece10",
      offline.calibration.ece10,
      policy.maxEce10,
      "10-bin expected calibration error on covered questions",
    ),
    maxCheck(
      "brier",
      offline.calibration.brier,
      policy.maxBrier,
      "Brier score on covered questions",
    ),
    minCheck(
      "comparable_with_incumbent",
      pair?.comparableQuestions ?? 0,
      policy.minComparableQuestionsWithIncumbent,
      "pairwise comparable questions against incumbent",
      true,
    ),
  ];

  if (policy.maxLatencyP95Ms !== undefined) {
    checks.push(
      maxCheck(
        "latency_p95",
        offline.latencyP95Ms,
        policy.maxLatencyP95Ms,
        "offline p95 wall latency",
      ),
    );
  }

  if (policy.maxAverageEstimatedCostPerCase !== undefined) {
    checks.push(
      maxCheck(
        "average_estimated_cost",
        offline.averageEstimatedCostPerCase,
        policy.maxAverageEstimatedCostPerCase,
        "average provider-reported estimated cost per eval case",
      ),
    );
  }

  if (policy.maxReviewLoadRate !== undefined) {
    checks.push(
      maxCheck(
        "review_load",
        pair?.reviewLoadRate ?? 1,
        policy.maxReviewLoadRate,
        "estimated human review load from incumbent disagreements",
      ),
    );
  }

  return checks;
};

const readinessFor = (
  checks: readonly ShadowBakeoffCheck[],
): Exclude<ShadowReadiness, "reference_incumbent"> => {
  if (checks.some((check) => check.status === "fail")) return "blocked";
  if (checks.some((check) => check.status === "insufficient")) {
    return "insufficient_evidence";
  }
  return "eligible_for_shadow";
};

export const buildCrossProviderBakeoff = (
  comparison: ComparisonEvidence,
  cases: readonly EvalCase[],
  options: Omit<CrossProviderBakeoffOptions, "datasetId" | "scoreAgreementTolerance"> & {
    datasetId?: string;
  },
): CrossProviderBakeoffEvidence => {
  if (!comparison.providerIds.includes(options.incumbentProviderId)) {
    throw new Error(
      `incumbent provider not present in comparison: ${options.incumbentProviderId}`,
    );
  }
  if (comparison.datasetId !== (options.datasetId ?? comparison.datasetId)) {
    throw new Error("comparison datasetId does not match bake-off datasetId");
  }

  const bakeoffId =
    options.bakeoffId ??
    `dm-bakeoff-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const assessments = comparison.runs.map((run): ProviderShadowAssessment => {
    const offline = offlineSummary(run, cases);
    if (run.providerId === options.incumbentProviderId) {
      return {
        providerId: run.providerId,
        readiness: "reference_incumbent",
        offline,
        checks: [],
      };
    }

    const incumbentPair = findIncumbentPair(
      comparison,
      options.incumbentProviderId,
      run.providerId,
    );
    const checks = checksFor(offline, incumbentPair, options.policy);
    const readiness = readinessFor(checks);
    return {
      providerId: run.providerId,
      readiness,
      offline,
      ...(incumbentPair ? { incumbentPair } : {}),
      checks,
      ...(readiness === "eligible_for_shadow"
        ? {
            shadowPlan: {
              mode: "shadow",
              authoritativeProviderId: options.incumbentProviderId,
              shadowProviderId: run.providerId,
              shadowInfluencedExecution: false,
              automaticActivation: false,
            },
          }
        : {}),
    };
  });

  return {
    schemaVersion: "mso.dm-bakeoff.v0",
    bakeoffId,
    datasetId: comparison.datasetId,
    createdAt: new Date().toISOString(),
    incumbentProviderId: options.incumbentProviderId,
    providerIds: comparison.providerIds,
    policy: options.policy,
    comparison,
    assessments,
    shadowCandidates: assessments
      .filter((item) => item.readiness === "eligible_for_shadow")
      .map((item) => item.providerId),
    automaticSelection: false,
    runtimeAuthorityChange: false,
    requiresHumanReview: true,
  };
};

export const runCrossProviderBakeoff = async (
  providers: readonly SystemOneProvider[],
  cases: readonly EvalCase[],
  options: CrossProviderBakeoffOptions,
): Promise<CrossProviderBakeoffEvidence> => {
  const comparison = await runComparison(providers, cases, {
    datasetId: options.datasetId,
    ...(options.bakeoffId
      ? { comparisonId: `${options.bakeoffId}-comparison` }
      : {}),
    ...(options.scoreAgreementTolerance === undefined
      ? {}
      : { scoreAgreementTolerance: options.scoreAgreementTolerance }),
  });

  return buildCrossProviderBakeoff(comparison, cases, {
    incumbentProviderId: options.incumbentProviderId,
    policy: options.policy,
    ...(options.bakeoffId ? { bakeoffId: options.bakeoffId } : {}),
  });
};

export const writeCrossProviderBakeoffEvidence = async (
  path: string,
  evidence: CrossProviderBakeoffEvidence,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
};
