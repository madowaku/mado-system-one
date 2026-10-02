import { createHash } from "node:crypto";
import type { CanaryActivationPolicy } from "../activation/canary.js";
import type { ActiveLimitedDriftPolicy } from "../activation/drift.js";
import type {
  WorkloadBaselineMetrics,
  WorkloadRebaselineAcceptanceEvidence,
} from "../activation/rebaseline.js";
import type { CheckpointLineageRegistry } from "../lineage/registry.js";
import { deriveLineageState } from "../lineage/registry.js";

export type DistributionEpochOrigin = "initial" | "rebaseline";
export type DistributionEpochLifecycle = "current" | "superseded";

export interface DistributionEpochRegisteredPayload {
  epochId: string;
  origin: DistributionEpochOrigin;
  parentEpochId?: string;
  distributionSummary: string;
  baseline: WorkloadBaselineMetrics;
  sourceBaselinePolicyId: string;
  sourceDriftPolicyId: string;
  sourceEvidenceRefs: readonly string[];
  rebaselineId?: string;
}

export interface CheckpointEpochBindingRecordedPayload {
  bindingId: string;
  epochId: string;
  checkpointId: string;
  checkpointFingerprint: string;
  activationPolicyId: string;
  driftPolicyId: string;
  activationLineageHeadEventHash: string;
  recordedLineageHeadEventHash: string;
  evidenceRef: string;
}

export type BaselineLineageEventPayload =
  | {
      type: "epoch_registered";
      data: DistributionEpochRegisteredPayload;
    }
  | {
      type: "checkpoint_binding_recorded";
      data: CheckpointEpochBindingRecordedPayload;
    };

export interface BaselineLineageEvent {
  eventId: string;
  occurredAt: string;
  prevEventHash: string | null;
  eventHash: string;
  payload: BaselineLineageEventPayload;
}

export interface BaselineLineageRegistry {
  schemaVersion: "mso.baseline-lineage.v0";
  registryId: string;
  decisionSurface: string;
  providerFamily: "laya";
  runtimeAuthorityManaged: false;
  createdAt: string;
  events: readonly BaselineLineageEvent[];
}

export interface DerivedDistributionEpoch {
  epochId: string;
  ordinal: number;
  origin: DistributionEpochOrigin;
  parentEpochId?: string;
  childEpochIds: readonly string[];
  lifecycle: DistributionEpochLifecycle;
  distributionSummary: string;
  baseline: WorkloadBaselineMetrics;
  sourceBaselinePolicyId: string;
  sourceDriftPolicyId: string;
  sourceEvidenceRefs: readonly string[];
  rebaselineId?: string;
  bindingIds: readonly string[];
}

export interface DerivedCheckpointEpochBinding {
  bindingId: string;
  epochId: string;
  checkpointId: string;
  checkpointFingerprint: string;
  activationPolicyId: string;
  driftPolicyId: string;
  activationLineageHeadEventHash: string;
  recordedLineageHeadEventHash: string;
  evidenceRef: string;
}

export interface DerivedBaselineLineageState {
  registryId: string;
  decisionSurface: string;
  currentEpochId?: string;
  epochs: Readonly<Record<string, DerivedDistributionEpoch>>;
  bindings: Readonly<Record<string, DerivedCheckpointEpochBinding>>;
  checkpointEpochMatrix: Readonly<Record<string, readonly string[]>>;
  eventCount: number;
  headEventHash: string | null;
}

const nonEmpty = (value: string, label: string): string => {
  if (!value.trim()) throw new Error(`${label} must be non-empty`);
  return value;
};

const finite = (value: number, label: string): number => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
};

const nonNegativeInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
};

const rate = (value: number, label: string): number => {
  finite(value, label);
  if (value < 0 || value > 1) throw new Error(`${label} must be in [0,1]`);
  return value;
};

const nonNegative = (value: number, label: string): number => {
  finite(value, label);
  if (value < 0) throw new Error(`${label} must be non-negative`);
  return value;
};

const validateMetrics = (
  metrics: WorkloadBaselineMetrics,
  label: string,
): void => {
  nonNegativeInteger(metrics.traces, `${label}.traces`);
  nonNegativeInteger(
    metrics.candidateSelected,
    `${label}.candidateSelected`,
  );
  nonNegativeInteger(
    metrics.comparableQuestions,
    `${label}.comparableQuestions`,
  );
  nonNegativeInteger(
    metrics.candidateConfidenceSamples,
    `${label}.candidateConfidenceSamples`,
  );
  rate(
    metrics.meanCandidateConfidence,
    `${label}.meanCandidateConfidence`,
  );
  rate(metrics.candidateErrorRate, `${label}.candidateErrorRate`);
  rate(metrics.incumbentErrorRate, `${label}.incumbentErrorRate`);
  rate(metrics.fallbackRate, `${label}.fallbackRate`);
  rate(metrics.disagreementRate, `${label}.disagreementRate`);
  nonNegative(metrics.p95LatencyRatio, `${label}.p95LatencyRatio`);
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
  event: Omit<BaselineLineageEvent, "eventHash">,
): string =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(event)))
    .digest("hex");

const uniqueStrings = (
  values: readonly string[],
  label: string,
): readonly string[] => {
  const normalized = values.map((value) => nonEmpty(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  return normalized;
};

const applyEpoch = (
  epochs: Record<string, DerivedDistributionEpoch>,
  payload: DistributionEpochRegisteredPayload,
  currentEpochId: string | undefined,
): string => {
  nonEmpty(payload.epochId, "epochId");
  nonEmpty(payload.distributionSummary, "distributionSummary");
  nonEmpty(payload.sourceBaselinePolicyId, "sourceBaselinePolicyId");
  nonEmpty(payload.sourceDriftPolicyId, "sourceDriftPolicyId");
  validateMetrics(payload.baseline, "baseline");
  uniqueStrings(payload.sourceEvidenceRefs, "sourceEvidenceRefs");
  if (payload.sourceEvidenceRefs.length === 0) {
    throw new Error("sourceEvidenceRefs must be non-empty");
  }
  if (epochs[payload.epochId]) {
    throw new Error(`distribution epoch already registered: ${payload.epochId}`);
  }

  if (payload.origin === "initial") {
    if (currentEpochId || payload.parentEpochId) {
      throw new Error(
        "initial distribution epoch requires an empty registry and no parent",
      );
    }
    if (payload.rebaselineId) {
      throw new Error("initial distribution epoch must not carry rebaselineId");
    }
  } else {
    if (!currentEpochId) {
      throw new Error("rebaseline epoch requires an existing current epoch");
    }
    if (payload.parentEpochId !== currentEpochId) {
      throw new Error(
        `rebaseline parent ${payload.parentEpochId ?? "none"} does not match current epoch ${currentEpochId}`,
      );
    }
    nonEmpty(payload.rebaselineId ?? "", "rebaselineId");
  }

  if (currentEpochId) {
    const previous = epochs[currentEpochId];
    if (!previous) throw new Error("current distribution epoch is missing");
    epochs[currentEpochId] = {
      ...previous,
      lifecycle: "superseded",
      childEpochIds: [...previous.childEpochIds, payload.epochId],
    };
  }

  epochs[payload.epochId] = {
    epochId: payload.epochId,
    ordinal: Object.keys(epochs).length + 1,
    origin: payload.origin,
    ...(payload.parentEpochId
      ? { parentEpochId: payload.parentEpochId }
      : {}),
    childEpochIds: [],
    lifecycle: "current",
    distributionSummary: payload.distributionSummary,
    baseline: { ...payload.baseline },
    sourceBaselinePolicyId: payload.sourceBaselinePolicyId,
    sourceDriftPolicyId: payload.sourceDriftPolicyId,
    sourceEvidenceRefs: [...payload.sourceEvidenceRefs],
    ...(payload.rebaselineId
      ? { rebaselineId: payload.rebaselineId }
      : {}),
    bindingIds: [],
  };
  return payload.epochId;
};

const applyBinding = (
  epochs: Record<string, DerivedDistributionEpoch>,
  bindings: Record<string, DerivedCheckpointEpochBinding>,
  payload: CheckpointEpochBindingRecordedPayload,
): void => {
  nonEmpty(payload.bindingId, "bindingId");
  nonEmpty(payload.epochId, "epochId");
  nonEmpty(payload.checkpointId, "checkpointId");
  nonEmpty(payload.activationPolicyId, "activationPolicyId");
  nonEmpty(payload.driftPolicyId, "driftPolicyId");
  nonEmpty(
    payload.activationLineageHeadEventHash,
    "activationLineageHeadEventHash",
  );
  nonEmpty(
    payload.recordedLineageHeadEventHash,
    "recordedLineageHeadEventHash",
  );
  nonEmpty(payload.evidenceRef, "evidenceRef");
  if (!/^[a-f0-9]{64}$/i.test(payload.checkpointFingerprint)) {
    throw new Error("checkpointFingerprint must be a SHA-256 hex digest");
  }
  const epoch = epochs[payload.epochId];
  if (!epoch) {
    throw new Error(
      `checkpoint binding references unknown epoch: ${payload.epochId}`,
    );
  }
  if (bindings[payload.bindingId]) {
    throw new Error(`checkpoint binding already exists: ${payload.bindingId}`);
  }
  const duplicate = Object.values(bindings).find(
    (item) =>
      item.epochId === payload.epochId &&
      item.activationPolicyId === payload.activationPolicyId,
  );
  if (duplicate) {
    throw new Error(
      `activation policy is already bound to epoch ${payload.epochId}: ${payload.activationPolicyId}`,
    );
  }
  bindings[payload.bindingId] = { ...payload };
  epochs[payload.epochId] = {
    ...epoch,
    bindingIds: [...epoch.bindingIds, payload.bindingId],
  };
};

export const createBaselineLineageRegistry = (
  registryId: string,
  decisionSurface: string,
  now: Date = new Date(),
): BaselineLineageRegistry => ({
  schemaVersion: "mso.baseline-lineage.v0",
  registryId: nonEmpty(registryId, "registryId"),
  decisionSurface: nonEmpty(decisionSurface, "decisionSurface"),
  providerFamily: "laya",
  runtimeAuthorityManaged: false,
  createdAt: now.toISOString(),
  events: [],
});

export const deriveBaselineLineageState = (
  registry: BaselineLineageRegistry,
): DerivedBaselineLineageState => {
  const epochs: Record<string, DerivedDistributionEpoch> = {};
  const bindings: Record<string, DerivedCheckpointEpochBinding> = {};
  let currentEpochId: string | undefined;

  for (const event of registry.events) {
    switch (event.payload.type) {
      case "epoch_registered":
        currentEpochId = applyEpoch(
          epochs,
          event.payload.data,
          currentEpochId,
        );
        break;
      case "checkpoint_binding_recorded":
        applyBinding(epochs, bindings, event.payload.data);
        break;
      default:
        throw new Error("unsupported baseline lineage event type");
    }
  }

  const matrix: Record<string, string[]> = {};
  for (const binding of Object.values(bindings)) {
    const epochsForCheckpoint = matrix[binding.checkpointId] ?? [];
    if (!epochsForCheckpoint.includes(binding.epochId)) {
      matrix[binding.checkpointId] = [
        ...epochsForCheckpoint,
        binding.epochId,
      ];
    }
  }

  const headEventHash =
    registry.events.length === 0
      ? null
      : registry.events[registry.events.length - 1]?.eventHash ?? null;
  return {
    registryId: registry.registryId,
    decisionSurface: registry.decisionSurface,
    ...(currentEpochId ? { currentEpochId } : {}),
    epochs,
    bindings,
    checkpointEpochMatrix: matrix,
    eventCount: registry.events.length,
    headEventHash,
  };
};

export const verifyBaselineLineageRegistry = (
  registry: BaselineLineageRegistry,
): void => {
  if (registry.schemaVersion !== "mso.baseline-lineage.v0") {
    throw new Error("unsupported baseline lineage schema");
  }
  nonEmpty(registry.registryId, "registryId");
  nonEmpty(registry.decisionSurface, "decisionSurface");
  if (registry.providerFamily !== "laya") {
    throw new Error("baseline lineage providerFamily must be laya");
  }
  if (registry.runtimeAuthorityManaged !== false) {
    throw new Error("baseline lineage must not manage runtime authority");
  }

  let previousHash: string | null = null;
  const eventIds = new Set<string>();
  for (const [index, event] of registry.events.entries()) {
    if (eventIds.has(event.eventId)) {
      throw new Error(`duplicate baseline lineage eventId: ${event.eventId}`);
    }
    eventIds.add(event.eventId);
    if (event.prevEventHash !== previousHash) {
      throw new Error(
        `baseline lineage event ${index} prevEventHash does not match chain head`,
      );
    }
    const expectedHash = eventHash({
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      prevEventHash: event.prevEventHash,
      payload: event.payload,
    });
    if (event.eventHash !== expectedHash) {
      throw new Error(
        `baseline lineage event ${event.eventId} hash mismatch`,
      );
    }
    previousHash = event.eventHash;
  }
  deriveBaselineLineageState(registry);
};

export const appendBaselineLineageEvent = (
  registry: BaselineLineageRegistry,
  payload: BaselineLineageEventPayload,
  options: { eventId?: string; now?: Date } = {},
): BaselineLineageRegistry => {
  verifyBaselineLineageRegistry(registry);
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
  const event: BaselineLineageEvent = {
    ...unsigned,
    eventHash: eventHash(unsigned),
  };
  const next: BaselineLineageRegistry = {
    ...registry,
    events: [...registry.events, event],
  };
  verifyBaselineLineageRegistry(next);
  return next;
};

const metricsFromDriftPolicy = (
  policy: ActiveLimitedDriftPolicy,
): WorkloadBaselineMetrics => ({
  traces: policy.baseline.traces,
  candidateSelected: policy.baseline.candidateSelected,
  comparableQuestions: policy.baseline.comparableQuestions,
  candidateConfidenceSamples: policy.baseline.candidateConfidenceSamples,
  meanCandidateConfidence: policy.baseline.meanCandidateConfidence,
  candidateErrorRate: policy.baseline.candidateErrorRate,
  incumbentErrorRate: policy.baseline.incumbentErrorRate,
  fallbackRate: policy.baseline.fallbackRate,
  disagreementRate: policy.baseline.disagreementRate,
  p95LatencyRatio: policy.baseline.p95LatencyRatio,
});

const metricClose = (left: number, right: number): boolean =>
  Math.abs(left - right) <= 1e-12;

const metricsMatch = (
  left: WorkloadBaselineMetrics,
  right: WorkloadBaselineMetrics,
): boolean =>
  left.traces === right.traces &&
  left.candidateSelected === right.candidateSelected &&
  left.comparableQuestions === right.comparableQuestions &&
  left.candidateConfidenceSamples === right.candidateConfidenceSamples &&
  metricClose(left.meanCandidateConfidence, right.meanCandidateConfidence) &&
  metricClose(left.candidateErrorRate, right.candidateErrorRate) &&
  metricClose(left.incumbentErrorRate, right.incumbentErrorRate) &&
  metricClose(left.fallbackRate, right.fallbackRate) &&
  metricClose(left.disagreementRate, right.disagreementRate) &&
  metricClose(left.p95LatencyRatio, right.p95LatencyRatio);

const assertPolicyPair = (
  registry: BaselineLineageRegistry,
  checkpointRegistry: CheckpointLineageRegistry,
  activationPolicy: CanaryActivationPolicy,
  driftPolicy: ActiveLimitedDriftPolicy,
): { recordedLineageHeadEventHash: string } => {
  if (
    registry.decisionSurface !== activationPolicy.decisionSurface ||
    registry.decisionSurface !== driftPolicy.decisionSurface ||
    registry.decisionSurface !== checkpointRegistry.decisionSurface
  ) {
    throw new Error("baseline/checkpoint/policy decision surfaces do not match");
  }
  if (activationPolicy.stage !== "limited_active") {
    throw new Error("baseline binding requires limited_active activation policy");
  }
  if (
    driftPolicy.activationPolicyId !== activationPolicy.policyId ||
    driftPolicy.candidateCheckpointId !==
      activationPolicy.candidateCheckpointId ||
    driftPolicy.candidateFingerprint !==
      activationPolicy.candidateFingerprint ||
    driftPolicy.candidateProviderId !== activationPolicy.candidateProviderId ||
    driftPolicy.incumbentProviderId !==
      activationPolicy.incumbentProviderId ||
    driftPolicy.lineageHeadEventHash !==
      activationPolicy.lineageHeadEventHash
  ) {
    throw new Error("drift policy does not match activation policy identity");
  }

  const lineage = deriveLineageState(checkpointRegistry);
  if (
    lineage.recordedHeadCheckpointId !==
    activationPolicy.candidateCheckpointId
  ) {
    throw new Error("baseline binding checkpoint is not the lineage head");
  }
  const checkpoint =
    lineage.checkpoints[activationPolicy.candidateCheckpointId];
  if (
    !checkpoint ||
    (checkpoint.lifecycle !== "promoted" &&
      checkpoint.lifecycle !== "restored") ||
    checkpoint.checkpoint.fingerprint !==
      activationPolicy.candidateFingerprint
  ) {
    throw new Error("baseline binding checkpoint artifact does not match lineage");
  }
  if (!lineage.headEventHash) {
    throw new Error("checkpoint lineage must have an event-chain head");
  }
  return { recordedLineageHeadEventHash: lineage.headEventHash };
};

const bindingPayload = (
  registry: BaselineLineageRegistry,
  checkpointRegistry: CheckpointLineageRegistry,
  epochId: string,
  activationPolicy: CanaryActivationPolicy,
  driftPolicy: ActiveLimitedDriftPolicy,
  evidenceRef: string,
  bindingId: string,
): CheckpointEpochBindingRecordedPayload => {
  const { recordedLineageHeadEventHash } = assertPolicyPair(
    registry,
    checkpointRegistry,
    activationPolicy,
    driftPolicy,
  );
  return {
    bindingId: nonEmpty(bindingId, "bindingId"),
    epochId: nonEmpty(epochId, "epochId"),
    checkpointId: activationPolicy.candidateCheckpointId,
    checkpointFingerprint: activationPolicy.candidateFingerprint,
    activationPolicyId: activationPolicy.policyId,
    driftPolicyId: driftPolicy.policyId,
    activationLineageHeadEventHash: activationPolicy.lineageHeadEventHash,
    recordedLineageHeadEventHash,
    evidenceRef: nonEmpty(evidenceRef, "binding evidenceRef"),
  };
};

export const registerInitialDistributionEpoch = (
  registry: BaselineLineageRegistry,
  checkpointRegistry: CheckpointLineageRegistry,
  activationPolicy: CanaryActivationPolicy,
  driftPolicy: ActiveLimitedDriftPolicy,
  options: {
    epochId: string;
    distributionSummary: string;
    sourceEvidenceRefs: readonly string[];
    bindingEvidenceRef: string;
    bindingId?: string;
    now?: Date;
  },
): BaselineLineageRegistry => {
  verifyBaselineLineageRegistry(registry);
  const state = deriveBaselineLineageState(registry);
  if (state.currentEpochId) {
    throw new Error("initial distribution epoch already exists");
  }
  assertPolicyPair(
    registry,
    checkpointRegistry,
    activationPolicy,
    driftPolicy,
  );
  let next = appendBaselineLineageEvent(
    registry,
    {
      type: "epoch_registered",
      data: {
        epochId: nonEmpty(options.epochId, "epochId"),
        origin: "initial",
        distributionSummary: nonEmpty(
          options.distributionSummary,
          "distributionSummary",
        ),
        baseline: metricsFromDriftPolicy(driftPolicy),
        sourceBaselinePolicyId: driftPolicy.baseline.sourcePolicyId,
        sourceDriftPolicyId: driftPolicy.policyId,
        sourceEvidenceRefs: uniqueStrings(
          options.sourceEvidenceRefs,
          "sourceEvidenceRefs",
        ),
      },
    },
    { now: options.now },
  );
  next = appendBaselineLineageEvent(
    next,
    {
      type: "checkpoint_binding_recorded",
      data: bindingPayload(
        next,
        checkpointRegistry,
        options.epochId,
        activationPolicy,
        driftPolicy,
        options.bindingEvidenceRef,
        options.bindingId ?? `binding-${options.epochId}-${activationPolicy.policyId}`,
      ),
    },
    { now: options.now },
  );
  return next;
};

export const registerRebaselineDistributionEpoch = (
  registry: BaselineLineageRegistry,
  checkpointRegistry: CheckpointLineageRegistry,
  acceptance: WorkloadRebaselineAcceptanceEvidence,
  activationPolicy: CanaryActivationPolicy,
  driftPolicy: ActiveLimitedDriftPolicy,
  options: {
    epochId: string;
    acceptanceEvidenceRef: string;
    bindingEvidenceRef: string;
    bindingId?: string;
    now?: Date;
  },
): BaselineLineageRegistry => {
  verifyBaselineLineageRegistry(registry);
  const state = deriveBaselineLineageState(registry);
  const parentEpochId = state.currentEpochId;
  if (!parentEpochId) {
    throw new Error("rebaseline registration requires an existing epoch");
  }
  if (
    acceptance.status !== "pass" ||
    acceptance.action !== "eligible_for_limited_active" ||
    acceptance.automaticActivation !== false ||
    acceptance.oldBaselineReplaced !== false
  ) {
    throw new Error("rebaseline acceptance is not eligible for baseline lineage");
  }
  if (
    acceptance.decisionSurface !== registry.decisionSurface ||
    acceptance.candidateCheckpointId !==
      activationPolicy.candidateCheckpointId ||
    acceptance.candidateFingerprint !==
      activationPolicy.candidateFingerprint ||
    acceptance.limitedActivePolicyId !== activationPolicy.policyId ||
    acceptance.driftPolicyId !== driftPolicy.policyId
  ) {
    throw new Error("rebaseline acceptance identity does not match policies");
  }
  const newMetrics = metricsFromDriftPolicy(driftPolicy);
  if (!metricsMatch(acceptance.acceptedBaseline, newMetrics)) {
    throw new Error(
      "rebaseline acceptance metrics do not match drift policy baseline",
    );
  }
  assertPolicyPair(
    registry,
    checkpointRegistry,
    activationPolicy,
    driftPolicy,
  );

  const sourceEvidenceRefs = uniqueStrings(
    [
      nonEmpty(options.acceptanceEvidenceRef, "acceptanceEvidenceRef"),
      ...acceptance.review.evidenceRefs,
    ],
    "sourceEvidenceRefs",
  );
  let next = appendBaselineLineageEvent(
    registry,
    {
      type: "epoch_registered",
      data: {
        epochId: nonEmpty(options.epochId, "epochId"),
        origin: "rebaseline",
        parentEpochId,
        distributionSummary: nonEmpty(
          acceptance.review.acceptanceSummary,
          "acceptanceSummary",
        ),
        baseline: newMetrics,
        sourceBaselinePolicyId: driftPolicy.baseline.sourcePolicyId,
        sourceDriftPolicyId: driftPolicy.policyId,
        sourceEvidenceRefs,
        rebaselineId: acceptance.rebaselineId,
      },
    },
    { now: options.now },
  );
  next = appendBaselineLineageEvent(
    next,
    {
      type: "checkpoint_binding_recorded",
      data: bindingPayload(
        next,
        checkpointRegistry,
        options.epochId,
        activationPolicy,
        driftPolicy,
        options.bindingEvidenceRef,
        options.bindingId ?? `binding-${options.epochId}-${activationPolicy.policyId}`,
      ),
    },
    { now: options.now },
  );
  return next;
};

export const bindCheckpointToDistributionEpoch = (
  registry: BaselineLineageRegistry,
  checkpointRegistry: CheckpointLineageRegistry,
  activationPolicy: CanaryActivationPolicy,
  driftPolicy: ActiveLimitedDriftPolicy,
  options: {
    epochId?: string;
    evidenceRef: string;
    bindingId?: string;
    now?: Date;
  },
): BaselineLineageRegistry => {
  verifyBaselineLineageRegistry(registry);
  const state = deriveBaselineLineageState(registry);
  const epochId = options.epochId ?? state.currentEpochId;
  if (!epochId) throw new Error("baseline registry has no current epoch");
  if (epochId !== state.currentEpochId) {
    throw new Error("new checkpoint bindings must target the current epoch");
  }
  const epoch = state.epochs[epochId];
  if (!epoch) throw new Error(`distribution epoch is not registered: ${epochId}`);
  if (!metricsMatch(epoch.baseline, metricsFromDriftPolicy(driftPolicy))) {
    throw new Error(
      "checkpoint binding drift baseline does not match current distribution epoch",
    );
  }
  const payload = bindingPayload(
    registry,
    checkpointRegistry,
    epochId,
    activationPolicy,
    driftPolicy,
    options.evidenceRef,
    options.bindingId ?? `binding-${epochId}-${activationPolicy.policyId}`,
  );
  return appendBaselineLineageEvent(
    registry,
    { type: "checkpoint_binding_recorded", data: payload },
    { now: options.now },
  );
};
