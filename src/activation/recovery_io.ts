import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DriftHoldEvent, DriftWindowEvidence } from "./drift.js";
import type {
  HoldRecoveryCase,
  HoldRequalificationResult,
} from "./recovery.js";
import { validateHoldRecoveryCase } from "./recovery.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const stringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item, index) => text(item, `${label}[${index}]`));
};

export const parseDriftHoldEvent = (value: unknown): DriftHoldEvent => {
  if (!record(value) || value.schemaVersion !== "mso.drift-hold.v0") {
    throw new Error("hold evidence must use schemaVersion mso.drift-hold.v0");
  }
  if (
    value.action !== "auto_hold" ||
    value.automaticHold !== true ||
    value.automaticRollback !== false ||
    value.candidateAuthorityAfterHold !== false ||
    value.fallbackAuthority !== "incumbent"
  ) {
    throw new Error("hold evidence does not describe a valid auto-hold");
  }
  if (!record(value.window) || value.window.schemaVersion !== "mso.drift-window.v0") {
    throw new Error("hold evidence must contain an M1.0 drift window");
  }

  return {
    schemaVersion: "mso.drift-hold.v0",
    holdId: text(value.holdId, "holdId"),
    policyId: text(value.policyId, "policyId"),
    activationPolicyId: text(
      value.activationPolicyId,
      "activationPolicyId",
    ),
    decisionSurface: text(value.decisionSurface, "decisionSurface"),
    candidateCheckpointId: text(
      value.candidateCheckpointId,
      "candidateCheckpointId",
    ),
    candidateFingerprint: text(
      value.candidateFingerprint,
      "candidateFingerprint",
    ),
    triggeredAt: text(value.triggeredAt, "triggeredAt"),
    triggerTraceId: text(value.triggerTraceId, "triggerTraceId"),
    action: "auto_hold",
    automaticHold: true,
    automaticRollback: false,
    candidateAuthorityAfterHold: false,
    fallbackAuthority: "incumbent",
    reasons: stringArray(value.reasons, "reasons"),
    window: value.window as unknown as DriftWindowEvidence,
  };
};

export const parseHoldRecoveryCase = (value: unknown): HoldRecoveryCase => {
  if (
    !record(value) ||
    value.schemaVersion !== "mso.hold-recovery-case.v0"
  ) {
    throw new Error(
      "hold recovery case must use schemaVersion mso.hold-recovery-case.v0",
    );
  }

  const classification = value.classification;
  if (
    classification !== "provider_regression" &&
    classification !== "calibration_drift" &&
    classification !== "workload_drift" &&
    classification !== "checkpoint_regression" &&
    classification !== "unknown"
  ) {
    throw new Error("unsupported hold diagnosis classification");
  }

  const recovery: HoldRecoveryCase = {
    schemaVersion: "mso.hold-recovery-case.v0",
    recoveryId: text(value.recoveryId, "recoveryId"),
    holdId: text(value.holdId, "holdId"),
    classification,
    diagnosisSummary: text(value.diagnosisSummary, "diagnosisSummary"),
    operatorReviewed: value.operatorReviewed === true,
    ...(value.operatorApprovalRef === undefined
      ? {}
      : {
          operatorApprovalRef: text(
            value.operatorApprovalRef,
            "operatorApprovalRef",
          ),
        }),
    diagnosisEvidenceRefs: stringArray(
      value.diagnosisEvidenceRefs,
      "diagnosisEvidenceRefs",
    ),
    ...(value.repairSummary === undefined
      ? {}
      : { repairSummary: text(value.repairSummary, "repairSummary") }),
    repairEvidenceRefs: stringArray(
      value.repairEvidenceRefs,
      "repairEvidenceRefs",
    ),
    verificationEvidenceRefs: stringArray(
      value.verificationEvidenceRefs,
      "verificationEvidenceRefs",
    ),
  };
  validateHoldRecoveryCase(recovery);
  return recovery;
};

const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
};

export const readDriftHoldEvent = async (
  path: string,
): Promise<DriftHoldEvent> =>
  parseDriftHoldEvent(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );

export const readHoldRecoveryCase = async (
  path: string,
): Promise<HoldRecoveryCase> =>
  parseHoldRecoveryCase(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );

export const writeHoldRequalificationResult = async (
  outDir: string,
  result: HoldRequalificationResult,
): Promise<void> => {
  await mkdir(outDir, { recursive: true });
  await writeJsonAtomic(
    join(outDir, "requalification.json"),
    result.evidence,
  );
  if (result.restartPolicy) {
    await writeJsonAtomic(
      join(outDir, "restart.policy.json"),
      result.restartPolicy,
    );
  }
};
