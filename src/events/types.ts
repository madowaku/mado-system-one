export type EventRisk =
  | "read_only"
  | "reversible_write"
  | "external_side_effect"
  | "destructive";

export type EventPolicyOutcome = "allow" | "confirm" | "deny" | "escalate";
export type EventEvidencePolicyOutcome = "not_evaluated" | EventPolicyOutcome;

export interface EventPolicy {
  risk: EventRisk;
  requiresHuman: boolean;
}

export interface NormalizedEvent<TPayload = unknown> {
  eventId: string;
  source: string;
  type: string;
  subject: string;
  occurredAt: string;
  payload: TPayload;
  dedupeKey: string;
  policy: EventPolicy;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface EventSubscriptionSpec {
  source: string;
  type: string;
  filters?: Readonly<Record<string, unknown>>;
}

export interface EventProvider<TRaw = unknown> {
  readonly id: string;
  subscribe(spec: EventSubscriptionSpec): Promise<string>;
  unsubscribe(subscriptionId: string): Promise<void>;
  normalize(rawEvent: TRaw): Promise<NormalizedEvent>;
}

export interface EventTask {
  taskId: string;
  eventId: string;
  description: string;
  readOnly: boolean;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface EventExecutionResult {
  taskId: string;
  status: "completed" | "failed";
  summary: string;
  evidenceRefs: readonly string[];
  metadata?: Readonly<Record<string, unknown>>;
}

export interface EventVerificationResult {
  status: "pass" | "fail" | "uncertain";
  evidenceRefs: readonly string[];
  detail: string;
}

export interface EventEvidenceRecord {
  eventId: string;
  dedupeKey: string;
  taskId?: string;
  policyOutcome: EventEvidencePolicyOutcome;
  executionStatus: "not_run" | "completed" | "failed";
  verificationStatus: "not_run" | EventVerificationResult["status"];
  evidenceRefs: readonly string[];
  createdAt: string;
  detail: string;
}

export interface EventPolicyEvaluator {
  evaluate(event: NormalizedEvent): Promise<EventPolicyOutcome>;
}

export interface EventTaskPlanner {
  plan(event: NormalizedEvent): Promise<EventTask>;
}

export interface EventTaskExecutor {
  execute(task: EventTask, event: NormalizedEvent): Promise<EventExecutionResult>;
}

export interface EventVerifier {
  verify(
    task: EventTask,
    execution: EventExecutionResult,
    event: NormalizedEvent,
  ): Promise<EventVerificationResult>;
}

export interface EventProcessResult {
  status:
    | "completed"
    | "duplicate"
    | "confirmation_required"
    | "denied"
    | "escalated"
    | "execution_failed"
    | "verification_failed"
    | "verification_uncertain";
  event: NormalizedEvent;
  evidence: EventEvidenceRecord;
}
