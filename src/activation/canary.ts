import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import type { SystemOneProvider } from "../core/provider.js";
import { validateDecisionResponse } from "../core/provider.js";
import type {
  DecisionRequest,
  DecisionResponse,
  SystemOnePattern,
  TypedQuestion,
  TypedResult,
} from "../core/types.js";
import type { CheckpointLineageRegistry } from "../lineage/registry.js";
import {
  deriveLineageState,
  verifyLineageRegistry,
} from "../lineage/registry.js";

export type CanaryStage =
  | "off"
  | "canary_1"
  | "canary_5"
  | "canary_25"
  | "limited_active";

export const canaryTrafficFraction = (stage: CanaryStage): number => {
  switch (stage) {
    case "off":
      return 0;
    case "canary_1":
      return 0.01;
    case "canary_5":
      return 0.05;
    case "canary_25":
      return 0.25;
    case "limited_active":
      return 1;
  }
};

export const nextCanaryStage = (stage: CanaryStage): CanaryStage | null => {
  switch (stage) {
    case "off":
      return "canary_1";
    case "canary_1":
      return "canary_5";
    case "canary_5":
      return "canary_25";
    case "canary_25":
      return "limited_active";
    case "limited_active":
      return null;
  }
};

export interface CanaryCircuitBreakerPolicy {
  maxConsecutiveCandidateErrors: number;
  minCandidateAttemptsForErrorRate: number;
  maxCandidateErrorRate: number;
}

export interface CanaryActivationPolicy {
  schemaVersion: "mso.canary-policy.v0";
  policyId: string;
  decisionSurface: string;
  candidateCheckpointId: string;
  candidateFingerprint: string;
  promotionGateId: string;
  rollbackTargetCheckpointId: string;
  lineageHeadEventHash: string;
  candidateProviderId: string;
  incumbentProviderId: string;
  stage: CanaryStage;
  trafficFraction: number;
  allowedPatterns: readonly SystemOnePattern[];
  circuitBreaker: CanaryCircuitBreakerPolicy;
  explicitEligibilityRequired: true;
  automaticStageAdvance: false;
}

export interface BuildCanaryPolicyOptions {
  policyId: string;
  candidateProviderId: string;
  incumbentProviderId: string;
  stage: CanaryStage;
  allowedPatterns: readonly SystemOnePattern[];
  circuitBreaker: CanaryCircuitBreakerPolicy;
}

export interface CanaryKillState {
  killed: boolean;
  reason?: string;
  killedAt?: string;
}

export class CanaryKillSwitch {
  #state: CanaryKillState = { killed: false };

  snapshot(): CanaryKillState {
    return { ...this.#state };
  }

  kill(reason: string): boolean {
    if (this.#state.killed) return false;
    if (!reason.trim()) throw new Error("kill reason must be non-empty");
    this.#state = {
      killed: true,
      reason,
      killedAt: new Date().toISOString(),
    };
    return true;
  }
}

export interface CanaryCircuitSnapshot {
  attempts: number;
  errors: number;
  errorRate: number;
  consecutiveErrors: number;
  tripped: boolean;
  reason?: string;
}

export class CanaryCircuitBreaker {
  readonly #policy: CanaryCircuitBreakerPolicy;
  readonly #killSwitch: CanaryKillSwitch;
  #attempts = 0;
  #errors = 0;
  #consecutiveErrors = 0;
  #tripReason: string | undefined;

  constructor(
    policy: CanaryCircuitBreakerPolicy,
    killSwitch: CanaryKillSwitch,
  ) {
    validateCircuitBreakerPolicy(policy);
    this.#policy = policy;
    this.#killSwitch = killSwitch;
  }

  observe(success: boolean): CanaryCircuitSnapshot {
    this.#attempts += 1;
    if (success) {
      this.#consecutiveErrors = 0;
    } else {
      this.#errors += 1;
      this.#consecutiveErrors += 1;
    }

    if (
      !this.#tripReason &&
      this.#consecutiveErrors >=
        this.#policy.maxConsecutiveCandidateErrors
    ) {
      this.#tripReason =
        `candidate consecutive errors reached ${this.#consecutiveErrors}`;
      this.#killSwitch.kill(`circuit_breaker: ${this.#tripReason}`);
    }

    const errorRate = this.#errors / this.#attempts;
    if (
      !this.#tripReason &&
      this.#attempts >= this.#policy.minCandidateAttemptsForErrorRate &&
      errorRate > this.#policy.maxCandidateErrorRate
    ) {
      this.#tripReason =
        `candidate error rate ${errorRate.toFixed(4)} exceeded ${this.#policy.maxCandidateErrorRate}`;
      this.#killSwitch.kill(`circuit_breaker: ${this.#tripReason}`);
    }

    return this.snapshot();
  }

  snapshot(): CanaryCircuitSnapshot {
    return {
      attempts: this.#attempts,
      errors: this.#errors,
      errorRate:
        this.#attempts === 0 ? 0 : this.#errors / this.#attempts,
      consecutiveErrors: this.#consecutiveErrors,
      tripped: this.#tripReason !== undefined,
      ...(this.#tripReason ? { reason: this.#tripReason } : {}),
    };
  }
}

export interface CanaryEvidenceSink {
  write(record: CanaryTrace): Promise<void>;
  flush?(): Promise<void>;
}

export interface CanaryProviderSnapshot {
  providerId: string;
  status: "ok" | "error" | "not_run";
  modelId?: string;
  wallLatencyMs?: number;
  responseLatencyMs?: number;
  estimatedCost?: number;
  error?: string;
}

export interface CanaryQuestionComparison {
  questionId: string;
  type: "choice" | "noul" | "score";
  comparable: boolean;
  agreement?: boolean;
}

export type CanaryFallbackReason =
  | "not_selected"
  | "outside_scope"
  | "kill_switch"
  | "candidate_error"
  | "killed_during_request";

export interface CanaryTrace {
  schemaVersion: "mso.canary.v0";
  sessionId: string;
  traceId: string;
  capturedAt: string;
  policyId: string;
  decisionSurface: string;
  stage: CanaryStage;
  trafficFraction: number;
  bucket: number;
  eligible: boolean;
  eligibilityReasons: readonly string[];
  killSwitchAtStart: CanaryKillState;
  killSwitchAtReturn: CanaryKillState;
  circuit: CanaryCircuitSnapshot;
  selectedAuthority: "incumbent" | "candidate";
  returnedAuthority: "incumbent" | "candidate";
  candidateInfluencedExecution: boolean;
  fallbackReason?: CanaryFallbackReason;
  labelsKnown: false;
  request: {
    pattern: SystemOnePattern;
    questionIds: readonly string[];
    observationId?: string;
  };
  incumbent: CanaryProviderSnapshot;
  candidate: CanaryProviderSnapshot;
  comparableQuestions: number;
  agreements: number;
  disagreements: number;
  agreementRate: number;
}

export interface CanaryActivationProviderOptions {
  incumbent: SystemOneProvider;
  candidate: SystemOneProvider;
  policy: CanaryActivationPolicy;
  killSwitch?: CanaryKillSwitch;
  sink: CanaryEvidenceSink;
  sessionId?: string;
  scoreAgreementTolerance?: number;
  onObserverError?: (error: unknown) => void;
}

interface ProviderRun {
  providerId: string;
  startedAt: number;
  finishedAt: number;
  response?: DecisionResponse;
  error?: string;
  cause?: unknown;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const validateCircuitBreakerPolicy = (
  policy: CanaryCircuitBreakerPolicy,
): void => {
  if (
    !Number.isInteger(policy.maxConsecutiveCandidateErrors) ||
    policy.maxConsecutiveCandidateErrors < 1
  ) {
    throw new Error(
      "maxConsecutiveCandidateErrors must be a positive integer",
    );
  }
  if (
    !Number.isInteger(policy.minCandidateAttemptsForErrorRate) ||
    policy.minCandidateAttemptsForErrorRate < 1
  ) {
    throw new Error(
      "minCandidateAttemptsForErrorRate must be a positive integer",
    );
  }
  if (
    !Number.isFinite(policy.maxCandidateErrorRate) ||
    policy.maxCandidateErrorRate < 0 ||
    policy.maxCandidateErrorRate > 1
  ) {
    throw new Error("maxCandidateErrorRate must be in [0,1]");
  }
};

const validatePolicy = (policy: CanaryActivationPolicy): void => {
  if (policy.schemaVersion !== "mso.canary-policy.v0") {
    throw new Error("unsupported canary policy schema");
  }
  for (const [label, value] of [
    ["policyId", policy.policyId],
    ["decisionSurface", policy.decisionSurface],
    ["candidateCheckpointId", policy.candidateCheckpointId],
    ["candidateFingerprint", policy.candidateFingerprint],
    ["promotionGateId", policy.promotionGateId],
    ["rollbackTargetCheckpointId", policy.rollbackTargetCheckpointId],
    ["lineageHeadEventHash", policy.lineageHeadEventHash],
    ["candidateProviderId", policy.candidateProviderId],
    ["incumbentProviderId", policy.incumbentProviderId],
  ] as const) {
    if (!value.trim()) throw new Error(`${label} must be non-empty`);
  }
  if (!/^[a-f0-9]{64}$/i.test(policy.candidateFingerprint)) {
    throw new Error("candidateFingerprint must be a SHA-256 hex digest");
  }
  if (policy.allowedPatterns.length === 0) {
    throw new Error("allowedPatterns must be non-empty");
  }
  if (policy.explicitEligibilityRequired !== true) {
    throw new Error("canary policy must require explicit request eligibility");
  }
  if (policy.automaticStageAdvance !== false) {
    throw new Error("canary policy must not automatically advance stages");
  }
  const expectedFraction = canaryTrafficFraction(policy.stage);
  if (policy.trafficFraction !== expectedFraction) {
    throw new Error(
      `trafficFraction must equal stage fraction ${expectedFraction}`,
    );
  }
  validateCircuitBreakerPolicy(policy.circuitBreaker);
};

export const buildCanaryActivationPolicy = (
  registry: CheckpointLineageRegistry,
  options: BuildCanaryPolicyOptions,
): CanaryActivationPolicy => {
  verifyLineageRegistry(registry);
  validateCircuitBreakerPolicy(options.circuitBreaker);
  const state = deriveLineageState(registry);
  const candidateCheckpointId = state.recordedHeadCheckpointId;
  if (!candidateCheckpointId) {
    throw new Error("lineage registry has no recorded head checkpoint");
  }
  const candidate = state.checkpoints[candidateCheckpointId];
  if (!candidate) {
    throw new Error("recorded lineage head is missing from checkpoint state");
  }
  if (candidate.lifecycle !== "promoted") {
    throw new Error(
      `recorded lineage head must be promoted before canary activation; got ${candidate.lifecycle}`,
    );
  }
  if (!candidate.latestGateId) {
    throw new Error("promoted checkpoint is missing promotion gate identity");
  }
  if (!candidate.latestRollbackTargetId) {
    throw new Error("promoted checkpoint is missing rollback target");
  }
  const rollback = state.checkpoints[candidate.latestRollbackTargetId];
  if (!rollback?.knownGood) {
    throw new Error("promotion rollback target is not currently known-good");
  }
  if (!state.headEventHash) {
    throw new Error("lineage registry has no event-chain head hash");
  }
  if (options.allowedPatterns.length === 0) {
    throw new Error("allowedPatterns must be non-empty");
  }

  const policy: CanaryActivationPolicy = {
    schemaVersion: "mso.canary-policy.v0",
    policyId: options.policyId,
    decisionSurface: registry.decisionSurface,
    candidateCheckpointId,
    candidateFingerprint: candidate.checkpoint.fingerprint,
    promotionGateId: candidate.latestGateId,
    rollbackTargetCheckpointId: candidate.latestRollbackTargetId,
    lineageHeadEventHash: state.headEventHash,
    candidateProviderId: options.candidateProviderId,
    incumbentProviderId: options.incumbentProviderId,
    stage: options.stage,
    trafficFraction: canaryTrafficFraction(options.stage),
    allowedPatterns: [...options.allowedPatterns],
    circuitBreaker: { ...options.circuitBreaker },
    explicitEligibilityRequired: true,
    automaticStageAdvance: false,
  };
  validatePolicy(policy);
  return policy;
};

export const assertCanaryPolicyAgainstRegistry = (
  registry: CheckpointLineageRegistry,
  policy: CanaryActivationPolicy,
): void => {
  verifyLineageRegistry(registry);
  validatePolicy(policy);
  const state = deriveLineageState(registry);
  if (registry.decisionSurface !== policy.decisionSurface) {
    throw new Error("canary policy decision surface does not match registry");
  }
  if (state.headEventHash !== policy.lineageHeadEventHash) {
    throw new Error(
      "canary policy is stale because lineage registry changed after policy creation",
    );
  }
  if (state.recordedHeadCheckpointId !== policy.candidateCheckpointId) {
    throw new Error("canary candidate is not the recorded lineage head");
  }
  const candidate = state.checkpoints[policy.candidateCheckpointId];
  if (!candidate || candidate.lifecycle !== "promoted") {
    throw new Error("canary candidate is not a promoted checkpoint");
  }
  if (candidate.checkpoint.fingerprint !== policy.candidateFingerprint) {
    throw new Error("canary candidate fingerprint does not match registry");
  }
  if (candidate.latestGateId !== policy.promotionGateId) {
    throw new Error("canary promotion gate does not match lineage");
  }
  if (
    candidate.latestRollbackTargetId !== policy.rollbackTargetCheckpointId
  ) {
    throw new Error("canary rollback target does not match lineage");
  }
  const rollback = state.checkpoints[policy.rollbackTargetCheckpointId];
  if (!rollback?.knownGood) {
    throw new Error("canary rollback target is not currently known-good");
  }
};

const bucketFor = (policyId: string, traceId: string): number => {
  const digest = createHash("sha256")
    .update(policyId)
    .update("\0")
    .update(traceId)
    .digest();
  return digest.readUInt32BE(0) / 2 ** 32;
};

const blockedRiskTags = new Set([
  "payment",
  "purchase",
  "delete",
  "publish",
  "permission_change",
  "secret_exposure",
  "external_share",
  "account_change",
]);

const eligibility = (
  request: DecisionRequest,
  policy: CanaryActivationPolicy,
): { eligible: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  if (!policy.allowedPatterns.includes(request.pattern)) {
    reasons.push("pattern_not_allowed");
  }
  if (request.metadata?.decisionSurface !== policy.decisionSurface) {
    reasons.push("decision_surface_mismatch");
  }
  if (request.metadata?.canaryEligible !== true) {
    reasons.push("explicit_canary_eligibility_missing");
  }
  if (request.metadata?.reversible !== true) {
    reasons.push("reversible_attestation_missing");
  }
  if (request.metadata?.impactClass !== "low") {
    reasons.push("low_impact_attestation_missing");
  }
  const riskTags = Array.isArray(request.metadata?.riskTags)
    ? request.metadata.riskTags.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  if (riskTags.some((tag) => blockedRiskTags.has(tag))) {
    reasons.push("blocked_risk_tag");
  }
  return {
    eligible: reasons.length === 0,
    reasons,
  };
};

const runProvider = async (
  provider: SystemOneProvider,
  request: DecisionRequest,
): Promise<ProviderRun> => {
  const startedAt = performance.now();
  try {
    const response = await provider.decide(request);
    validateDecisionResponse(request, response);
    return {
      providerId: provider.id,
      startedAt,
      finishedAt: performance.now(),
      response,
    };
  } catch (error) {
    return {
      providerId: provider.id,
      startedAt,
      finishedAt: performance.now(),
      error: errorMessage(error),
      cause: error,
    };
  }
};

const providerSnapshot = (
  providerId: string,
  run: ProviderRun | undefined,
): CanaryProviderSnapshot => {
  if (!run) {
    return { providerId, status: "not_run" };
  }
  if (!run.response) {
    return {
      providerId,
      status: "error",
      wallLatencyMs: run.finishedAt - run.startedAt,
      ...(run.error ? { error: run.error } : {}),
    };
  }
  return {
    providerId,
    status: "ok",
    wallLatencyMs: run.finishedAt - run.startedAt,
    ...(run.response.modelId ? { modelId: run.response.modelId } : {}),
    ...(run.response.latencyMs === undefined
      ? {}
      : { responseLatencyMs: run.response.latencyMs }),
    ...(run.response.estimatedCost === undefined
      ? {}
      : { estimatedCost: run.response.estimatedCost }),
  };
};

const answer = (
  result: TypedResult | undefined,
): string | boolean | number | null | undefined => {
  if (!result) return undefined;
  switch (result.type) {
    case "choice":
      return result.selected;
    case "noul":
      return result.probabilityYes >= 0.5;
    case "score":
      return result.expectedScore;
  }
};

const compareQuestion = (
  questionId: string,
  question: TypedQuestion,
  incumbent: ProviderRun | undefined,
  candidate: ProviderRun | undefined,
  scoreTolerance: number,
): CanaryQuestionComparison => {
  const left = answer(incumbent?.response?.results[questionId]);
  const right = answer(candidate?.response?.results[questionId]);
  if (
    !incumbent?.response ||
    !candidate?.response ||
    left === undefined ||
    right === undefined
  ) {
    return {
      questionId,
      type: question.type,
      comparable: false,
    };
  }
  const agreement =
    question.type === "score"
      ? Math.abs(Number(left) - Number(right)) <= scoreTolerance
      : left === right;
  return {
    questionId,
    type: question.type,
    comparable: true,
    agreement,
  };
};

const buildTrace = (
  request: DecisionRequest,
  options: {
    sessionId: string;
    policy: CanaryActivationPolicy;
    bucket: number;
    eligible: boolean;
    eligibilityReasons: readonly string[];
    killSwitchAtStart: CanaryKillState;
    killSwitchAtReturn: CanaryKillState;
    circuit: CanaryCircuitSnapshot;
    selectedAuthority: "incumbent" | "candidate";
    returnedAuthority: "incumbent" | "candidate";
    fallbackReason?: CanaryFallbackReason;
    incumbentRun?: ProviderRun;
    candidateRun?: ProviderRun;
    scoreAgreementTolerance: number;
  },
): CanaryTrace => {
  const questions = Object.entries(request.questions).map(
    ([questionId, question]) =>
      compareQuestion(
        questionId,
        question,
        options.incumbentRun,
        options.candidateRun,
        options.scoreAgreementTolerance,
      ),
  );
  const comparable = questions.filter((item) => item.comparable);
  const agreements = comparable.filter((item) => item.agreement === true).length;
  const disagreements = comparable.length - agreements;

  return {
    schemaVersion: "mso.canary.v0",
    sessionId: options.sessionId,
    traceId: request.traceId,
    capturedAt: new Date().toISOString(),
    policyId: options.policy.policyId,
    decisionSurface: options.policy.decisionSurface,
    stage: options.policy.stage,
    trafficFraction: options.policy.trafficFraction,
    bucket: options.bucket,
    eligible: options.eligible,
    eligibilityReasons: [...options.eligibilityReasons],
    killSwitchAtStart: options.killSwitchAtStart,
    killSwitchAtReturn: options.killSwitchAtReturn,
    circuit: options.circuit,
    selectedAuthority: options.selectedAuthority,
    returnedAuthority: options.returnedAuthority,
    candidateInfluencedExecution:
      options.returnedAuthority === "candidate",
    ...(options.fallbackReason
      ? { fallbackReason: options.fallbackReason }
      : {}),
    labelsKnown: false,
    request: {
      pattern: request.pattern,
      questionIds: Object.keys(request.questions),
      ...(request.observationId
        ? { observationId: request.observationId }
        : {}),
    },
    incumbent: providerSnapshot(
      options.policy.incumbentProviderId,
      options.incumbentRun,
    ),
    candidate: providerSnapshot(
      options.policy.candidateProviderId,
      options.candidateRun,
    ),
    comparableQuestions: comparable.length,
    agreements,
    disagreements,
    agreementRate:
      comparable.length === 0 ? 0 : agreements / comparable.length,
  };
};

export class CanaryActivationProvider implements SystemOneProvider {
  readonly id: string;
  readonly #incumbent: SystemOneProvider;
  readonly #candidate: SystemOneProvider;
  readonly #policy: CanaryActivationPolicy;
  readonly #killSwitch: CanaryKillSwitch;
  readonly #circuit: CanaryCircuitBreaker;
  readonly #sink: CanaryEvidenceSink;
  readonly #sessionId: string;
  readonly #scoreAgreementTolerance: number;
  readonly #onObserverError: ((error: unknown) => void) | undefined;
  readonly #inFlight = new Set<Promise<void>>();

  constructor(options: CanaryActivationProviderOptions) {
    validatePolicy(options.policy);
    if (options.incumbent.id !== options.policy.incumbentProviderId) {
      throw new Error("incumbent provider id does not match canary policy");
    }
    if (options.candidate.id !== options.policy.candidateProviderId) {
      throw new Error("candidate provider id does not match canary policy");
    }
    if (options.incumbent.id === options.candidate.id) {
      throw new Error("canary requires distinct provider ids");
    }
    const scoreTolerance = options.scoreAgreementTolerance ?? 0.5;
    if (!Number.isFinite(scoreTolerance) || scoreTolerance < 0) {
      throw new Error("scoreAgreementTolerance must be non-negative");
    }

    this.id = `canary:${options.policy.policyId}`;
    this.#incumbent = options.incumbent;
    this.#candidate = options.candidate;
    this.#policy = options.policy;
    this.#killSwitch = options.killSwitch ?? new CanaryKillSwitch();
    this.#circuit = new CanaryCircuitBreaker(
      options.policy.circuitBreaker,
      this.#killSwitch,
    );
    this.#sink = options.sink;
    this.#sessionId =
      options.sessionId ??
      `canary-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    this.#scoreAgreementTolerance = scoreTolerance;
    this.#onObserverError = options.onObserverError;
  }

  capabilities() {
    return this.#incumbent.capabilities();
  }

  health() {
    const kill = this.#killSwitch.snapshot();
    if (kill.killed) {
      return Promise.resolve({
        status: "degraded" as const,
        checkedAt: new Date().toISOString(),
        detail: `candidate killed; incumbent-only routing: ${kill.reason ?? "unspecified"}`,
      });
    }
    return this.#incumbent.health
      ? this.#incumbent.health()
      : Promise.resolve({
          status: "healthy" as const,
          checkedAt: new Date().toISOString(),
          detail: "incumbent does not expose health",
        });
  }

  killSwitch(): CanaryKillSwitch {
    return this.#killSwitch;
  }

  circuitSnapshot(): CanaryCircuitSnapshot {
    return this.#circuit.snapshot();
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    const bucket = bucketFor(this.#policy.policyId, request.traceId);
    const scope = eligibility(request, this.#policy);
    const killAtStart = this.#killSwitch.snapshot();
    const selected =
      scope.eligible &&
      !killAtStart.killed &&
      bucket < this.#policy.trafficFraction;

    if (!selected) {
      const incumbentPromise = runProvider(this.#incumbent, request);
      const incumbentRun = await incumbentPromise;
      const killAtReturn = this.#killSwitch.snapshot();
      const observer = this.#sink
        .write(
          buildTrace(request, {
            sessionId: this.#sessionId,
            policy: this.#policy,
            bucket,
            eligible: scope.eligible,
            eligibilityReasons: scope.reasons,
            killSwitchAtStart: killAtStart,
            killSwitchAtReturn: killAtReturn,
            circuit: this.#circuit.snapshot(),
            selectedAuthority: "incumbent",
            returnedAuthority: "incumbent",
            fallbackReason: !scope.eligible
              ? "outside_scope"
              : killAtStart.killed
                ? "kill_switch"
                : "not_selected",
            incumbentRun,
            scoreAgreementTolerance: this.#scoreAgreementTolerance,
          }),
        )
        .catch((error: unknown) => this.#onObserverError?.(error));
      this.#track(observer);

      if (!incumbentRun.response) {
        throw incumbentRun.cause instanceof Error
          ? incumbentRun.cause
          : new Error(incumbentRun.error ?? "incumbent provider failed");
      }
      return incumbentRun.response;
    }

    const incumbentPromise = runProvider(this.#incumbent, request);
    const candidatePromise = runProvider(this.#candidate, request);
    const candidateRun = await candidatePromise;
    const circuit = this.#circuit.observe(Boolean(candidateRun.response));
    const killAtReturn = this.#killSwitch.snapshot();

    let returnedAuthority: "incumbent" | "candidate";
    let fallbackReason: CanaryFallbackReason | undefined;
    let response: DecisionResponse;

    if (candidateRun.response && !killAtReturn.killed) {
      returnedAuthority = "candidate";
      response = candidateRun.response;
    } else {
      const incumbentRun = await incumbentPromise;
      returnedAuthority = "incumbent";
      fallbackReason = candidateRun.response
        ? "killed_during_request"
        : "candidate_error";
      if (!incumbentRun.response) {
        throw incumbentRun.cause instanceof Error
          ? incumbentRun.cause
          : new Error(incumbentRun.error ?? "incumbent fallback failed");
      }
      response = incumbentRun.response;
    }

    const observer = Promise.all([incumbentPromise, candidatePromise])
      .then(async ([incumbentRun, completedCandidateRun]) => {
        await this.#sink.write(
          buildTrace(request, {
            sessionId: this.#sessionId,
            policy: this.#policy,
            bucket,
            eligible: scope.eligible,
            eligibilityReasons: scope.reasons,
            killSwitchAtStart: killAtStart,
            killSwitchAtReturn: this.#killSwitch.snapshot(),
            circuit,
            selectedAuthority: "candidate",
            returnedAuthority,
            ...(fallbackReason ? { fallbackReason } : {}),
            incumbentRun,
            candidateRun: completedCandidateRun,
            scoreAgreementTolerance: this.#scoreAgreementTolerance,
          }),
        );
      })
      .catch((error: unknown) => this.#onObserverError?.(error));
    this.#track(observer);

    return response;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.#inFlight]);
    if (this.#sink.flush) await this.#sink.flush();
  }

  #track(task: Promise<void>): void {
    this.#inFlight.add(task);
    void task.finally(() => this.#inFlight.delete(task));
  }
}

export class MemoryCanaryEvidenceSink implements CanaryEvidenceSink {
  readonly records: CanaryTrace[] = [];

  async write(record: CanaryTrace): Promise<void> {
    this.records.push(record);
  }
}

export class JsonlCanaryEvidenceSink implements CanaryEvidenceSink {
  readonly path: string;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  async write(record: CanaryTrace): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
    this.#writeChain = this.#writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, line, "utf8");
    });
    return this.#writeChain;
  }

  async flush(): Promise<void> {
    await this.#writeChain;
  }
}

const percentile = (values: readonly number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0;
};

export interface CanarySessionSummary {
  schemaVersion: "mso.canary-summary.v0";
  policyId: string;
  stage: CanaryStage;
  trafficFraction: number;
  traces: number;
  eligibleRequests: number;
  candidateSelected: number;
  candidateReturned: number;
  candidateErrors: number;
  incumbentErrors: number;
  fallbacks: number;
  killedAtStart: number;
  comparableQuestions: number;
  disagreements: number;
  agreementRate: number;
  candidateErrorRate: number;
  fallbackRate: number;
  candidateReturnRate: number;
  p95CandidateWallLatencyMs: number;
  p95IncumbentWallLatencyMs: number;
  p95LatencyRatio: number;
  killTrips: number;
}

export const summarizeCanaryTraces = (
  policy: CanaryActivationPolicy,
  traces: readonly CanaryTrace[],
): CanarySessionSummary => {
  validatePolicy(policy);
  for (const trace of traces) {
    if (trace.policyId !== policy.policyId || trace.stage !== policy.stage) {
      throw new Error("canary trace does not belong to the supplied policy");
    }
  }

  const candidateSelected = traces.filter(
    (trace) => trace.selectedAuthority === "candidate",
  ).length;
  const candidateReturned = traces.filter(
    (trace) => trace.returnedAuthority === "candidate",
  ).length;
  const candidateErrors = traces.filter(
    (trace) => trace.candidate.status === "error",
  ).length;
  const incumbentErrors = traces.filter(
    (trace) => trace.incumbent.status === "error",
  ).length;
  const fallbacks = traces.filter(
    (trace) =>
      trace.selectedAuthority === "candidate" &&
      trace.returnedAuthority === "incumbent",
  ).length;
  const comparableQuestions = traces.reduce(
    (sum, trace) => sum + trace.comparableQuestions,
    0,
  );
  const disagreements = traces.reduce(
    (sum, trace) => sum + trace.disagreements,
    0,
  );
  const candidateLatencies = traces
    .map((trace) => trace.candidate.wallLatencyMs)
    .filter((value): value is number => value !== undefined);
  const incumbentLatencies = traces
    .map((trace) => trace.incumbent.wallLatencyMs)
    .filter((value): value is number => value !== undefined);
  const p95CandidateWallLatencyMs = percentile(candidateLatencies, 0.95);
  const p95IncumbentWallLatencyMs = percentile(incumbentLatencies, 0.95);

  return {
    schemaVersion: "mso.canary-summary.v0",
    policyId: policy.policyId,
    stage: policy.stage,
    trafficFraction: policy.trafficFraction,
    traces: traces.length,
    eligibleRequests: traces.filter((trace) => trace.eligible).length,
    candidateSelected,
    candidateReturned,
    candidateErrors,
    incumbentErrors,
    fallbacks,
    killedAtStart: traces.filter(
      (trace) => trace.killSwitchAtStart.killed,
    ).length,
    comparableQuestions,
    disagreements,
    agreementRate:
      comparableQuestions === 0
        ? 0
        : (comparableQuestions - disagreements) / comparableQuestions,
    candidateErrorRate:
      candidateSelected === 0 ? 0 : candidateErrors / candidateSelected,
    fallbackRate:
      candidateSelected === 0 ? 0 : fallbacks / candidateSelected,
    candidateReturnRate:
      candidateSelected === 0 ? 0 : candidateReturned / candidateSelected,
    p95CandidateWallLatencyMs,
    p95IncumbentWallLatencyMs,
    p95LatencyRatio:
      p95IncumbentWallLatencyMs === 0
        ? 0
        : p95CandidateWallLatencyMs / p95IncumbentWallLatencyMs,
    killTrips: traces.some(
      (trace) =>
        !trace.killSwitchAtStart.killed &&
        trace.killSwitchAtReturn.killed,
    )
      ? 1
      : 0,
  };
};

export interface CanaryAdvanceThresholds {
  minCandidateSelected: number;
  minComparableQuestions: number;
  maxCandidateErrorRate: number;
  maxIncumbentErrorRate: number;
  maxFallbackRate: number;
  maxDisagreementRate: number;
  maxP95LatencyRatio?: number;
}

export interface CanaryAdvanceCheck {
  id: string;
  status: "pass" | "fail" | "blocked";
  actual: number;
  required: number;
  detail: string;
}

export interface CanaryAdvanceEvidence {
  schemaVersion: "mso.canary-advance.v0";
  policyId: string;
  currentStage: CanaryStage;
  nextStage: CanaryStage | null;
  status: "pass" | "fail" | "blocked";
  action:
    | "eligible_for_next_stage"
    | "hold_current_stage"
    | "limited_active_complete";
  automaticStageAdvance: false;
  checks: readonly CanaryAdvanceCheck[];
  summary: CanarySessionSummary;
}

export const evaluateCanaryAdvance = (
  summary: CanarySessionSummary,
  thresholds: CanaryAdvanceThresholds,
): CanaryAdvanceEvidence => {
  for (const [label, value] of [
    ["minCandidateSelected", thresholds.minCandidateSelected],
    ["minComparableQuestions", thresholds.minComparableQuestions],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${label} must be a positive integer`);
    }
  }
  for (const [label, value] of [
    ["maxCandidateErrorRate", thresholds.maxCandidateErrorRate],
    ["maxIncumbentErrorRate", thresholds.maxIncumbentErrorRate],
    ["maxFallbackRate", thresholds.maxFallbackRate],
    ["maxDisagreementRate", thresholds.maxDisagreementRate],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${label} must be in [0,1]`);
    }
  }

  const disagreementRate =
    summary.comparableQuestions === 0
      ? 0
      : summary.disagreements / summary.comparableQuestions;
  const incumbentErrorRate =
    summary.traces === 0 ? 0 : summary.incumbentErrors / summary.traces;
  const checks: CanaryAdvanceCheck[] = [
    {
      id: "candidate_selected",
      status:
        summary.candidateSelected >= thresholds.minCandidateSelected
          ? "pass"
          : "blocked",
      actual: summary.candidateSelected,
      required: thresholds.minCandidateSelected,
      detail: "enough candidate-authority requests have been observed",
    },
    {
      id: "comparable_questions",
      status:
        summary.comparableQuestions >= thresholds.minComparableQuestions
          ? "pass"
          : "blocked",
      actual: summary.comparableQuestions,
      required: thresholds.minComparableQuestions,
      detail: "enough incumbent/candidate question comparisons are available",
    },
    {
      id: "candidate_error_rate",
      status:
        summary.candidateErrorRate <= thresholds.maxCandidateErrorRate
          ? "pass"
          : "fail",
      actual: summary.candidateErrorRate,
      required: thresholds.maxCandidateErrorRate,
      detail: "candidate provider errors stay below the stage ceiling",
    },
    {
      id: "incumbent_error_rate",
      status:
        incumbentErrorRate <= thresholds.maxIncumbentErrorRate
          ? "pass"
          : "fail",
      actual: incumbentErrorRate,
      required: thresholds.maxIncumbentErrorRate,
      detail: "fallback incumbent remains operationally reliable",
    },
    {
      id: "fallback_rate",
      status:
        summary.fallbackRate <= thresholds.maxFallbackRate ? "pass" : "fail",
      actual: summary.fallbackRate,
      required: thresholds.maxFallbackRate,
      detail: "candidate-to-incumbent fallback stays below the stage ceiling",
    },
    {
      id: "disagreement_rate",
      status:
        disagreementRate <= thresholds.maxDisagreementRate ? "pass" : "fail",
      actual: disagreementRate,
      required: thresholds.maxDisagreementRate,
      detail:
        "incumbent disagreement is a stability signal, not a correctness label",
    },
    {
      id: "kill_switch_trips",
      status: summary.killTrips === 0 ? "pass" : "fail",
      actual: summary.killTrips,
      required: 0,
      detail: "a stage cannot advance after any kill-switch trip",
    },
  ];

  if (thresholds.maxP95LatencyRatio !== undefined) {
    if (
      !Number.isFinite(thresholds.maxP95LatencyRatio) ||
      thresholds.maxP95LatencyRatio <= 0
    ) {
      throw new Error("maxP95LatencyRatio must be positive");
    }
    checks.push({
      id: "p95_latency_ratio",
      status:
        summary.p95LatencyRatio <= thresholds.maxP95LatencyRatio
          ? "pass"
          : "fail",
      actual: summary.p95LatencyRatio,
      required: thresholds.maxP95LatencyRatio,
      detail: "candidate p95 latency stays within the canary budget",
    });
  }

  const status = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "blocked")
      ? "blocked"
      : "pass";
  const nextStage = nextCanaryStage(summary.stage);
  return {
    schemaVersion: "mso.canary-advance.v0",
    policyId: summary.policyId,
    currentStage: summary.stage,
    nextStage,
    status,
    action:
      nextStage === null && status === "pass"
        ? "limited_active_complete"
        : status === "pass"
          ? "eligible_for_next_stage"
          : "hold_current_stage",
    automaticStageAdvance: false,
    checks,
    summary,
  };
};
