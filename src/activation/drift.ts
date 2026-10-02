import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CanaryActivationPolicy,
  CanaryKillSwitch,
  CanarySessionSummary,
  CanaryTrace,
} from "./canary.js";
import { summarizeCanaryTraces } from "./canary.js";

export interface DriftBaseline {
  sourcePolicyId: string;
  traces: number;
  candidateSelected: number;
  comparableQuestions: number;
  candidateConfidenceSamples: number;
  meanCandidateConfidence: number;
  candidateErrorRate: number;
  incumbentErrorRate: number;
  fallbackRate: number;
  disagreementRate: number;
  p95LatencyRatio: number;
}

export interface DriftWindowPolicy {
  size: number;
  minCandidateSelected: number;
  minComparableQuestions: number;
  minCandidateConfidenceSamples: number;
}

export interface DriftThresholds {
  maxCandidateErrorRate: number;
  maxIncumbentErrorRate: number;
  maxFallbackRate: number;
  maxDisagreementRate: number;
  maxP95LatencyRatio: number;
  maxMeanCandidateConfidenceDelta: number;
}

export interface ActiveLimitedDriftPolicy {
  schemaVersion: "mso.drift-policy.v0";
  policyId: string;
  activationPolicyId: string;
  decisionSurface: string;
  candidateCheckpointId: string;
  candidateFingerprint: string;
  candidateProviderId: string;
  incumbentProviderId: string;
  lineageHeadEventHash: string;
  baseline: DriftBaseline;
  window: DriftWindowPolicy;
  thresholds: DriftThresholds;
  automaticHold: true;
  automaticRollback: false;
}

export interface BuildDriftPolicyOptions {
  policyId: string;
  window: DriftWindowPolicy;
  thresholds: DriftThresholds;
}

export interface DriftCheck {
  id:
    | "candidate_selected"
    | "comparable_questions"
    | "candidate_confidence_samples"
    | "candidate_error_rate"
    | "incumbent_error_rate"
    | "fallback_rate"
    | "disagreement_rate"
    | "p95_latency_ratio"
    | "mean_candidate_confidence_delta";
  status: "pass" | "fail" | "blocked";
  actual: number;
  required: number;
  detail: string;
}

export interface DriftWindowEvidence {
  schemaVersion: "mso.drift-window.v0";
  policyId: string;
  activationPolicyId: string;
  evaluatedAt: string;
  traceCount: number;
  firstTraceId?: string;
  lastTraceId?: string;
  status: "pass" | "fail" | "blocked";
  action: "continue" | "auto_hold" | "insufficient_evidence";
  automaticHold: true;
  automaticRollback: false;
  summary: CanarySessionSummary;
  confidenceDelta: number;
  disagreementRate: number;
  incumbentErrorRate: number;
  checks: readonly DriftCheck[];
}

export interface DriftHoldEvent {
  schemaVersion: "mso.drift-hold.v0";
  holdId: string;
  policyId: string;
  activationPolicyId: string;
  decisionSurface: string;
  candidateCheckpointId: string;
  candidateFingerprint: string;
  triggeredAt: string;
  triggerTraceId: string;
  action: "auto_hold";
  automaticHold: true;
  automaticRollback: false;
  candidateAuthorityAfterHold: false;
  fallbackAuthority: "incumbent";
  reasons: readonly string[];
  window: DriftWindowEvidence;
}

export interface DriftGuardSnapshot {
  schemaVersion: "mso.drift-guard-state.v0";
  policyId: string;
  observedEligibleTraces: number;
  bufferedEligibleTraces: number;
  held: boolean;
  latestWindow?: DriftWindowEvidence;
  holdEvent?: DriftHoldEvent;
}

export interface DriftHoldEvidenceSink {
  write(event: DriftHoldEvent): Promise<void>;
  flush?(): Promise<void>;
}

const rate = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be in [0,1]`);
  }
  return value;
};

const positiveInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
};

const positive = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive`);
  }
  return value;
};

const validateWindowPolicy = (window: DriftWindowPolicy): void => {
  positiveInteger(window.size, "window.size");
  positiveInteger(
    window.minCandidateSelected,
    "window.minCandidateSelected",
  );
  positiveInteger(
    window.minComparableQuestions,
    "window.minComparableQuestions",
  );
  positiveInteger(
    window.minCandidateConfidenceSamples,
    "window.minCandidateConfidenceSamples",
  );
  if (window.minCandidateSelected > window.size) {
    throw new Error("window.minCandidateSelected cannot exceed window.size");
  }
};

const validateThresholds = (thresholds: DriftThresholds): void => {
  rate(thresholds.maxCandidateErrorRate, "maxCandidateErrorRate");
  rate(thresholds.maxIncumbentErrorRate, "maxIncumbentErrorRate");
  rate(thresholds.maxFallbackRate, "maxFallbackRate");
  rate(thresholds.maxDisagreementRate, "maxDisagreementRate");
  positive(thresholds.maxP95LatencyRatio, "maxP95LatencyRatio");
  rate(
    thresholds.maxMeanCandidateConfidenceDelta,
    "maxMeanCandidateConfidenceDelta",
  );
};

export const validateDriftPolicy = (
  policy: ActiveLimitedDriftPolicy,
): void => {
  if (policy.schemaVersion !== "mso.drift-policy.v0") {
    throw new Error("unsupported drift policy schema");
  }
  for (const [label, value] of [
    ["policyId", policy.policyId],
    ["activationPolicyId", policy.activationPolicyId],
    ["decisionSurface", policy.decisionSurface],
    ["candidateCheckpointId", policy.candidateCheckpointId],
    ["candidateFingerprint", policy.candidateFingerprint],
    ["candidateProviderId", policy.candidateProviderId],
    ["incumbentProviderId", policy.incumbentProviderId],
    ["lineageHeadEventHash", policy.lineageHeadEventHash],
    ["baseline.sourcePolicyId", policy.baseline.sourcePolicyId],
  ] as const) {
    if (!value.trim()) throw new Error(`${label} must be non-empty`);
  }
  if (!/^[a-f0-9]{64}$/i.test(policy.candidateFingerprint)) {
    throw new Error("candidateFingerprint must be a SHA-256 hex digest");
  }
  if (policy.automaticHold !== true) {
    throw new Error("drift policy must use automaticHold=true");
  }
  if (policy.automaticRollback !== false) {
    throw new Error("drift policy must use automaticRollback=false");
  }
  validateWindowPolicy(policy.window);
  validateThresholds(policy.thresholds);
  if (
    !Number.isFinite(policy.baseline.meanCandidateConfidence) ||
    policy.baseline.meanCandidateConfidence < 0 ||
    policy.baseline.meanCandidateConfidence > 1
  ) {
    throw new Error("baseline meanCandidateConfidence must be in [0,1]");
  }
};

const incumbentErrorRate = (summary: CanarySessionSummary): number =>
  summary.traces === 0 ? 0 : summary.incumbentErrors / summary.traces;

const disagreementRate = (summary: CanarySessionSummary): number =>
  summary.comparableQuestions === 0
    ? 0
    : summary.disagreements / summary.comparableQuestions;

const baselineFromSummary = (
  sourcePolicyId: string,
  summary: CanarySessionSummary,
): DriftBaseline => ({
  sourcePolicyId,
  traces: summary.traces,
  candidateSelected: summary.candidateSelected,
  comparableQuestions: summary.comparableQuestions,
  candidateConfidenceSamples: summary.candidateConfidenceSamples,
  meanCandidateConfidence: summary.meanCandidateConfidence,
  candidateErrorRate: summary.candidateErrorRate,
  incumbentErrorRate: incumbentErrorRate(summary),
  fallbackRate: summary.fallbackRate,
  disagreementRate: disagreementRate(summary),
  p95LatencyRatio: summary.p95LatencyRatio,
});

export const buildActiveLimitedDriftPolicy = (
  activationPolicy: CanaryActivationPolicy,
  baselinePolicy: CanaryActivationPolicy,
  baselineSummary: CanarySessionSummary,
  options: BuildDriftPolicyOptions,
): ActiveLimitedDriftPolicy => {
  if (activationPolicy.stage !== "limited_active") {
    throw new Error(
      "drift guard activation policy must use limited_active stage",
    );
  }
  if (baselineSummary.policyId !== baselinePolicy.policyId) {
    throw new Error("baseline summary does not match baseline policy");
  }
  if (
    baselinePolicy.candidateCheckpointId !==
      activationPolicy.candidateCheckpointId ||
    baselinePolicy.candidateFingerprint !==
      activationPolicy.candidateFingerprint ||
    baselinePolicy.candidateProviderId !== activationPolicy.candidateProviderId ||
    baselinePolicy.incumbentProviderId !== activationPolicy.incumbentProviderId ||
    baselinePolicy.decisionSurface !== activationPolicy.decisionSurface
  ) {
    throw new Error(
      "baseline and active-limited policies must describe the same candidate, incumbent, and decision surface",
    );
  }
  if (baselineSummary.candidateSelected === 0) {
    throw new Error("baseline requires observed candidate-authority traffic");
  }
  if (baselineSummary.candidateConfidenceSamples === 0) {
    throw new Error("baseline requires candidate confidence telemetry");
  }
  validateWindowPolicy(options.window);
  validateThresholds(options.thresholds);

  const policy: ActiveLimitedDriftPolicy = {
    schemaVersion: "mso.drift-policy.v0",
    policyId: options.policyId,
    activationPolicyId: activationPolicy.policyId,
    decisionSurface: activationPolicy.decisionSurface,
    candidateCheckpointId: activationPolicy.candidateCheckpointId,
    candidateFingerprint: activationPolicy.candidateFingerprint,
    candidateProviderId: activationPolicy.candidateProviderId,
    incumbentProviderId: activationPolicy.incumbentProviderId,
    lineageHeadEventHash: activationPolicy.lineageHeadEventHash,
    baseline: baselineFromSummary(baselinePolicy.policyId, baselineSummary),
    window: { ...options.window },
    thresholds: { ...options.thresholds },
    automaticHold: true,
    automaticRollback: false,
  };
  validateDriftPolicy(policy);
  return policy;
};

export const assertDriftPolicyAgainstActivation = (
  driftPolicy: ActiveLimitedDriftPolicy,
  activationPolicy: CanaryActivationPolicy,
): void => {
  validateDriftPolicy(driftPolicy);
  if (activationPolicy.stage !== "limited_active") {
    throw new Error("drift guard requires a limited_active activation policy");
  }
  if (driftPolicy.activationPolicyId !== activationPolicy.policyId) {
    throw new Error("drift policy activationPolicyId does not match");
  }
  if (
    driftPolicy.decisionSurface !== activationPolicy.decisionSurface ||
    driftPolicy.candidateCheckpointId !== activationPolicy.candidateCheckpointId ||
    driftPolicy.candidateFingerprint !== activationPolicy.candidateFingerprint ||
    driftPolicy.candidateProviderId !== activationPolicy.candidateProviderId ||
    driftPolicy.incumbentProviderId !== activationPolicy.incumbentProviderId ||
    driftPolicy.lineageHeadEventHash !== activationPolicy.lineageHeadEventHash
  ) {
    throw new Error("drift policy identity does not match activation policy");
  }
};

const check = (
  id: DriftCheck["id"],
  actual: number,
  required: number,
  predicate: boolean,
  detail: string,
  blocked = false,
): DriftCheck => ({
  id,
  status: blocked ? "blocked" : predicate ? "pass" : "fail",
  actual,
  required,
  detail,
});

export const evaluateDriftWindow = (
  driftPolicy: ActiveLimitedDriftPolicy,
  activationPolicy: CanaryActivationPolicy,
  traces: readonly CanaryTrace[],
  now: Date = new Date(),
): DriftWindowEvidence => {
  assertDriftPolicyAgainstActivation(driftPolicy, activationPolicy);

  const eligible = traces
    .filter(
      (trace) =>
        trace.policyId === activationPolicy.policyId &&
        trace.decisionSurface === activationPolicy.decisionSurface &&
        trace.eligible,
    )
    .slice(-driftPolicy.window.size);

  const summary = summarizeCanaryTraces(activationPolicy, eligible);
  const currentDisagreementRate = disagreementRate(summary);
  const currentIncumbentErrorRate = incumbentErrorRate(summary);
  const confidenceDelta = Math.abs(
    summary.meanCandidateConfidence -
      driftPolicy.baseline.meanCandidateConfidence,
  );

  const checks: DriftCheck[] = [
    check(
      "candidate_selected",
      summary.candidateSelected,
      driftPolicy.window.minCandidateSelected,
      summary.candidateSelected >= driftPolicy.window.minCandidateSelected,
      "rolling window has enough candidate-authority requests",
      summary.candidateSelected < driftPolicy.window.minCandidateSelected,
    ),
    check(
      "comparable_questions",
      summary.comparableQuestions,
      driftPolicy.window.minComparableQuestions,
      summary.comparableQuestions >= driftPolicy.window.minComparableQuestions,
      "rolling window has enough incumbent/candidate comparisons",
      summary.comparableQuestions < driftPolicy.window.minComparableQuestions,
    ),
    check(
      "candidate_confidence_samples",
      summary.candidateConfidenceSamples,
      driftPolicy.window.minCandidateConfidenceSamples,
      summary.candidateConfidenceSamples >=
        driftPolicy.window.minCandidateConfidenceSamples,
      "rolling window has enough candidate confidence samples",
      summary.candidateConfidenceSamples <
        driftPolicy.window.minCandidateConfidenceSamples,
    ),
    check(
      "candidate_error_rate",
      summary.candidateErrorRate,
      driftPolicy.thresholds.maxCandidateErrorRate,
      summary.candidateErrorRate <=
        driftPolicy.thresholds.maxCandidateErrorRate,
      "candidate provider errors stay below active-limited ceiling",
    ),
    check(
      "incumbent_error_rate",
      currentIncumbentErrorRate,
      driftPolicy.thresholds.maxIncumbentErrorRate,
      currentIncumbentErrorRate <=
        driftPolicy.thresholds.maxIncumbentErrorRate,
      "fallback incumbent remains operationally healthy",
    ),
    check(
      "fallback_rate",
      summary.fallbackRate,
      driftPolicy.thresholds.maxFallbackRate,
      summary.fallbackRate <= driftPolicy.thresholds.maxFallbackRate,
      "candidate-to-incumbent fallbacks stay below active-limited ceiling",
    ),
    check(
      "disagreement_rate",
      currentDisagreementRate,
      driftPolicy.thresholds.maxDisagreementRate,
      currentDisagreementRate <= driftPolicy.thresholds.maxDisagreementRate,
      "incumbent disagreement remains a stability signal within the allowed band",
    ),
    check(
      "p95_latency_ratio",
      summary.p95LatencyRatio,
      driftPolicy.thresholds.maxP95LatencyRatio,
      summary.p95LatencyRatio <= driftPolicy.thresholds.maxP95LatencyRatio,
      "candidate p95 latency remains bounded relative to incumbent",
    ),
    check(
      "mean_candidate_confidence_delta",
      confidenceDelta,
      driftPolicy.thresholds.maxMeanCandidateConfidenceDelta,
      confidenceDelta <=
        driftPolicy.thresholds.maxMeanCandidateConfidenceDelta,
      "candidate mean confidence stays near the accepted canary baseline",
    ),
  ];

  const status = checks.some((item) => item.status === "blocked")
    ? "blocked"
    : checks.some((item) => item.status === "fail")
      ? "fail"
      : "pass";

  const firstTrace = eligible[0];
  const lastTrace = eligible[eligible.length - 1];

  return {
    schemaVersion: "mso.drift-window.v0",
    policyId: driftPolicy.policyId,
    activationPolicyId: activationPolicy.policyId,
    evaluatedAt: now.toISOString(),
    traceCount: eligible.length,
    ...(firstTrace ? { firstTraceId: firstTrace.traceId } : {}),
    ...(lastTrace ? { lastTraceId: lastTrace.traceId } : {}),
    status,
    action:
      status === "fail"
        ? "auto_hold"
        : status === "blocked"
          ? "insufficient_evidence"
          : "continue",
    automaticHold: true,
    automaticRollback: false,
    summary,
    confidenceDelta,
    disagreementRate: currentDisagreementRate,
    incumbentErrorRate: currentIncumbentErrorRate,
    checks,
  };
};

export interface ActiveLimitedDriftGuardOptions {
  policy: ActiveLimitedDriftPolicy;
  activationPolicy: CanaryActivationPolicy;
  killSwitch: CanaryKillSwitch;
  holdSink?: DriftHoldEvidenceSink;
  now?: () => Date;
}

export class ActiveLimitedDriftGuard {
  readonly #policy: ActiveLimitedDriftPolicy;
  readonly #activationPolicy: CanaryActivationPolicy;
  readonly #killSwitch: CanaryKillSwitch;
  readonly #holdSink: DriftHoldEvidenceSink | undefined;
  readonly #now: () => Date;
  readonly #buffer: CanaryTrace[] = [];
  readonly #inFlight = new Set<Promise<void>>();
  #observedEligibleTraces = 0;
  #latestWindow: DriftWindowEvidence | undefined;
  #holdEvent: DriftHoldEvent | undefined;

  constructor(options: ActiveLimitedDriftGuardOptions) {
    assertDriftPolicyAgainstActivation(
      options.policy,
      options.activationPolicy,
    );
    this.#policy = options.policy;
    this.#activationPolicy = options.activationPolicy;
    this.#killSwitch = options.killSwitch;
    this.#holdSink = options.holdSink;
    this.#now = options.now ?? (() => new Date());
  }

  observe(trace: CanaryTrace): DriftWindowEvidence | undefined {
    if (trace.policyId !== this.#activationPolicy.policyId) {
      throw new Error(
        `drift guard received trace for different policy: ${trace.policyId}`,
      );
    }
    if (trace.decisionSurface !== this.#policy.decisionSurface) {
      throw new Error("drift guard trace decision surface mismatch");
    }
    if (!trace.eligible) return this.#latestWindow;
    if (this.#holdEvent) return this.#latestWindow;

    this.#observedEligibleTraces += 1;
    this.#buffer.push(trace);
    while (this.#buffer.length > this.#policy.window.size) {
      this.#buffer.shift();
    }

    const window = evaluateDriftWindow(
      this.#policy,
      this.#activationPolicy,
      this.#buffer,
      this.#now(),
    );
    this.#latestWindow = window;

    if (window.status === "fail") {
      const reasons = window.checks
        .filter((item) => item.status === "fail")
        .map(
          (item) =>
            `${item.id}: actual=${item.actual} required=${item.required}`,
        );
      const triggerTraceId = trace.traceId;
      const triggeredAt = this.#now().toISOString();
      const held = this.#killSwitch.hold(
        `drift_guard ${this.#policy.policyId}: ${reasons.join("; ")}`,
      );
      if (held) {
        const event: DriftHoldEvent = {
          schemaVersion: "mso.drift-hold.v0",
          holdId: `hold-${this.#policy.policyId}-${triggeredAt.replace(/[:.]/g, "-")}`,
          policyId: this.#policy.policyId,
          activationPolicyId: this.#activationPolicy.policyId,
          decisionSurface: this.#policy.decisionSurface,
          candidateCheckpointId: this.#policy.candidateCheckpointId,
          candidateFingerprint: this.#policy.candidateFingerprint,
          triggeredAt,
          triggerTraceId,
          action: "auto_hold",
          automaticHold: true,
          automaticRollback: false,
          candidateAuthorityAfterHold: false,
          fallbackAuthority: "incumbent",
          reasons,
          window,
        };
        this.#holdEvent = event;
        if (this.#holdSink) {
          const task = this.#holdSink
            .write(event)
            .catch(() => undefined);
          this.#inFlight.add(task);
          void task.finally(() => this.#inFlight.delete(task));
        }
      }
    }

    return window;
  }

  snapshot(): DriftGuardSnapshot {
    return {
      schemaVersion: "mso.drift-guard-state.v0",
      policyId: this.#policy.policyId,
      observedEligibleTraces: this.#observedEligibleTraces,
      bufferedEligibleTraces: this.#buffer.length,
      held: this.#holdEvent !== undefined,
      ...(this.#latestWindow ? { latestWindow: this.#latestWindow } : {}),
      ...(this.#holdEvent ? { holdEvent: this.#holdEvent } : {}),
    };
  }

  async flush(): Promise<void> {
    await Promise.all([...this.#inFlight]);
    if (this.#holdSink?.flush) await this.#holdSink.flush();
  }
}

export class MemoryDriftHoldEvidenceSink implements DriftHoldEvidenceSink {
  readonly events: DriftHoldEvent[] = [];

  async write(event: DriftHoldEvent): Promise<void> {
    this.events.push(event);
  }
}

export class JsonlDriftHoldEvidenceSink implements DriftHoldEvidenceSink {
  readonly path: string;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  async write(event: DriftHoldEvent): Promise<void> {
    const line = `${JSON.stringify(event)}\n`;
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

