import type { CanaryActivationPolicy } from "./canary.js";
import { buildCanaryActivationPolicy } from "./canary.js";
import type {
  ActiveLimitedDriftPolicy,
  DriftHoldEvent,
  DriftWindowEvidence,
} from "./drift.js";
import { assertDriftPolicyAgainstActivation } from "./drift.js";
import type { CheckpointLineageRegistry } from "../lineage/registry.js";
import { deriveLineageState } from "../lineage/registry.js";

export type HoldDiagnosisClassification =
  | "provider_regression"
  | "calibration_drift"
  | "workload_drift"
  | "checkpoint_regression"
  | "unknown";

export interface HoldRecoveryCase {
  schemaVersion: "mso.hold-recovery-case.v0";
  recoveryId: string;
  holdId: string;
  classification: HoldDiagnosisClassification;
  diagnosisSummary: string;
  operatorReviewed: boolean;
  operatorApprovalRef?: string;
  diagnosisEvidenceRefs: readonly string[];
  repairSummary?: string;
  repairEvidenceRefs: readonly string[];
  verificationEvidenceRefs: readonly string[];
}

export type RequalificationCheckStatus = "pass" | "fail" | "blocked";

export interface RequalificationCheck {
  id:
    | "operator_review"
    | "operator_approval"
    | "diagnosis_evidence"
    | "repair_evidence"
    | "verification_evidence"
    | "recovery_window"
    | "same_checkpoint_path";
  status: RequalificationCheckStatus;
  detail: string;
}

export type RequalificationAction =
  | "eligible_for_new_canary"
  | "hold_remains"
  | "requires_rebaseline"
  | "requires_new_checkpoint"
  | "diagnosis_required";

export interface HoldRequalificationEvidence {
  schemaVersion: "mso.hold-requalification.v0";
  requalificationId: string;
  createdAt: string;
  holdId: string;
  recoveryId: string;
  classification: HoldDiagnosisClassification;
  decisionSurface: string;
  candidateCheckpointId: string;
  candidateFingerprint: string;
  previousActivationPolicyId: string;
  previousDriftPolicyId: string;
  status: "pass" | "blocked";
  action: RequalificationAction;
  automaticReactivation: false;
  automaticRollback: false;
  oldSessionReusable: false;
  restartStage?: "canary_1";
  newActivationPolicyId?: string;
  checks: readonly RequalificationCheck[];
  recoveryWindow: DriftWindowEvidence;
  diagnosisEvidenceRefs: readonly string[];
  repairEvidenceRefs: readonly string[];
  verificationEvidenceRefs: readonly string[];
  operatorApprovalRef?: string;
}

export interface HoldRequalificationResult {
  evidence: HoldRequalificationEvidence;
  restartPolicy?: CanaryActivationPolicy;
}

export interface HoldRequalificationOptions {
  newActivationPolicyId: string;
  now?: Date;
}

const nonEmpty = (value: string, label: string): void => {
  if (!value.trim()) throw new Error(`${label} must be non-empty`);
};

export const validateHoldRecoveryCase = (
  recovery: HoldRecoveryCase,
): void => {
  if (recovery.schemaVersion !== "mso.hold-recovery-case.v0") {
    throw new Error("unsupported hold recovery case schema");
  }
  nonEmpty(recovery.recoveryId, "recoveryId");
  nonEmpty(recovery.holdId, "holdId");
  nonEmpty(recovery.diagnosisSummary, "diagnosisSummary");
  if (
    recovery.classification !== "provider_regression" &&
    recovery.classification !== "calibration_drift" &&
    recovery.classification !== "workload_drift" &&
    recovery.classification !== "checkpoint_regression" &&
    recovery.classification !== "unknown"
  ) {
    throw new Error("unsupported hold diagnosis classification");
  }
  for (const [label, refs] of [
    ["diagnosisEvidenceRefs", recovery.diagnosisEvidenceRefs],
    ["repairEvidenceRefs", recovery.repairEvidenceRefs],
    ["verificationEvidenceRefs", recovery.verificationEvidenceRefs],
  ] as const) {
    for (const ref of refs) nonEmpty(ref, label);
  }
  if (recovery.operatorApprovalRef !== undefined) {
    nonEmpty(recovery.operatorApprovalRef, "operatorApprovalRef");
  }
  if (recovery.repairSummary !== undefined) {
    nonEmpty(recovery.repairSummary, "repairSummary");
  }
};

const assertHoldIdentity = (
  hold: DriftHoldEvent,
  activationPolicy: CanaryActivationPolicy,
  driftPolicy: ActiveLimitedDriftPolicy,
  recovery: HoldRecoveryCase,
  recoveryWindow: DriftWindowEvidence,
): void => {
  assertDriftPolicyAgainstActivation(driftPolicy, activationPolicy);
  if (hold.schemaVersion !== "mso.drift-hold.v0") {
    throw new Error("unsupported drift hold schema");
  }
  if (
    hold.action !== "auto_hold" ||
    hold.automaticHold !== true ||
    hold.automaticRollback !== false ||
    hold.candidateAuthorityAfterHold !== false
  ) {
    throw new Error("hold evidence is not a valid M1.0 auto-hold");
  }
  if (recovery.holdId !== hold.holdId) {
    throw new Error("recovery case holdId does not match hold evidence");
  }
  if (
    hold.policyId !== driftPolicy.policyId ||
    hold.activationPolicyId !== activationPolicy.policyId ||
    hold.decisionSurface !== activationPolicy.decisionSurface ||
    hold.candidateCheckpointId !== activationPolicy.candidateCheckpointId ||
    hold.candidateFingerprint !== activationPolicy.candidateFingerprint
  ) {
    throw new Error("hold identity does not match activation/drift policy");
  }
  if (
    recoveryWindow.policyId !== driftPolicy.policyId ||
    recoveryWindow.activationPolicyId !== activationPolicy.policyId
  ) {
    throw new Error("recovery window identity does not match hold policies");
  }
};

const check = (
  id: RequalificationCheck["id"],
  status: RequalificationCheckStatus,
  detail: string,
): RequalificationCheck => ({ id, status, detail });

const evidenceCheck = (
  id:
    | "diagnosis_evidence"
    | "repair_evidence"
    | "verification_evidence",
  refs: readonly string[],
  required: boolean,
): RequalificationCheck =>
  check(
    id,
    !required || refs.length > 0 ? "pass" : "blocked",
    !required
      ? "not required for this recovery route"
      : refs.length > 0
        ? `${refs.length} evidence reference(s) supplied`
        : "required evidence reference is missing",
  );

export const evaluateHoldRequalification = (
  registry: CheckpointLineageRegistry,
  activationPolicy: CanaryActivationPolicy,
  driftPolicy: ActiveLimitedDriftPolicy,
  hold: DriftHoldEvent,
  recovery: HoldRecoveryCase,
  recoveryWindow: DriftWindowEvidence,
  options: HoldRequalificationOptions,
): HoldRequalificationResult => {
  validateHoldRecoveryCase(recovery);
  assertHoldIdentity(
    hold,
    activationPolicy,
    driftPolicy,
    recovery,
    recoveryWindow,
  );
  nonEmpty(options.newActivationPolicyId, "newActivationPolicyId");

  const sameCheckpointRecovery =
    recovery.classification === "provider_regression" ||
    recovery.classification === "calibration_drift";

  const checks: RequalificationCheck[] = [
    check(
      "operator_review",
      recovery.operatorReviewed ? "pass" : "blocked",
      recovery.operatorReviewed
        ? "recovery diagnosis was operator-reviewed"
        : "operator review is required",
    ),
    check(
      "operator_approval",
      recovery.operatorReviewed && recovery.operatorApprovalRef
        ? "pass"
        : "blocked",
      recovery.operatorApprovalRef
        ? "operator approval reference supplied"
        : "operator approval reference is required",
    ),
    evidenceCheck(
      "diagnosis_evidence",
      recovery.diagnosisEvidenceRefs,
      true,
    ),
    evidenceCheck(
      "repair_evidence",
      recovery.repairEvidenceRefs,
      sameCheckpointRecovery,
    ),
    evidenceCheck(
      "verification_evidence",
      recovery.verificationEvidenceRefs,
      sameCheckpointRecovery,
    ),
    check(
      "recovery_window",
      recoveryWindow.status === "pass" &&
        recoveryWindow.action === "continue"
        ? "pass"
        : sameCheckpointRecovery
          ? "blocked"
          : "pass",
      sameCheckpointRecovery
        ? recoveryWindow.status === "pass" &&
          recoveryWindow.action === "continue"
          ? "post-repair replay window passes the original drift guard"
          : "same-checkpoint recovery requires a passing post-repair replay window"
        : "old-baseline replay is not the final authority for this recovery route",
    ),
    check(
      "same_checkpoint_path",
      sameCheckpointRecovery ? "pass" : "blocked",
      sameCheckpointRecovery
        ? "classification permits same-checkpoint requalification"
        : recovery.classification === "workload_drift"
          ? "workload drift requires a reviewed replacement baseline"
          : recovery.classification === "checkpoint_regression"
            ? "checkpoint regression requires a new checkpoint lineage"
            : "unknown diagnosis cannot requalify a checkpoint",
    ),
  ];

  const base = {
    schemaVersion: "mso.hold-requalification.v0" as const,
    requalificationId: `requal-${recovery.recoveryId}`,
    createdAt: (options.now ?? new Date()).toISOString(),
    holdId: hold.holdId,
    recoveryId: recovery.recoveryId,
    classification: recovery.classification,
    decisionSurface: activationPolicy.decisionSurface,
    candidateCheckpointId: activationPolicy.candidateCheckpointId,
    candidateFingerprint: activationPolicy.candidateFingerprint,
    previousActivationPolicyId: activationPolicy.policyId,
    previousDriftPolicyId: driftPolicy.policyId,
    automaticReactivation: false as const,
    automaticRollback: false as const,
    oldSessionReusable: false as const,
    checks,
    recoveryWindow,
    diagnosisEvidenceRefs: [...recovery.diagnosisEvidenceRefs],
    repairEvidenceRefs: [...recovery.repairEvidenceRefs],
    verificationEvidenceRefs: [...recovery.verificationEvidenceRefs],
    ...(recovery.operatorApprovalRef
      ? { operatorApprovalRef: recovery.operatorApprovalRef }
      : {}),
  };

  if (recovery.classification === "workload_drift") {
    return {
      evidence: {
        ...base,
        status: "blocked",
        action: "requires_rebaseline",
      },
    };
  }
  if (recovery.classification === "checkpoint_regression") {
    return {
      evidence: {
        ...base,
        status: "blocked",
        action: "requires_new_checkpoint",
      },
    };
  }
  if (recovery.classification === "unknown") {
    return {
      evidence: {
        ...base,
        status: "blocked",
        action: "diagnosis_required",
      },
    };
  }

  if (checks.some((item) => item.status !== "pass")) {
    return {
      evidence: {
        ...base,
        status: "blocked",
        action: "hold_remains",
      },
    };
  }

  const lineage = deriveLineageState(registry);
  if (lineage.recordedHeadCheckpointId !== hold.candidateCheckpointId) {
    throw new Error(
      "held checkpoint is no longer the current lineage head",
    );
  }
  const currentCheckpoint = lineage.checkpoints[hold.candidateCheckpointId];
  if (
    !currentCheckpoint ||
    currentCheckpoint.lifecycle !== "promoted" ||
    currentCheckpoint.checkpoint.fingerprint !== hold.candidateFingerprint
  ) {
    throw new Error(
      "held checkpoint is no longer the same promoted lineage artifact",
    );
  }
  if (
    !currentCheckpoint.latestRollbackTargetId ||
    !lineage.checkpoints[currentCheckpoint.latestRollbackTargetId]?.knownGood
  ) {
    throw new Error(
      "held checkpoint no longer has a known-good rollback target",
    );
  }

  const restartPolicy = buildCanaryActivationPolicy(registry, {
    policyId: options.newActivationPolicyId,
    candidateProviderId: activationPolicy.candidateProviderId,
    incumbentProviderId: activationPolicy.incumbentProviderId,
    stage: "canary_1",
    allowedPatterns: [...activationPolicy.allowedPatterns],
    circuitBreaker: { ...activationPolicy.circuitBreaker },
  });

  return {
    evidence: {
      ...base,
      status: "pass",
      action: "eligible_for_new_canary",
      restartStage: "canary_1",
      newActivationPolicyId: restartPolicy.policyId,
    },
    restartPolicy,
  };
};
