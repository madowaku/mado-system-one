import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CanaryActivationPolicy,
  CanaryAdvanceEvidence,
  CanaryAdvanceThresholds,
  CanaryStage,
  CanaryTrace,
} from "./canary.js";

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

const stage = (value: unknown, label: string): CanaryStage => {
  if (
    value !== "off" &&
    value !== "canary_1" &&
    value !== "canary_5" &&
    value !== "canary_25" &&
    value !== "limited_active"
  ) {
    throw new Error(`${label} has unsupported canary stage`);
  }
  return value;
};

const pattern = (value: unknown, label: string) => {
  if (
    value !== "route" &&
    value !== "compute" &&
    value !== "rank" &&
    value !== "gate" &&
    value !== "act" &&
    value !== "score" &&
    value !== "abstain" &&
    value !== "sieve" &&
    value !== "walk" &&
    value !== "verify"
  ) {
    throw new Error(`${label} has unsupported System One pattern`);
  }
  return value;
};

export const parseCanaryActivationPolicy = (
  value: unknown,
): CanaryActivationPolicy => {
  if (!record(value) || value.schemaVersion !== "mso.canary-policy.v0") {
    throw new Error(
      "canary policy must use schemaVersion mso.canary-policy.v0",
    );
  }
  if (!record(value.circuitBreaker)) {
    throw new Error("canary policy circuitBreaker must be an object");
  }
  if (!Array.isArray(value.allowedPatterns) || value.allowedPatterns.length === 0) {
    throw new Error("canary policy allowedPatterns must be non-empty");
  }
  if (
    value.explicitEligibilityRequired !== true ||
    value.automaticStageAdvance !== false
  ) {
    throw new Error(
      "canary policy must require explicit eligibility and disable automatic stage advance",
    );
  }

  return {
    schemaVersion: "mso.canary-policy.v0",
    policyId: text(value.policyId, "policyId"),
    decisionSurface: text(value.decisionSurface, "decisionSurface"),
    candidateCheckpointId: text(
      value.candidateCheckpointId,
      "candidateCheckpointId",
    ),
    candidateFingerprint: text(
      value.candidateFingerprint,
      "candidateFingerprint",
    ),
    promotionGateId: text(value.promotionGateId, "promotionGateId"),
    rollbackTargetCheckpointId: text(
      value.rollbackTargetCheckpointId,
      "rollbackTargetCheckpointId",
    ),
    lineageHeadEventHash: text(
      value.lineageHeadEventHash,
      "lineageHeadEventHash",
    ),
    candidateProviderId: text(
      value.candidateProviderId,
      "candidateProviderId",
    ),
    incumbentProviderId: text(
      value.incumbentProviderId,
      "incumbentProviderId",
    ),
    stage: stage(value.stage, "stage"),
    trafficFraction: number(value.trafficFraction, "trafficFraction"),
    allowedPatterns: value.allowedPatterns.map((item, index) =>
      pattern(item, `allowedPatterns[${index}]`),
    ),
    circuitBreaker: {
      maxConsecutiveCandidateErrors: integer(
        value.circuitBreaker.maxConsecutiveCandidateErrors,
        "circuitBreaker.maxConsecutiveCandidateErrors",
      ),
      minCandidateAttemptsForErrorRate: integer(
        value.circuitBreaker.minCandidateAttemptsForErrorRate,
        "circuitBreaker.minCandidateAttemptsForErrorRate",
      ),
      maxCandidateErrorRate: number(
        value.circuitBreaker.maxCandidateErrorRate,
        "circuitBreaker.maxCandidateErrorRate",
      ),
    },
    explicitEligibilityRequired: true,
    automaticStageAdvance: false,
  };
};

export interface CanaryAdvancePolicyFile extends CanaryAdvanceThresholds {
  schemaVersion: "mso.canary-advance-policy.v0";
}

export const parseCanaryAdvancePolicy = (
  value: unknown,
): CanaryAdvancePolicyFile => {
  if (
    !record(value) ||
    value.schemaVersion !== "mso.canary-advance-policy.v0"
  ) {
    throw new Error(
      "canary advance policy must use schemaVersion mso.canary-advance-policy.v0",
    );
  }
  return {
    schemaVersion: "mso.canary-advance-policy.v0",
    minCandidateSelected: integer(
      value.minCandidateSelected,
      "minCandidateSelected",
    ),
    minComparableQuestions: integer(
      value.minComparableQuestions,
      "minComparableQuestions",
    ),
    maxCandidateErrorRate: number(
      value.maxCandidateErrorRate,
      "maxCandidateErrorRate",
    ),
    maxIncumbentErrorRate: number(
      value.maxIncumbentErrorRate,
      "maxIncumbentErrorRate",
    ),
    maxFallbackRate: number(value.maxFallbackRate, "maxFallbackRate"),
    maxDisagreementRate: number(
      value.maxDisagreementRate,
      "maxDisagreementRate",
    ),
    ...(value.maxP95LatencyRatio === undefined
      ? {}
      : {
          maxP95LatencyRatio: number(
            value.maxP95LatencyRatio,
            "maxP95LatencyRatio",
          ),
        }),
  };
};

export const parseCanaryTraceJsonl = (input: string): CanaryTrace[] => {
  const rows: CanaryTrace[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of input.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`canary trace line ${index + 1} is invalid JSON`);
    }
    if (!record(value) || value.schemaVersion !== "mso.canary.v0") {
      throw new Error(
        `canary trace line ${index + 1} must use schemaVersion mso.canary.v0`,
      );
    }
    const traceId = text(value.traceId, `canary trace line ${index + 1}.traceId`);
    const sessionId = text(
      value.sessionId,
      `canary trace line ${index + 1}.sessionId`,
    );
    const key = `${sessionId}::${traceId}`;
    if (seen.has(key)) {
      throw new Error(`duplicate canary trace: ${key}`);
    }
    seen.add(key);
    rows.push(value as unknown as CanaryTrace);
  }
  return rows;
};

const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
};

export const writeCanaryActivationPolicy = async (
  path: string,
  policy: CanaryActivationPolicy,
): Promise<void> => {
  parseCanaryActivationPolicy(policy);
  await writeJsonAtomic(path, policy);
};

export const writeCanaryAdvanceEvidence = async (
  path: string,
  evidence: CanaryAdvanceEvidence,
): Promise<void> => {
  await writeJsonAtomic(path, evidence);
};

export const readCanaryActivationPolicy = async (
  path: string,
): Promise<CanaryActivationPolicy> =>
  parseCanaryActivationPolicy(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );
