/**
 * The OpenCode session cost/usage stream is not an invoice. This module accepts
 * only separately operator-attested, per-run actual billing ledger evidence.
 * An attestation is auditable metadata, NOT cryptographic invoice verification.
 */
import { createHash } from "node:crypto";
import type { DogfoodEvidence } from "./sandbox-execution.js";
import type { PairedCodingCase, PairedCodingRun } from "./multi-free-bakeoff.js";

export interface BillingAttestation {
  schemaVersion: "mso.coding-billing-attestation.v0";
  runId: string;
  providerId: string;
  currency: "USD";
  billedUsd: number;
  invoiceLineRef: string;
  sourceRef: string;
  verifiedAt: string;
  verifiedBy: string;
  attribution: "individual_run";
  sourceKind: "provider_billing_ledger";
  independentlyReviewed: true;
}
export interface VerificationAttestation {
  schemaVersion: "mso.coding-independent-verification.v0";
  runId: string;
  caseId: string;
  providerId: string;
  testStatus: "pass" | "fail" | "not_run";
  reviewStatus: "pass" | "fail" | "not_run";
  testEvidenceRef?: string;
  reviewEvidenceRef?: string;
  verifiedBy: string;
  verificationRef: string;
}
export interface ProofReconciliation {
  schemaVersion: "mso.coding-proof-reconciliation.v0";
  runId: string;
  caseId: string;
  providerId: string;
  evidenceOnly: true;
  actualBillingSource: "operator_attested_ledger" | "unverified";
  billedUsd: number | null;
  billingEvidenceRef: string | null;
  independentlyVerified: boolean;
  qualificationRun: PairedCodingRun;
  automaticRoutingDecision: false;
  productionAuthorityChange: false;
}

const asObject = (v: unknown, label: string): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(label + " must be an object");
  return v as Record<string, unknown>;
};
const keys = (o: Record<string, unknown>, names: readonly string[], label: string): void => {
  for (const k of Object.keys(o)) if (!names.includes(k)) throw new Error(label + " unknown key " + k);
};
const nonempty = (v: unknown, label: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new Error(label + " is required");
  return v;
};
const timestamp = (v: unknown, label: string): string => {
  const text = nonempty(v, label);
  if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new Error(label + " must be UTC ISO timestamp");
  }
  return text;
};
export const parseBillingAttestation = (raw: unknown): BillingAttestation => {
  const data = asObject(raw, "billing");
  keys(data, ["schemaVersion","runId","providerId","currency","billedUsd","invoiceLineRef","sourceRef","verifiedAt","verifiedBy","attribution","sourceKind","independentlyReviewed"], "billing");
  if (data.schemaVersion !== "mso.coding-billing-attestation.v0" ||
      data.currency !== "USD" || data.attribution !== "individual_run" ||
      data.sourceKind !== "provider_billing_ledger" || data.independentlyReviewed !== true) {
    throw new Error("actual individual-run provider ledger attestation is required");
  }
  if (typeof data.billedUsd !== "number" || !Number.isFinite(data.billedUsd) || data.billedUsd < 0) {
    throw new Error("billedUsd must be an actual nonnegative USD amount");
  }
  return {
    schemaVersion: "mso.coding-billing-attestation.v0",
    runId: nonempty(data.runId,"billing.runId"),
    providerId: nonempty(data.providerId,"billing.providerId"),
    currency: "USD", billedUsd: data.billedUsd,
    invoiceLineRef: nonempty(data.invoiceLineRef,"invoiceLineRef"),
    sourceRef: nonempty(data.sourceRef,"sourceRef"),
    verifiedAt: timestamp(data.verifiedAt, "verifiedAt"),
    verifiedBy: nonempty(data.verifiedBy,"verifiedBy"),
    attribution: "individual_run",
    sourceKind: "provider_billing_ledger",
    independentlyReviewed: true,
  };
};
export const parseVerificationAttestation = (raw: unknown): VerificationAttestation => {
  const data = asObject(raw, "verification");
  keys(data, ["schemaVersion","runId","caseId","providerId","testStatus","reviewStatus","testEvidenceRef","reviewEvidenceRef","verifiedBy","verificationRef"], "verification");
  if (data.schemaVersion !== "mso.coding-independent-verification.v0") throw new Error("wrong verification schema");
  if (!["pass","fail","not_run"].includes(String(data.testStatus)) ||
      !["pass","fail","not_run"].includes(String(data.reviewStatus))) {
    throw new Error("invalid test/review status");
  }
  if (data.testStatus === "pass") nonempty(data.testEvidenceRef, "testEvidenceRef");
  if (data.reviewStatus === "pass") nonempty(data.reviewEvidenceRef, "reviewEvidenceRef");
  return {
    schemaVersion: "mso.coding-independent-verification.v0",
    runId: nonempty(data.runId,"verification.runId"),
    caseId: nonempty(data.caseId,"verification.caseId"),
    providerId: nonempty(data.providerId,"verification.providerId"),
    testStatus: data.testStatus as VerificationAttestation["testStatus"],
    reviewStatus: data.reviewStatus as VerificationAttestation["reviewStatus"],
    ...(data.testEvidenceRef === undefined ? {} : { testEvidenceRef: nonempty(data.testEvidenceRef,"testEvidenceRef") }),
    ...(data.reviewEvidenceRef === undefined ? {} : { reviewEvidenceRef: nonempty(data.reviewEvidenceRef,"reviewEvidenceRef") }),
    verifiedBy: nonempty(data.verifiedBy,"verifiedBy"),
    verificationRef: nonempty(data.verificationRef,"verificationRef"),
  };
};
export const reconcileDogfoodProof = (
  run: DogfoodEvidence, task: PairedCodingCase,
  billingRaw: unknown | null, verificationRaw: unknown | null,
): ProofReconciliation => {
  if (run.schemaVersion !== "mso.coding-dogfood-run.v0" || run.provenance !== "live" ||
      run.automaticallyQualified !== false) throw new Error("untrusted or synthetic execution");
  if (run.caseId !== task.id) throw new Error("case mismatch");
  if (!/^sha256:[0-9a-f]{64}$/.test(task.snapshotRef) ||
      task.snapshotRef !== "sha256:" + run.fixtureSha256) throw new Error("fixture digest does not match registered task");
  const billing = billingRaw === null ? null : parseBillingAttestation(billingRaw);
  const verification = verificationRaw === null ? null : parseVerificationAttestation(verificationRaw);
  if (billing && (billing.runId !== run.runId || billing.providerId !== run.providerId)) {
    throw new Error("cross-run or cross-provider billing receipt");
  }
  if (verification && (verification.runId !== run.runId ||
      verification.caseId !== run.caseId || verification.providerId !== run.providerId)) {
    throw new Error("cross-run or cross-provider verification");
  }
  const billingEvidenceRef = billing
    ? "ledger-proof:sha256:" + createHash("sha256").update(JSON.stringify(billing)).digest("hex")
    : null;
  const verificationAccepted = run.status === "succeeded";
  const testStatus = verificationAccepted ? verification?.testStatus ?? "not_run" : "not_run";
  const reviewStatus = verificationAccepted ? verification?.reviewStatus ?? "not_run" : "not_run";
  const qualificationRun: PairedCodingRun = {
    caseId: task.id, providerId: run.providerId, provenance: "live",
    testStatus, reviewStatus,
    ...(testStatus === "pass" && verification?.testEvidenceRef ? { testEvidenceRef: verification.testEvidenceRef } : {}),
    ...(reviewStatus === "pass" && verification?.reviewEvidenceRef ? { reviewEvidenceRef: verification.reviewEvidenceRef } : {}),
    artifactRef: run.artifactRef,
    elapsedMs: run.elapsedMs,
    billedUsd: billing?.billedUsd ?? null,
    ...(billingEvidenceRef ? { billingEvidenceRef } : {}),
    snapshotRef: task.snapshotRef,
    instructionRef: task.instructionRef,
    testPlanRef: task.testPlanRef,
    budgetRef: task.budgetRef,
  };
  return {
    schemaVersion: "mso.coding-proof-reconciliation.v0",
    runId: run.runId, caseId: run.caseId, providerId: run.providerId,
    evidenceOnly: true,
    actualBillingSource: billing ? "operator_attested_ledger" : "unverified",
    billedUsd: billing?.billedUsd ?? null,
    billingEvidenceRef,
    independentlyVerified: testStatus === "pass" && reviewStatus === "pass",
    qualificationRun,
    automaticRoutingDecision: false,
    productionAuthorityChange: false,
  };
};
