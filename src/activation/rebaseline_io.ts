import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  WorkloadRebaselineAcceptanceEvidence,
  WorkloadRebaselineAcceptanceReview,
  WorkloadRebaselineAcceptanceResult,
  WorkloadRebaselineCandidateEvidence,
  WorkloadRebaselineCandidateResult,
  WorkloadRebaselineReview,
} from "./rebaseline.js";
import {
  validateWorkloadRebaselineAcceptanceReview,
  validateWorkloadRebaselineReview,
} from "./rebaseline.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const stringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
};

export const parseWorkloadRebaselineReview = (
  value: unknown,
): WorkloadRebaselineReview => {
  if (!record(value) || value.schemaVersion !== "mso.rebaseline-review.v0") {
    throw new Error(
      "rebaseline review must use schemaVersion mso.rebaseline-review.v0",
    );
  }
  const review: WorkloadRebaselineReview = {
    schemaVersion: "mso.rebaseline-review.v0",
    rebaselineId: text(value.rebaselineId, "rebaselineId"),
    holdId: text(value.holdId, "holdId"),
    recoveryId: text(value.recoveryId, "recoveryId"),
    operatorReviewed: value.operatorReviewed === true,
    ...(value.operatorApprovalRef === undefined
      ? {}
      : {
          operatorApprovalRef: text(
            value.operatorApprovalRef,
            "operatorApprovalRef",
          ),
        }),
    distributionSummary: text(
      value.distributionSummary,
      "distributionSummary",
    ),
    evidenceRefs: stringArray(value.evidenceRefs, "evidenceRefs"),
  };
  validateWorkloadRebaselineReview(review);
  return review;
};

export const parseWorkloadRebaselineAcceptanceReview = (
  value: unknown,
): WorkloadRebaselineAcceptanceReview => {
  if (
    !record(value) ||
    value.schemaVersion !== "mso.rebaseline-acceptance-review.v0"
  ) {
    throw new Error(
      "rebaseline acceptance review must use schemaVersion mso.rebaseline-acceptance-review.v0",
    );
  }
  const review: WorkloadRebaselineAcceptanceReview = {
    schemaVersion: "mso.rebaseline-acceptance-review.v0",
    rebaselineId: text(value.rebaselineId, "rebaselineId"),
    operatorReviewed: value.operatorReviewed === true,
    ...(value.operatorApprovalRef === undefined
      ? {}
      : {
          operatorApprovalRef: text(
            value.operatorApprovalRef,
            "operatorApprovalRef",
          ),
        }),
    evidenceRefs: stringArray(value.evidenceRefs, "evidenceRefs"),
    acceptanceSummary: text(
      value.acceptanceSummary,
      "acceptanceSummary",
    ),
  };
  validateWorkloadRebaselineAcceptanceReview(review);
  return review;
};

export const parseWorkloadRebaselineAcceptanceEvidence = (
  value: unknown,
): WorkloadRebaselineAcceptanceEvidence => {
  if (
    !record(value) ||
    value.schemaVersion !== "mso.rebaseline-acceptance.v0"
  ) {
    throw new Error(
      "rebaseline acceptance evidence must use schemaVersion mso.rebaseline-acceptance.v0",
    );
  }
  if (
    value.status !== "pass" &&
    value.status !== "blocked"
  ) {
    throw new Error("rebaseline acceptance evidence has unsupported status");
  }
  if (
    value.action !== "eligible_for_limited_active" &&
    value.action !== "hold_remains"
  ) {
    throw new Error("rebaseline acceptance evidence has unsupported action");
  }
  if (
    value.automaticActivation !== false ||
    value.oldBaselineReplaced !== false
  ) {
    throw new Error(
      "rebaseline acceptance evidence must remain non-activating and preserve historical baseline",
    );
  }
  if (!record(value.acceptedBaseline) || !record(value.review)) {
    throw new Error(
      "rebaseline acceptance evidence must include acceptedBaseline and review",
    );
  }
  return value as unknown as WorkloadRebaselineAcceptanceEvidence;
};

export const parseWorkloadRebaselineCandidateEvidence = (
  value: unknown,
): WorkloadRebaselineCandidateEvidence => {
  if (
    !record(value) ||
    value.schemaVersion !== "mso.rebaseline-candidate.v0"
  ) {
    throw new Error(
      "rebaseline candidate must use schemaVersion mso.rebaseline-candidate.v0",
    );
  }
  return value as unknown as WorkloadRebaselineCandidateEvidence;
};

const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
};

export const readWorkloadRebaselineReview = async (
  path: string,
): Promise<WorkloadRebaselineReview> =>
  parseWorkloadRebaselineReview(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );

export const readWorkloadRebaselineAcceptanceReview = async (
  path: string,
): Promise<WorkloadRebaselineAcceptanceReview> =>
  parseWorkloadRebaselineAcceptanceReview(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );

export const readWorkloadRebaselineAcceptanceEvidence = async (
  path: string,
): Promise<WorkloadRebaselineAcceptanceEvidence> =>
  parseWorkloadRebaselineAcceptanceEvidence(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );

export const readWorkloadRebaselineCandidateEvidence = async (
  path: string,
): Promise<WorkloadRebaselineCandidateEvidence> =>
  parseWorkloadRebaselineCandidateEvidence(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );

export const writeWorkloadRebaselineCandidateResult = async (
  outDir: string,
  result: WorkloadRebaselineCandidateResult,
): Promise<void> => {
  await mkdir(outDir, { recursive: true });
  await writeJsonAtomic(
    join(outDir, "rebaseline.candidate.json"),
    result.evidence,
  );
  if (result.restartPolicy) {
    await writeJsonAtomic(
      join(outDir, "recovery-canary.policy.json"),
      result.restartPolicy,
    );
  }
};

export const writeWorkloadRebaselineAcceptanceResult = async (
  outDir: string,
  result: WorkloadRebaselineAcceptanceResult,
): Promise<void> => {
  await mkdir(outDir, { recursive: true });
  await writeJsonAtomic(
    join(outDir, "rebaseline.acceptance.json"),
    result.evidence,
  );
  if (result.limitedActivePolicy) {
    await writeJsonAtomic(
      join(outDir, "limited-active.policy.json"),
      result.limitedActivePolicy,
    );
  }
  if (result.driftPolicy) {
    await writeJsonAtomic(
      join(outDir, "drift.policy.json"),
      result.driftPolicy,
    );
  }
};
