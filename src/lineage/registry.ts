import { createHash } from "node:crypto";
import type { PromotionGateEvidence } from "../promotion/gate.js";
import type { LayaCheckpointFingerprint } from "../reeval/checkpoint.js";
import type { CandidateReevalEvidence } from "../reeval/candidate.js";

export type CheckpointOrigin = "base" | "fine_tune" | "imported";
export type CheckpointLifecycle =
  | "registered"
  | "promoted"
  | "restored"
  | "superseded"
  | "rolled_back";

export interface CheckpointRegisteredPayload {
  checkpointId: string;
  checkpoint: LayaCheckpointFingerprint;
  origin: CheckpointOrigin;
  knownGood: boolean;
  knownGoodEvidenceRef?: string;
  parentCheckpointId?: string;
  fineTunePackRef?: string;
  reevalEvidenceRef?: string;
  reevalId?: string;
}

export interface PromotionRecordedPayload {
  checkpointId: string;
  gateId: string;
  gateEvidenceRef: string;
  reevalId: string;
  reevalEvidenceRef: string;
  rollbackTargetId: string;
}

export interface RollbackSafetySetPayload {
  checkpointId: string;
  eligible: boolean;
  evidenceRef: string;
  reason: string;
}

export interface RollbackRecordedPayload {
  planId: string;
  fromCheckpointId: string;
  toCheckpointId: string;
  reason: string;
  executionRef: string;
}

export type LineageEventPayload =
  | {
      type: "checkpoint_registered";
      data: CheckpointRegisteredPayload;
    }
  | {
      type: "promotion_recorded";
      data: PromotionRecordedPayload;
    }
  | {
      type: "rollback_safety_set";
      data: RollbackSafetySetPayload;
    }
  | {
      type: "rollback_recorded";
      data: RollbackRecordedPayload;
    };

export interface LineageEvent {
  eventId: string;
  occurredAt: string;
  prevEventHash: string | null;
  eventHash: string;
  payload: LineageEventPayload;
}

export interface CheckpointLineageRegistry {
  schemaVersion: "mso.checkpoint-lineage.v0";
  registryId: string;
  decisionSurface: string;
  providerFamily: "laya";
  runtimeAuthorityManaged: false;
  createdAt: string;
  events: readonly LineageEvent[];
}

export interface DerivedCheckpoint {
  checkpointId: string;
  checkpoint: LayaCheckpointFingerprint;
  origin: CheckpointOrigin;
  knownGood: boolean;
  knownGoodEvidenceRef?: string;
  parentCheckpointId?: string;
  childCheckpointIds: readonly string[];
  lifecycle: CheckpointLifecycle;
  promotionCount: number;
  rollbackCount: number;
  latestGateId?: string;
  latestRollbackTargetId?: string;
  fineTunePackRef?: string;
  reevalEvidenceRef?: string;
  reevalId?: string;
}

export interface DerivedLineageState {
  registryId: string;
  decisionSurface: string;
  recordedHeadCheckpointId?: string;
  checkpoints: Readonly<Record<string, DerivedCheckpoint>>;
  eventCount: number;
  headEventHash: string | null;
}

export interface RollbackPlan {
  schemaVersion: "mso.rollback-plan.v0";
  planId: string;
  registryId: string;
  decisionSurface: string;
  createdAt: string;
  fromCheckpointId: string;
  toCheckpointId: string;
  reason: string;
  path: readonly string[];
  targetFingerprint: string;
  targetRef: string;
  targetKnownGood: true;
  targetKnownGoodEvidenceRef: string;
  automaticExecution: false;
  runtimeAuthorityChanged: false;
  requiredAction:
    "operator_switch_runtime_checkpoint_then_record_execution";
  registryHeadEventHash: string | null;
}

const nonEmpty = (value: string, label: string): string => {
  if (!value.trim()) throw new Error(`${label} must be non-empty`);
  return value;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
};

const eventHash = (
  event: Omit<LineageEvent, "eventHash">,
): string =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(event)))
    .digest("hex");

const checkpointFromRegistration = (
  payload: CheckpointRegisteredPayload,
): DerivedCheckpoint => ({
  checkpointId: payload.checkpointId,
  checkpoint: payload.checkpoint,
  origin: payload.origin,
  knownGood: payload.knownGood,
  ...(payload.knownGoodEvidenceRef
    ? { knownGoodEvidenceRef: payload.knownGoodEvidenceRef }
    : {}),
  ...(payload.parentCheckpointId
    ? { parentCheckpointId: payload.parentCheckpointId }
    : {}),
  childCheckpointIds: [],
  lifecycle: "registered",
  promotionCount: 0,
  rollbackCount: 0,
  ...(payload.fineTunePackRef ? { fineTunePackRef: payload.fineTunePackRef } : {}),
  ...(payload.reevalEvidenceRef
    ? { reevalEvidenceRef: payload.reevalEvidenceRef }
    : {}),
  ...(payload.reevalId ? { reevalId: payload.reevalId } : {}),
});

const ancestorPath = (
  checkpoints: Readonly<Record<string, DerivedCheckpoint>>,
  fromCheckpointId: string,
  toCheckpointId: string,
): string[] | null => {
  const path = [fromCheckpointId];
  let current = checkpoints[fromCheckpointId];
  while (current?.parentCheckpointId) {
    path.push(current.parentCheckpointId);
    if (current.parentCheckpointId === toCheckpointId) return path;
    current = checkpoints[current.parentCheckpointId];
  }
  return fromCheckpointId === toCheckpointId ? path : null;
};

export const createCheckpointLineageRegistry = (
  registryId: string,
  decisionSurface: string,
  now: Date = new Date(),
): CheckpointLineageRegistry => ({
  schemaVersion: "mso.checkpoint-lineage.v0",
  registryId: nonEmpty(registryId, "registryId"),
  decisionSurface: nonEmpty(decisionSurface, "decisionSurface"),
  providerFamily: "laya",
  runtimeAuthorityManaged: false,
  createdAt: now.toISOString(),
  events: [],
});

export const verifyLineageRegistry = (
  registry: CheckpointLineageRegistry,
): void => {
  if (registry.schemaVersion !== "mso.checkpoint-lineage.v0") {
    throw new Error("unsupported checkpoint lineage schema");
  }
  nonEmpty(registry.registryId, "registryId");
  nonEmpty(registry.decisionSurface, "decisionSurface");
  if (registry.providerFamily !== "laya") {
    throw new Error("checkpoint lineage providerFamily must be laya");
  }
  if (registry.runtimeAuthorityManaged !== false) {
    throw new Error("checkpoint lineage must not manage runtime authority");
  }

  let previousHash: string | null = null;
  const seenEventIds = new Set<string>();
  const allowedEventTypes = new Set([
    "checkpoint_registered",
    "promotion_recorded",
    "rollback_safety_set",
    "rollback_recorded",
  ]);
  for (const [index, event] of registry.events.entries()) {
    const rawPayload = event.payload as unknown;
    if (
      typeof rawPayload !== "object" ||
      rawPayload === null ||
      !("type" in rawPayload) ||
      !("data" in rawPayload) ||
      !allowedEventTypes.has(String((rawPayload as { type?: unknown }).type))
    ) {
      throw new Error(`lineage event ${index} has unsupported payload`);
    }
    if (seenEventIds.has(event.eventId)) {
      throw new Error(`duplicate lineage eventId: ${event.eventId}`);
    }
    seenEventIds.add(event.eventId);
    if (event.prevEventHash !== previousHash) {
      throw new Error(
        `lineage event ${index} prevEventHash does not match chain head`,
      );
    }
    const expectedHash = eventHash({
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      prevEventHash: event.prevEventHash,
      payload: event.payload,
    });
    if (event.eventHash !== expectedHash) {
      throw new Error(`lineage event ${event.eventId} hash mismatch`);
    }
    previousHash = event.eventHash;
  }

  deriveLineageState(registry);
};

const applyRegistration = (
  checkpoints: Record<string, DerivedCheckpoint>,
  payload: CheckpointRegisteredPayload,
): void => {
  nonEmpty(payload.checkpointId, "checkpointId");
  if (
    payload.checkpoint.schemaVersion !== "mso.laya-checkpoint.v0" ||
    payload.checkpoint.format !== "laya-ts-onnx" ||
    !/^[a-f0-9]{64}$/i.test(payload.checkpoint.fingerprint)
  ) {
    throw new Error(
      `checkpoint ${payload.checkpointId} has invalid Laya ONNX fingerprint contract`,
    );
  }
  if (checkpoints[payload.checkpointId]) {
    throw new Error(`checkpoint already registered: ${payload.checkpointId}`);
  }
  const duplicateFingerprint = Object.values(checkpoints).find(
    (item) => item.checkpoint.fingerprint === payload.checkpoint.fingerprint,
  );
  if (duplicateFingerprint) {
    throw new Error(
      `checkpoint fingerprint already registered as ${duplicateFingerprint.checkpointId}`,
    );
  }
  if (payload.parentCheckpointId && !checkpoints[payload.parentCheckpointId]) {
    throw new Error(
      `parent checkpoint is not registered: ${payload.parentCheckpointId}`,
    );
  }
  if (payload.origin === "fine_tune" && !payload.parentCheckpointId) {
    throw new Error("fine_tune checkpoint requires parentCheckpointId");
  }
  if (payload.knownGood) {
    nonEmpty(
      payload.knownGoodEvidenceRef ?? "",
      "knownGood checkpoint knownGoodEvidenceRef",
    );
  }
  if (payload.knownGood && payload.origin === "fine_tune" && !payload.reevalId) {
    throw new Error(
      "fine_tune checkpoint cannot be knownGood without re-evaluation evidence",
    );
  }

  checkpoints[payload.checkpointId] = checkpointFromRegistration(payload);
  if (payload.parentCheckpointId) {
    const parent = checkpoints[payload.parentCheckpointId];
    if (parent) {
      checkpoints[payload.parentCheckpointId] = {
        ...parent,
        childCheckpointIds: [
          ...parent.childCheckpointIds,
          payload.checkpointId,
        ],
      };
    }
  }
};


const applyRollbackSafety = (
  checkpoints: Record<string, DerivedCheckpoint>,
  payload: RollbackSafetySetPayload,
): void => {
  const checkpoint = checkpoints[payload.checkpointId];
  if (!checkpoint) {
    throw new Error(
      `rollback safety checkpoint is not registered: ${payload.checkpointId}`,
    );
  }
  nonEmpty(payload.evidenceRef, "rollback safety evidenceRef");
  nonEmpty(payload.reason, "rollback safety reason");
  checkpoints[payload.checkpointId] = {
    ...checkpoint,
    knownGood: payload.eligible,
    knownGoodEvidenceRef: payload.evidenceRef,
  };
};

const applyPromotion = (
  checkpoints: Record<string, DerivedCheckpoint>,
  payload: PromotionRecordedPayload,
  recordedHeadCheckpointId: string | undefined,
): string => {
  const checkpoint = checkpoints[payload.checkpointId];
  if (!checkpoint) {
    throw new Error(
      `promotion checkpoint is not registered: ${payload.checkpointId}`,
    );
  }
  if (
    recordedHeadCheckpointId &&
    checkpoint.parentCheckpointId !== recordedHeadCheckpointId
  ) {
    throw new Error(
      `promotion candidate parent ${checkpoint.parentCheckpointId ?? "none"} does not match recorded head ${recordedHeadCheckpointId}`,
    );
  }

  const rollbackTarget = checkpoints[payload.rollbackTargetId];
  if (!rollbackTarget) {
    throw new Error(
      `rollback target is not registered: ${payload.rollbackTargetId}`,
    );
  }
  if (!rollbackTarget.knownGood) {
    throw new Error(
      `rollback target is not marked knownGood: ${payload.rollbackTargetId}`,
    );
  }
  const path = ancestorPath(
    checkpoints,
    payload.checkpointId,
    payload.rollbackTargetId,
  );
  if (!path || path.length < 2) {
    throw new Error(
      "promotion rollback target must be an ancestor of the promoted checkpoint",
    );
  }

  if (
    recordedHeadCheckpointId &&
    recordedHeadCheckpointId !== payload.checkpointId
  ) {
    const previous = checkpoints[recordedHeadCheckpointId];
    if (
      previous?.lifecycle === "promoted" ||
      previous?.lifecycle === "restored"
    ) {
      checkpoints[recordedHeadCheckpointId] = {
        ...previous,
        lifecycle: "superseded",
      };
    }
  }

  checkpoints[payload.checkpointId] = {
    ...checkpoint,
    lifecycle: "promoted",
    promotionCount: checkpoint.promotionCount + 1,
    latestGateId: payload.gateId,
    latestRollbackTargetId: payload.rollbackTargetId,
    reevalEvidenceRef: payload.reevalEvidenceRef,
    reevalId: payload.reevalId,
  };
  return payload.checkpointId;
};

const applyRollback = (
  checkpoints: Record<string, DerivedCheckpoint>,
  payload: RollbackRecordedPayload,
  recordedHeadCheckpointId: string | undefined,
): string => {
  const from = checkpoints[payload.fromCheckpointId];
  const to = checkpoints[payload.toCheckpointId];
  if (!from || !to) {
    throw new Error("rollback endpoints must both be registered");
  }
  if (recordedHeadCheckpointId !== payload.fromCheckpointId) {
    throw new Error(
      `rollback source ${payload.fromCheckpointId} is not the recorded lineage head`,
    );
  }
  if (!to.knownGood) {
    throw new Error(
      `rollback target is not marked knownGood: ${payload.toCheckpointId}`,
    );
  }
  const path = ancestorPath(
    checkpoints,
    payload.fromCheckpointId,
    payload.toCheckpointId,
  );
  if (!path || path.length < 2) {
    throw new Error("rollback target must be an ancestor of the source checkpoint");
  }

  checkpoints[payload.fromCheckpointId] = {
    ...from,
    lifecycle: "rolled_back",
    rollbackCount: from.rollbackCount + 1,
  };
  checkpoints[payload.toCheckpointId] = {
    ...to,
    lifecycle: "restored",
  };
  return payload.toCheckpointId;
};

export const deriveLineageState = (
  registry: CheckpointLineageRegistry,
): DerivedLineageState => {
  const checkpoints: Record<string, DerivedCheckpoint> = {};
  let recordedHeadCheckpointId: string | undefined;

  for (const event of registry.events) {
    switch (event.payload.type) {
      case "checkpoint_registered":
        applyRegistration(checkpoints, event.payload.data);
        break;
      case "promotion_recorded":
        recordedHeadCheckpointId = applyPromotion(
          checkpoints,
          event.payload.data,
          recordedHeadCheckpointId,
        );
        break;
      case "rollback_safety_set":
        applyRollbackSafety(checkpoints, event.payload.data);
        break;
      case "rollback_recorded":
        recordedHeadCheckpointId = applyRollback(
          checkpoints,
          event.payload.data,
          recordedHeadCheckpointId,
        );
        break;
      default:
        throw new Error("unsupported lineage event type");
    }
  }

  const headEventHash =
    registry.events.length === 0
      ? null
      : registry.events[registry.events.length - 1]?.eventHash ?? null;
  return {
    registryId: registry.registryId,
    decisionSurface: registry.decisionSurface,
    ...(recordedHeadCheckpointId
      ? { recordedHeadCheckpointId }
      : {}),
    checkpoints,
    eventCount: registry.events.length,
    headEventHash,
  };
};

export const appendLineageEvent = (
  registry: CheckpointLineageRegistry,
  payload: LineageEventPayload,
  options: { eventId?: string; now?: Date } = {},
): CheckpointLineageRegistry => {
  verifyLineageRegistry(registry);
  const previous =
    registry.events.length === 0
      ? null
      : registry.events[registry.events.length - 1]?.eventHash ?? null;
  const occurredAt = (options.now ?? new Date()).toISOString();
  const eventId =
    options.eventId ??
    `${payload.type}-${String(registry.events.length + 1).padStart(6, "0")}-${occurredAt.replace(/[:.]/g, "-")}`;
  const unsigned = {
    eventId,
    occurredAt,
    prevEventHash: previous,
    payload,
  };
  const event: LineageEvent = {
    ...unsigned,
    eventHash: eventHash(unsigned),
  };
  const next: CheckpointLineageRegistry = {
    ...registry,
    events: [...registry.events, event],
  };
  verifyLineageRegistry(next);
  return next;
};

export const assertPromotionEvidence = (
  registry: CheckpointLineageRegistry,
  checkpointId: string,
  gate: PromotionGateEvidence,
  reeval: CandidateReevalEvidence,
): void => {
  const state = deriveLineageState(registry);
  const checkpoint = state.checkpoints[checkpointId];
  if (!checkpoint) {
    throw new Error(`checkpoint is not registered: ${checkpointId}`);
  }
  if (gate.decisionSurface !== registry.decisionSurface) {
    throw new Error(
      `promotion gate surface ${gate.decisionSurface} does not match registry surface ${registry.decisionSurface}`,
    );
  }
  if (
    gate.action !== "eligible_for_promotion" ||
    gate.maxEligibleStage !== "promoted"
  ) {
    throw new Error("promotion gate is not eligible_for_promotion");
  }
  if (gate.automaticPromotion !== false) {
    throw new Error("promotion evidence must not claim automatic promotion");
  }
  if (
    reeval.candidateCheckpoint.fingerprint !==
    checkpoint.checkpoint.fingerprint
  ) {
    throw new Error(
      "re-eval candidate fingerprint does not match registered checkpoint",
    );
  }
  if (checkpoint.parentCheckpointId) {
    const parent = state.checkpoints[checkpoint.parentCheckpointId];
    if (
      !parent ||
      reeval.baseCheckpoint.fingerprint !== parent.checkpoint.fingerprint
    ) {
      throw new Error(
        "re-eval base fingerprint does not match registered parent checkpoint",
      );
    }
  }
  if (gate.candidateProviderId !== reeval.candidateProviderId) {
    throw new Error(
      "promotion gate candidateProviderId does not match re-eval candidate provider",
    );
  }
};

export const planRollback = (
  registry: CheckpointLineageRegistry,
  toCheckpointId: string,
  options: {
    fromCheckpointId?: string;
    reason: string;
    planId?: string;
    now?: Date;
  },
): RollbackPlan => {
  verifyLineageRegistry(registry);
  const state = deriveLineageState(registry);
  const recordedHeadCheckpointId = state.recordedHeadCheckpointId;
  if (!recordedHeadCheckpointId) {
    throw new Error("lineage registry has no recorded head checkpoint");
  }
  if (
    options.fromCheckpointId &&
    options.fromCheckpointId !== recordedHeadCheckpointId
  ) {
    throw new Error(
      `rollback source assertion ${options.fromCheckpointId} does not match recorded head ${recordedHeadCheckpointId}`,
    );
  }
  const fromCheckpointId = recordedHeadCheckpointId;
  const target = state.checkpoints[toCheckpointId];
  if (!target) {
    throw new Error(`rollback target is not registered: ${toCheckpointId}`);
  }
  if (!target.knownGood) {
    throw new Error(`rollback target is not marked knownGood: ${toCheckpointId}`);
  }
  const path = ancestorPath(
    state.checkpoints,
    fromCheckpointId,
    toCheckpointId,
  );
  if (!path || path.length < 2) {
    throw new Error("rollback target must be an ancestor of the source checkpoint");
  }

  const createdAt = (options.now ?? new Date()).toISOString();
  return {
    schemaVersion: "mso.rollback-plan.v0",
    planId:
      options.planId ??
      `rollback-${createdAt.replace(/[:.]/g, "-")}`,
    registryId: registry.registryId,
    decisionSurface: registry.decisionSurface,
    createdAt,
    fromCheckpointId,
    toCheckpointId,
    reason: nonEmpty(options.reason, "rollback reason"),
    path,
    targetFingerprint: target.checkpoint.fingerprint,
    targetRef: target.checkpoint.ref,
    targetKnownGood: true,
    targetKnownGoodEvidenceRef:
      target.knownGoodEvidenceRef ??
      (() => {
        throw new Error("known-good target is missing evidence reference");
      })(),
    automaticExecution: false,
    runtimeAuthorityChanged: false,
    requiredAction:
      "operator_switch_runtime_checkpoint_then_record_execution",
    registryHeadEventHash: state.headEventHash,
  };
};

export const recordRollback = (
  registry: CheckpointLineageRegistry,
  plan: RollbackPlan,
  executionRef: string,
  options: { eventId?: string; now?: Date } = {},
): CheckpointLineageRegistry => {
  verifyLineageRegistry(registry);
  const state = deriveLineageState(registry);
  if (
    plan.registryId !== registry.registryId ||
    plan.decisionSurface !== registry.decisionSurface
  ) {
    throw new Error("rollback plan does not belong to this registry");
  }
  if (plan.automaticExecution !== false || plan.runtimeAuthorityChanged !== false) {
    throw new Error("rollback plan violates non-automatic execution contract");
  }
  if (plan.registryHeadEventHash !== state.headEventHash) {
    throw new Error(
      "rollback plan is stale because the lineage registry changed after planning",
    );
  }
  const target = state.checkpoints[plan.toCheckpointId];
  if (
    !target ||
    target.checkpoint.fingerprint !== plan.targetFingerprint ||
    !target.knownGood
  ) {
    throw new Error("rollback target no longer matches the planned known-good checkpoint");
  }

  return appendLineageEvent(
    registry,
    {
      type: "rollback_recorded",
      data: {
        planId: plan.planId,
        fromCheckpointId: plan.fromCheckpointId,
        toCheckpointId: plan.toCheckpointId,
        reason: plan.reason,
        executionRef: nonEmpty(executionRef, "executionRef"),
      },
    },
    options,
  );
};
