export type RunStatus =
  | "queued"
  | "planning"
  | "running"
  | "requires_action"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type PolicyDecision = "auto" | "ask" | "deny";

export interface DeliverableRequirement {
  id: string;
  description: string;
}

export interface EvidenceRequirement {
  id: string;
  description: string;
}

export interface CompletionCriterion {
  id: string;
  description: string;
}

export interface OutcomeContract {
  goal: string;
  deliverables: readonly DeliverableRequirement[];
  requiredEvidence: readonly EvidenceRequirement[];
  constraints: readonly string[];
  completionCriteria: readonly CompletionCriterion[];
}

export interface RuntimeCapabilityRef {
  id: string;
  reason: string;
}

export interface PlannedAction {
  id: string;
  capability: string;
  operation: string;
  input: Readonly<Record<string, unknown>>;
  reason: string;
  sideEffect: boolean;
}

export interface ActionRecord extends PlannedAction {
  status: "planned" | "approved" | "executed" | "failed" | "rejected";
  output?: unknown;
  executedAt?: string;
}

export interface ApprovalRecord {
  id: string;
  actionId: string;
  decision: "approved" | "rejected";
  explanation?: string;
  decidedAt: string;
}

export type EvidenceType =
  | "command_output"
  | "file_snapshot"
  | "diff"
  | "tool_result"
  | "test_result"
  | "url"
  | "artifact"
  | "human_confirmation";

export interface RuntimeEvidenceItem {
  id: string;
  type: EvidenceType;
  source: string;
  description: string;
  requirementIds: readonly string[];
  data?: unknown;
  createdAt: string;
}

export interface LearningCandidate {
  type: "memory" | "skill_patch" | "capability_note" | "none";
  content: string;
  confidence: number;
  sourceRunId: string;
}

export interface RuntimeVerificationResult {
  success: boolean;
  satisfied: readonly string[];
  missing: readonly string[];
  notes: readonly string[];
}

export interface RuntimeRun {
  id: string;
  intent: string;
  outcome: OutcomeContract;
  status: RunStatus;
  capabilities: readonly RuntimeCapabilityRef[];
  actions: readonly ActionRecord[];
  approvals: readonly ApprovalRecord[];
  evidence: readonly RuntimeEvidenceItem[];
  learnings: readonly LearningCandidate[];
  verification?: RuntimeVerificationResult;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyRule {
  capability: string;
  operation: string;
  decision: PolicyDecision;
  reason: string;
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  evidence?: readonly Omit<RuntimeEvidenceItem, "id" | "createdAt">[];
}

export interface ToolAdapter {
  readonly capabilityId: string;
  execute(
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolExecutionResult>;
}
