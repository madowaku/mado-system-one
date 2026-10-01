import type { EvalRun } from "../eval/skeleton.js";
import type { ShadowTrace } from "../shadow/bridge.js";
import type {
  PromotionControls,
  PromotionPolicy,
  PromotionReviewRecord,
} from "./gate.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const bool = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be boolean`);
  }
  return value;
};

const number = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
};

export const parsePromotionPolicy = (value: unknown): PromotionPolicy => {
  if (!record(value) || value.schemaVersion !== "mso.promotion-policy.v0") {
    throw new Error("promotion policy must use schemaVersion mso.promotion-policy.v0");
  }
  if (!record(value.thresholds)) {
    throw new Error("promotion policy thresholds must be an object");
  }
  const t = value.thresholds;

  return {
    schemaVersion: "mso.promotion-policy.v0",
    policyId: text(value.policyId, "policyId"),
    candidateProviderId: text(value.candidateProviderId, "candidateProviderId"),
    decisionSurface: text(value.decisionSurface, "decisionSurface"),
    thresholds: {
      minOfflineCases: number(t.minOfflineCases, "thresholds.minOfflineCases"),
      minOfflineAccuracy: number(t.minOfflineAccuracy, "thresholds.minOfflineAccuracy"),
      maxOfflineProviderErrorRate: number(
        t.maxOfflineProviderErrorRate,
        "thresholds.maxOfflineProviderErrorRate",
      ),
      minShadowTraces: number(t.minShadowTraces, "thresholds.minShadowTraces"),
      minComparableQuestions: number(
        t.minComparableQuestions,
        "thresholds.minComparableQuestions",
      ),
      minShadowAgreementRate: number(
        t.minShadowAgreementRate,
        "thresholds.minShadowAgreementRate",
      ),
      maxShadowProviderErrorRate: number(
        t.maxShadowProviderErrorRate,
        "thresholds.maxShadowProviderErrorRate",
      ),
      minDisagreementReviewCoverage: number(
        t.minDisagreementReviewCoverage,
        "thresholds.minDisagreementReviewCoverage",
      ),
      minReviewedDisagreements: number(
        t.minReviewedDisagreements,
        "thresholds.minReviewedDisagreements",
      ),
      minReviewedShadowAccuracy: number(
        t.minReviewedShadowAccuracy,
        "thresholds.minReviewedShadowAccuracy",
      ),
      ...(t.maxP95ShadowWallLatencyMs === undefined
        ? {}
        : {
            maxP95ShadowWallLatencyMs: number(
              t.maxP95ShadowWallLatencyMs,
              "thresholds.maxP95ShadowWallLatencyMs",
            ),
          }),
      ...(t.maxP95ShadowLagMs === undefined
        ? {}
        : {
            maxP95ShadowLagMs: number(
              t.maxP95ShadowLagMs,
              "thresholds.maxP95ShadowLagMs",
            ),
          }),
    },
  };
};

export const parsePromotionControls = (value: unknown): PromotionControls => {
  if (!record(value) || value.schemaVersion !== "mso.promotion-controls.v0") {
    throw new Error("promotion controls must use schemaVersion mso.promotion-controls.v0");
  }
  return {
    schemaVersion: "mso.promotion-controls.v0",
    fallbackTested: bool(value.fallbackTested, "fallbackTested"),
    killSwitchTested: bool(value.killSwitchTested, "killSwitchTested"),
    redactionChecked: bool(value.redactionChecked, "redactionChecked"),
    ...(typeof value.thresholdProfileId === "string" && value.thresholdProfileId
      ? { thresholdProfileId: value.thresholdProfileId }
      : {}),
    ...(typeof value.rollbackTarget === "string" && value.rollbackTarget
      ? { rollbackTarget: value.rollbackTarget }
      : {}),
    ...(typeof value.attestedAt === "string" && value.attestedAt
      ? { attestedAt: value.attestedAt }
      : {}),
  };
};

export const parsePromotionReviewJsonl = (
  input: string,
): PromotionReviewRecord[] => {
  const rows: PromotionReviewRecord[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of input.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`review line ${index + 1} is invalid JSON`);
    }
    if (!record(value) || value.schemaVersion !== "mso.review.v0") {
      throw new Error(
        `review line ${index + 1} must use schemaVersion mso.review.v0`,
      );
    }

    const label = value.label;
    if (
      label !== "shadow_correct" &&
      label !== "incumbent_correct" &&
      label !== "both_acceptable" &&
      label !== "neither"
    ) {
      throw new Error(`review line ${index + 1} has unsupported label`);
    }
    const source = value.source;
    if (
      source !== "human" &&
      source !== "verified_outcome" &&
      source !== "deterministic_invariant"
    ) {
      throw new Error(`review line ${index + 1} has unsupported source`);
    }

    const traceId = text(value.traceId, `review line ${index + 1}.traceId`);
    const questionId = text(
      value.questionId,
      `review line ${index + 1}.questionId`,
    );
    const shadowProviderId = text(
      value.shadowProviderId,
      `review line ${index + 1}.shadowProviderId`,
    );
    const key = `${traceId}::${questionId}::${shadowProviderId}`;
    if (seen.has(key)) {
      throw new Error(`duplicate review record: ${key}`);
    }
    seen.add(key);

    rows.push({
      schemaVersion: "mso.review.v0",
      traceId,
      questionId,
      shadowProviderId,
      label,
      source,
      reviewedAt: text(
        value.reviewedAt,
        `review line ${index + 1}.reviewedAt`,
      ),
      ...(typeof value.reviewer === "string" && value.reviewer
        ? { reviewer: value.reviewer }
        : {}),
    });
  }

  return rows;
};

export const parseShadowTraceJsonl = (input: string): ShadowTrace[] => {
  const rows: ShadowTrace[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of input.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`shadow line ${index + 1} is invalid JSON`);
    }
    if (!record(value) || value.schemaVersion !== "mso.shadow.v0") {
      throw new Error(
        `shadow line ${index + 1} must use schemaVersion mso.shadow.v0`,
      );
    }
    const traceId = text(value.traceId, `shadow line ${index + 1}.traceId`);
    if (seen.has(traceId)) {
      throw new Error(`duplicate shadow traceId: ${traceId}`);
    }
    seen.add(traceId);
    rows.push(value as unknown as ShadowTrace);
  }

  return rows;
};

export const parseEvalRun = (value: unknown): EvalRun => {
  if (!record(value) || value.schemaVersion !== "mso.eval.v0") {
    throw new Error("eval evidence must use schemaVersion mso.eval.v0");
  }
  if (!record(value.metrics)) {
    throw new Error("eval evidence metrics must be an object");
  }
  text(value.providerId, "eval.providerId");
  number(value.metrics.cases, "eval.metrics.cases");
  number(value.metrics.accuracy, "eval.metrics.accuracy");
  number(value.metrics.providerErrors, "eval.metrics.providerErrors");
  return value as unknown as EvalRun;
};
