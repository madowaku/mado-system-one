import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PromotionGateEvidence } from "../promotion/gate.js";
import type { CandidateReevalEvidence } from "../reeval/candidate.js";
import {
  verifyLineageRegistry,
  type CheckpointLineageRegistry,
  type RollbackPlan,
} from "./registry.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

export const parseCheckpointLineageRegistry = (
  value: unknown,
): CheckpointLineageRegistry => {
  if (!record(value) || value.schemaVersion !== "mso.checkpoint-lineage.v0") {
    throw new Error(
      "checkpoint lineage registry must use schemaVersion mso.checkpoint-lineage.v0",
    );
  }
  if (!Array.isArray(value.events)) {
    throw new Error("checkpoint lineage registry events must be an array");
  }
  const registry = value as unknown as CheckpointLineageRegistry;
  verifyLineageRegistry(registry);
  return registry;
};

export const parseRollbackPlan = (value: unknown): RollbackPlan => {
  if (!record(value) || value.schemaVersion !== "mso.rollback-plan.v0") {
    throw new Error("rollback plan must use schemaVersion mso.rollback-plan.v0");
  }
  nonEmptyString(value.planId, "rollback plan planId");
  nonEmptyString(value.registryId, "rollback plan registryId");
  nonEmptyString(value.decisionSurface, "rollback plan decisionSurface");
  nonEmptyString(value.fromCheckpointId, "rollback plan fromCheckpointId");
  nonEmptyString(value.toCheckpointId, "rollback plan toCheckpointId");
  nonEmptyString(value.reason, "rollback plan reason");
  nonEmptyString(value.targetFingerprint, "rollback plan targetFingerprint");
  nonEmptyString(
    value.targetKnownGoodEvidenceRef,
    "rollback plan targetKnownGoodEvidenceRef",
  );
  if (!Array.isArray(value.path) || value.path.length < 2) {
    throw new Error("rollback plan path must contain source and target");
  }
  if (
    value.automaticExecution !== false ||
    value.runtimeAuthorityChanged !== false
  ) {
    throw new Error("rollback plan must remain non-executing");
  }
  return value as unknown as RollbackPlan;
};

export const parsePromotionGateEvidence = (
  value: unknown,
): PromotionGateEvidence => {
  if (!record(value) || value.schemaVersion !== "mso.promotion-gate.v0") {
    throw new Error(
      "promotion evidence must use schemaVersion mso.promotion-gate.v0",
    );
  }
  nonEmptyString(value.gateId, "promotion gate gateId");
  nonEmptyString(value.candidateProviderId, "promotion gate candidateProviderId");
  nonEmptyString(value.decisionSurface, "promotion gate decisionSurface");
  if (value.automaticPromotion !== false) {
    throw new Error("promotion gate must record automaticPromotion=false");
  }
  return value as unknown as PromotionGateEvidence;
};

export const parseCandidateReevalEvidence = (
  value: unknown,
): CandidateReevalEvidence => {
  if (!record(value) || value.schemaVersion !== "mso.reeval.v0") {
    throw new Error("re-eval evidence must use schemaVersion mso.reeval.v0");
  }
  nonEmptyString(value.reevalId, "re-eval reevalId");
  nonEmptyString(value.candidateProviderId, "re-eval candidateProviderId");
  if (!record(value.baseCheckpoint) || !record(value.candidateCheckpoint)) {
    throw new Error("re-eval evidence must include base/candidate checkpoints");
  }
  nonEmptyString(
    value.baseCheckpoint.fingerprint,
    "re-eval base checkpoint fingerprint",
  );
  nonEmptyString(
    value.candidateCheckpoint.fingerprint,
    "re-eval candidate checkpoint fingerprint",
  );
  return value as unknown as CandidateReevalEvidence;
};

const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
};

export const readCheckpointLineageRegistry = async (
  path: string,
): Promise<CheckpointLineageRegistry> =>
  parseCheckpointLineageRegistry(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );

export const writeCheckpointLineageRegistry = async (
  path: string,
  registry: CheckpointLineageRegistry,
): Promise<void> => {
  verifyLineageRegistry(registry);
  await writeJsonAtomic(path, registry);
};

export const writeRollbackPlan = async (
  path: string,
  plan: RollbackPlan,
): Promise<void> => {
  parseRollbackPlan(plan);
  await writeJsonAtomic(path, plan);
};


export const mutateCheckpointLineageRegistry = async (
  path: string,
  mutate: (
    registry: CheckpointLineageRegistry,
  ) => CheckpointLineageRegistry | Promise<CheckpointLineageRegistry>,
): Promise<CheckpointLineageRegistry> => {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    throw new Error(
      `checkpoint lineage registry is locked by another writer: ${lockPath}`,
      { cause: error },
    );
  }

  try {
    const current = await readCheckpointLineageRegistry(path);
    const next = await mutate(current);
    verifyLineageRegistry(next);
    await writeCheckpointLineageRegistry(path, next);
    return next;
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
};


export const createCheckpointLineageRegistryFile = async (
  path: string,
  registry: CheckpointLineageRegistry,
): Promise<void> => {
  verifyLineageRegistry(registry);
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(path, "wx");
  } catch (error) {
    throw new Error(
      `checkpoint lineage registry already exists or cannot be created: ${path}`,
      { cause: error },
    );
  }
  try {
    await handle.writeFile(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
};
