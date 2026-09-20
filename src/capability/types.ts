export type CapabilityKind =
  | "skill"
  | "native_tool"
  | "plugin"
  | "mcp"
  | "cli"
  | "harness"
  | "adapter"
  | "browser"
  | "computer_use";

export type CapabilityAvailability = "available" | "unavailable" | "unknown";

export interface CapabilityDescriptor {
  id: string;
  kind: CapabilityKind;
  name: string;
  shortDescription: string;
  fullDescription?: string;
  instructionsRef?: string;
  availability: CapabilityAvailability;
  prerequisites?: readonly string[];
  riskTags?: readonly string[];
  costClass?: "free" | "low" | "medium" | "high";
  metadata?: Readonly<Record<string, unknown>>;
}

export interface CapabilityResolutionInput {
  traceId: string;
  request: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface CapabilitySuggestion {
  suggestedCapability: string | null;
  confidence: number;
  alternatives: readonly string[];
  reasonCodes: readonly string[];
  advisoryOnly: true;
  wideTraceId: string;
  deepTraceId?: string;
}

export interface CapabilityResolverConfig {
  topK: number;
  needThreshold: number;
  fitThreshold: number;
}
