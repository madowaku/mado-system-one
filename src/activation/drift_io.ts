import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ActiveLimitedDriftPolicy,
  DriftWindowEvidence,
} from "./drift.js";
import { validateDriftPolicy } from "./drift.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const number = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
};

const integer = (value: unknown, label: string): number => {
  const parsed = number(value, label);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer`);
  }
  return parsed;
};

export const parseActiveLimitedDriftPolicy = (
  value: unknown,
): ActiveLimitedDriftPolicy => {
  if (!record(value) || value.schemaVersion !== "mso.drift-policy.v0") {
    throw new Error(
      "drift policy must use schemaVersion mso.drift-policy.v0",
    );
  }
  if (!record(value.baseline) || !record(value.window) || !record(value.thresholds)) {
    throw new Error("drift policy baseline/window/thresholds must be objects");
  }

  const policy: ActiveLimitedDriftPolicy = {
    schemaVersion: "mso.drift-policy.v0",
    policyId: text(value.policyId, "policyId"),
    activationPolicyId: text(value.activationPolicyId, "activationPolicyId"),
    decisionSurface: text(value.decisionSurface, "decisionSurface"),
    candidateCheckpointId: text(
      value.candidateCheckpointId,
      "candidateCheckpointId",
    ),
    candidateFingerprint: text(
      value.candidateFingerprint,
      "candidateFingerprint",
    ),
    candidateProviderId: text(
      value.candidateProviderId,
      "candidateProviderId",
    ),
    incumbentProviderId: text(
      value.incumbentProviderId,
      "incumbentProviderId",
    ),
    lineageHeadEventHash: text(
      value.lineageHeadEventHash,
      "lineageHeadEventHash",
    ),
    baseline: {
      sourcePolicyId: text(
        value.baseline.sourcePolicyId,
        "baseline.sourcePolicyId",
      ),
      traces: integer(value.baseline.traces, "baseline.traces"),
      candidateSelected: integer(
        value.baseline.candidateSelected,
        "baseline.candidateSelected",
      ),
      comparableQuestions: integer(
        value.baseline.comparableQuestions,
        "baseline.comparableQuestions",
      ),
      candidateConfidenceSamples: integer(
        value.baseline.candidateConfidenceSamples,
        "baseline.candidateConfidenceSamples",
      ),
      meanCandidateConfidence: number(
        value.baseline.meanCandidateConfidence,
        "baseline.meanCandidateConfidence",
      ),
      candidateErrorRate: number(
        value.baseline.candidateErrorRate,
        "baseline.candidateErrorRate",
      ),
      incumbentErrorRate: number(
        value.baseline.incumbentErrorRate,
        "baseline.incumbentErrorRate",
      ),
      fallbackRate: number(
        value.baseline.fallbackRate,
        "baseline.fallbackRate",
      ),
      disagreementRate: number(
        value.baseline.disagreementRate,
        "baseline.disagreementRate",
      ),
      p95LatencyRatio: number(
        value.baseline.p95LatencyRatio,
        "baseline.p95LatencyRatio",
      ),
    },
    window: {
      size: integer(value.window.size, "window.size"),
      minCandidateSelected: integer(
        value.window.minCandidateSelected,
        "window.minCandidateSelected",
      ),
      minComparableQuestions: integer(
        value.window.minComparableQuestions,
        "window.minComparableQuestions",
      ),
      minCandidateConfidenceSamples: integer(
        value.window.minCandidateConfidenceSamples,
        "window.minCandidateConfidenceSamples",
      ),
    },
    thresholds: {
      maxCandidateErrorRate: number(
        value.thresholds.maxCandidateErrorRate,
        "thresholds.maxCandidateErrorRate",
      ),
      maxIncumbentErrorRate: number(
        value.thresholds.maxIncumbentErrorRate,
        "thresholds.maxIncumbentErrorRate",
      ),
      maxFallbackRate: number(
        value.thresholds.maxFallbackRate,
        "thresholds.maxFallbackRate",
      ),
      maxDisagreementRate: number(
        value.thresholds.maxDisagreementRate,
        "thresholds.maxDisagreementRate",
      ),
      maxP95LatencyRatio: number(
        value.thresholds.maxP95LatencyRatio,
        "thresholds.maxP95LatencyRatio",
      ),
      maxMeanCandidateConfidenceDelta: number(
        value.thresholds.maxMeanCandidateConfidenceDelta,
        "thresholds.maxMeanCandidateConfidenceDelta",
      ),
    },
    automaticHold: value.automaticHold === true,
    automaticRollback: value.automaticRollback === false ? false : true,
  };

  validateDriftPolicy(policy);
  return policy;
};

const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
};

export const writeActiveLimitedDriftPolicy = async (
  path: string,
  policy: ActiveLimitedDriftPolicy,
): Promise<void> => {
  validateDriftPolicy(policy);
  await writeJsonAtomic(path, policy);
};

export const readActiveLimitedDriftPolicy = async (
  path: string,
): Promise<ActiveLimitedDriftPolicy> =>
  parseActiveLimitedDriftPolicy(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );

export const writeDriftWindowEvidence = async (
  path: string,
  evidence: DriftWindowEvidence,
): Promise<void> => {
  await writeJsonAtomic(path, evidence);
};
