export type AgentsTerminalStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export interface AgentsUsageSummary {
  status: "known" | "partial" | "unknown";
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AgentsApiSessionRequest {
  agent: {
    model: string;
    instructions: string;
    reasoning: {
      effort: "none";
      summary: "concise";
    };
    text: {
      verbosity: "low";
      format: {
        type: "text";
      };
    };
    service_tier: "default";
    multi_agent: {
      enabled: true;
      max_concurrent_subagents: number;
    };
  };
  environment: {
    type: "none";
  };
  input: string;
  stream: true;
  metadata?: Readonly<Record<string, string>>;
}

export interface AgentsApiRawEvent extends Record<string, unknown> {
  type?: string;
  event_id?: string;
}

export interface AgentsApiTransport {
  streamSession(
    request: AgentsApiSessionRequest,
  ): AsyncIterable<AgentsApiRawEvent>;

  retrieveSession(sessionId: string): Promise<Readonly<Record<string, unknown>>>;

  listSessionItems(
    sessionId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;

  listSessionSubagents(
    sessionId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;

  listSubagentItems(
    sessionId: string,
    subagentId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
}

export interface RepoAuditSessionInput {
  model: string;
  snapshot: string;
  snapshotId: string;
  maxConcurrentSubagents?: number;
}

export interface AgentsRecoveryEvidence {
  sessionRetrieved: boolean;
  rootItemsRetrieved: boolean;
  subagentsRetrieved: boolean;
  subagentItemsRetrieved: boolean;
  errors: readonly string[];
}

export interface AgentsHarnessRun {
  runtime: "openai_agents_api";
  snapshotId: string;
  sessionId?: string;
  terminalStatus: AgentsTerminalStatus;
  eventCount: number;
  eventTypes: readonly string[];
  outputText: readonly string[];
  subagentIds: readonly string[];
  usage: AgentsUsageSummary;
  evidenceRefs: readonly string[];
  recovery: AgentsRecoveryEvidence;
  rawEvents: readonly AgentsApiRawEvent[];
  rootItems: readonly Readonly<Record<string, unknown>>[];
  subagentItems: Readonly<
    Record<string, readonly Readonly<Record<string, unknown>>[]>
  >;
}

export interface ManagedHarnessEvidence {
  runtime: "openai_agents_api";
  snapshotId: string;
  runtimeStatus: AgentsTerminalStatus;
  verificationStatus: "not_run";
  evidenceRefs: readonly string[];
  detail: string;
}

export interface HarnessBakeoffRecord {
  runtime: string;
  runtimeCompleted: boolean;
  madoVerified: boolean | null;
  usageStatus: AgentsUsageSummary["status"];
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  evidenceRefCount: number;
  recoveryAvailable: boolean;
  notes: readonly string[];
}

export interface HarnessBakeoffComparison {
  left: HarnessBakeoffRecord;
  right: HarnessBakeoffRecord;
  comparable: {
    completion: boolean;
    verification: boolean;
    tokenUsage: boolean;
    dollarCost: boolean;
    evidenceCount: boolean;
    recovery: boolean;
  };
}
