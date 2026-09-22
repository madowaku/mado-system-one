export type ProbabilitySemantics =
  | "direct_logits"
  | "sampled_agreement"
  | "generated_probability"
  | "heuristic"
  | "provider_defined"
  | "unknown";

export type ConfidenceSemantics =
  | "selected_probability"
  | "normalized_entropy"
  | "margin"
  | "provider_defined"
  | "unknown";

export type CalibrationStatus =
  | "uncalibrated"
  | "partially_calibrated"
  | "calibrated"
  | "unknown";

export type InferenceFamily =
  | "hosted_proprietary"
  | "generative_logits"
  | "encoder_scoring"
  | "diffusion_structured_read"
  | "specialist_classifier"
  | "hybrid"
  | "unknown";

export type SpecializationLevel = "general" | "domain" | "task";

export type DecisionModality = "text" | "vision" | "text+vision";

export type SystemOnePattern =
  | "route"
  | "compute"
  | "rank"
  | "gate"
  | "act"
  | "score"
  | "abstain"
  | "sieve"
  | "walk"
  | "verify";

export type PatternSupportStatus =
  | "validated"
  | "supported"
  | "experimental"
  | "unsupported"
  | "unknown";

export type SystemOneMode =
  | "off"
  | "shadow"
  | "calibrating"
  | "active_limited"
  | "active"
  | "active_with_escalation"
  | "specializing"
  | "localized"
  | "killed";

export type FailBehavior = "bypass" | "fail_closed" | "escalate";

export interface ProviderCalibration {
  status: CalibrationStatus;
  method?: string;
  profileId?: string;
  datasetId?: string;
  calibratedAt?: string;
  notes?: string;
}

export interface ProviderPatternSupport {
  status: PatternSupportStatus;
  evidenceRef?: string;
  notes?: string;
}

export interface Candidate<TMetadata extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  kind: string;
  label: string;
  description?: string;
  sourceObservationId?: string;
  executionRef?: string;
  riskTags?: readonly string[];
  metadata?: TMetadata;
}

export interface Observation<TState = unknown> {
  observationId: string;
  source: string;
  capturedAt: string;
  stateSummary: string;
  structuredState: TState;
  freshnessToken?: string;
  evidenceRefs: readonly string[];
  capabilities: readonly string[];
}

export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
}

export interface ChoiceQuestion {
  type: "choice";
  prompt: string;
  options: readonly ChoiceOption[];
  allowAbstain?: boolean;
  maxSelections?: number;
}

export interface NoulQuestion {
  type: "noul";
  prompt: string;
}

export interface ScoreQuestion {
  type: "score";
  prompt: string;
  min: number;
  max: number;
  labels?: Readonly<Record<number, string>>;
}

export type TypedQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export interface DecisionBudget {
  maxLatencyMs?: number;
  maxCost?: number;
  maxReads?: number;
  maxEscalations?: number;
}

export interface DecisionRequest {
  traceId: string;
  pattern: SystemOnePattern;
  state: string;
  questions: Readonly<Record<string, TypedQuestion>>;
  observationId?: string;
  freshnessToken?: string;
  modality?: DecisionModality;
  budget?: DecisionBudget;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ChoiceResult {
  type: "choice";
  selected: string | null;
  distribution: Readonly<Record<string, number>>;
  confidence?: number;
  abstained?: boolean;
}

export interface NoulResult {
  type: "noul";
  probabilityYes: number;
}

export interface ScoreResult {
  type: "score";
  expectedScore: number;
  distribution?: readonly number[];
}

export type TypedResult = ChoiceResult | NoulResult | ScoreResult;

export interface DecisionResponse {
  traceId: string;
  providerId: string;
  modelId?: string;
  probabilitySemantics: ProbabilitySemantics;
  confidenceSemantics?: ConfidenceSemantics;
  calibrationStatus?: CalibrationStatus;
  results: Readonly<Record<string, TypedResult>>;
  latencyMs?: number;
  estimatedCost?: number;
  entropy?: Readonly<Record<string, number>>;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderCapabilities {
  primitives: readonly ("choice" | "noul" | "score")[];
  modalities: readonly DecisionModality[];
  inferenceFamily: InferenceFamily;
  specialization: SpecializationLevel;
  probabilitySemantics: ProbabilitySemantics;
  confidenceSemantics: ConfidenceSemantics;
  calibration: ProviderCalibration;
  patternSupport?: Partial<Record<SystemOnePattern, ProviderPatternSupport>>;
  supportsBatch?: boolean;
  supportsAdaptiveReads?: boolean;
}

export interface ProviderHealth {
  status: "healthy" | "degraded" | "unavailable";
  checkedAt: string;
  detail?: string;
}

export interface CalibrationProfile {
  id: string;
  providerId: string;
  modelId?: string;
  taskFamily: string;
  probabilitySemantics: ProbabilitySemantics;
  confidenceSemantics?: ConfidenceSemantics;
  datasetId: string;
  createdAt: string;
  acceptThreshold?: number;
  abstainThreshold?: number;
  confirmThreshold?: number;
  metrics?: Readonly<Record<string, number>>;
}

export interface VerificationCheck {
  id: string;
  passed: boolean;
  detail?: string;
  evidenceRefs?: readonly string[];
}

export interface VerificationResult {
  status: "pass" | "fail" | "uncertain";
  evidenceRefs: readonly string[];
  checks: readonly VerificationCheck[];
  recommendedNext: "done" | "retry" | "reobserve" | "replan" | "escalate";
}

export interface DecisionTrace {
  traceId: string;
  pattern: SystemOnePattern;
  mode: SystemOneMode;
  providerId: string;
  modelId?: string;
  inferenceFamily?: InferenceFamily;
  probabilitySemantics: ProbabilitySemantics;
  confidenceSemantics?: ConfidenceSemantics;
  calibrationStatus?: CalibrationStatus;
  observationId?: string;
  candidateSetHash?: string;
  decision: Readonly<Record<string, TypedResult>>;
  policyOutcome?: "allow" | "confirm" | "deny" | "escalate";
  executed?: boolean;
  verification?: VerificationResult["status"];
  latencyMs?: number;
  estimatedCost?: number;
  createdAt: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface SystemOneOperationalConfig {
  enabled: boolean;
  mode: SystemOneMode;
  failBehavior: FailBehavior;
  providerId: string;
  thresholds?: {
    accept?: number;
    abstain?: number;
    confirm?: number;
  };
  killSwitchEnabled: boolean;
}
