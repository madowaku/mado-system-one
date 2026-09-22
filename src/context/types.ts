export type ContextChunkKind =
  | "conversation"
  | "tool_output"
  | "document"
  | "instruction"
  | "skill"
  | "code"
  | "observation"
  | "other";

export type ContextSensitivity =
  | "public"
  | "internal"
  | "private"
  | "secret"
  | "unknown";

export type ContextDisposition = "retain" | "hide" | "escalate";

export interface ContextChunk {
  id: string;
  kind: ContextChunkKind;
  content: string;
  summary?: string;
  sourceRef?: string;
  restorationRef?: string;
  mandatory?: boolean;
  sensitivity?: ContextSensitivity;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ContextSieveInput {
  traceId: string;
  task: string;
  chunks: readonly ContextChunk[];
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ContextSieveConfig {
  hideThreshold: number;
  retainThreshold: number;
}

export interface ContextSieveDecision {
  chunkId: string;
  disposition: ContextDisposition;
  probabilityRelevant?: number;
  reasonCodes: readonly string[];
}

export interface ContextSieveResult {
  traceId: string;
  providerId?: string;
  decisions: readonly ContextSieveDecision[];
  retainedIds: readonly string[];
  hiddenIds: readonly string[];
  escalatedIds: readonly string[];
  reversible: true;
}
