export const FORGE_PHASES = [
  "intake",
  "diverge",
  "judge",
  "synthesize",
  "specify",
  "contract_freeze",
  "build",
  "review",
  "integrate",
  "experience_eval",
  "find",
  "falsify",
  "fix",
  "verify",
  "human_check",
  "release_gate",
  "done",
] as const;

export type ForgePhase = (typeof FORGE_PHASES)[number];

export type FindingSeverity = "low" | "medium" | "high";
export type FindingStatus =
  | "candidate"
  | "confirmed"
  | "not_proven"
  | "fixed"
  | "verified";

export type FalsificationOutcome =
  | "real"
  | "not_proven"
  | "duplicate"
  | "misclassified";

export type HumanSignalSeverity = "note" | "friction" | "blocker";
export type ReleaseGateStatus = "pass" | "fail" | "blocked";

export interface ForgeRunState {
  runId: string;
  phase: ForgePhase;
  artifactVersion: string;
  startedAt: string;
  updatedAt: string;
  evidenceRoot: string;
}

export interface ForgeCandidate {
  id: string;
  thesis: string;
  assumptions: readonly string[];
  evidenceRefs: readonly string[];
  risks: readonly string[];
}

export interface JuryResult {
  jurorId: string;
  lens: string;
  candidateIds: readonly string[];
  observations: readonly string[];
  rejectedAssumptions: readonly string[];
  reusableStrengths: readonly string[];
  uncertainty: readonly string[];
  synthesisGuidance: readonly string[];
  evidenceRefs: readonly string[];
}

export interface OwnershipLease {
  surfaceId: string;
  ownerAgentId: string;
  allowedWrites: readonly string[];
  forbiddenWrites: readonly string[];
  dependencies: readonly string[];
  expiresAtPhase: ForgePhase;
}

export interface AcceptanceResult {
  criterionId: string;
  passed: boolean;
  detail?: string;
  evidenceRefs: readonly string[];
}

export interface CrossOwnerRequest {
  requestId: string;
  fromAgentId: string;
  targetSurfaceId: string;
  requestedChange: string;
  evidenceRefs: readonly string[];
}

export interface BuildReport {
  agentId: string;
  ownedSurfaces: readonly string[];
  changedSurfaces: readonly string[];
  acceptanceResults: readonly AcceptanceResult[];
  evidenceRefs: readonly string[];
  crossOwnerRequests: readonly CrossOwnerRequest[];
  unresolved: readonly string[];
}

export interface Finding {
  findingId: string;
  claim: string;
  severity: FindingSeverity;
  reproduction: readonly string[];
  evidenceRefs: readonly string[];
  status: FindingStatus;
}

export interface FalsificationResult {
  findingId: string;
  verifierAgentId: string;
  outcome: FalsificationOutcome;
  reproductionAttempted: boolean;
  refutationAttempted: boolean;
  evidenceRefs: readonly string[];
  notes: readonly string[];
}

export interface HumanSignal {
  signalId: string;
  observation: string;
  artifactVersion: string;
  affectedDecisionIds: readonly string[];
  severity: HumanSignalSeverity;
  evidenceRefs: readonly string[];
}

export interface ReleaseGate {
  artifactVersion: string;
  status: ReleaseGateStatus;
  contractValid: boolean;
  functionalCorrectness: boolean;
  experientialQuality: boolean;
  operationalSafety: boolean;
  unresolvedFindingIds: readonly string[];
  humanBlockerSignalIds: readonly string[];
  policyConfirmationRefs: readonly string[];
  evidenceRefs: readonly string[];
  rollbackRef: string;
}

export interface ForgeM0Fixture {
  run: ForgeRunState;
  candidates: readonly ForgeCandidate[];
  juryResults: readonly JuryResult[];
  ownershipLeases: readonly OwnershipLease[];
  buildReports: readonly BuildReport[];
  findings: readonly Finding[];
  falsificationResults: readonly FalsificationResult[];
  humanSignals: readonly HumanSignal[];
  releaseGate: ReleaseGate;
}

export class ForgeContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForgeContractError";
  }
}

const phaseSet = new Set<string>(FORGE_PHASES);
const findingSeveritySet = new Set<string>(["low", "medium", "high"]);
const findingStatusSet = new Set<string>([
  "candidate",
  "confirmed",
  "not_proven",
  "fixed",
  "verified",
]);
const falsificationOutcomeSet = new Set<string>([
  "real",
  "not_proven",
  "duplicate",
  "misclassified",
]);
const humanSignalSeveritySet = new Set<string>([
  "note",
  "friction",
  "blocker",
]);
const releaseGateStatusSet = new Set<string>(["pass", "fail", "blocked"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new ForgeContractError(`${label} must be an object`);
  }
  return value;
};

const requireString = (
  record: Record<string, unknown>,
  key: string,
  label: string,
): string => {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ForgeContractError(`${label}.${key} must be a non-empty string`);
  }
  return value;
};

const requireBoolean = (
  record: Record<string, unknown>,
  key: string,
  label: string,
): boolean => {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new ForgeContractError(`${label}.${key} must be a boolean`);
  }
  return value;
};

const requireStringArray = (
  record: Record<string, unknown>,
  key: string,
  label: string,
): readonly string[] => {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ForgeContractError(`${label}.${key} must be a string array`);
  }
  return value;
};

const requireArray = (
  record: Record<string, unknown>,
  key: string,
  label: string,
): readonly unknown[] => {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new ForgeContractError(`${label}.${key} must be an array`);
  }
  return value;
};

const requireEnum = <T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<string>,
  label: string,
): T => {
  const value = requireString(record, key, label);
  if (!allowed.has(value)) {
    throw new ForgeContractError(`${label}.${key} has unsupported value: ${value}`);
  }
  return value as T;
};

const validateRunState = (value: unknown): void => {
  const record = requireRecord(value, "run");
  requireString(record, "runId", "run");
  requireEnum<ForgePhase>(record, "phase", phaseSet, "run");
  requireString(record, "artifactVersion", "run");
  requireString(record, "startedAt", "run");
  requireString(record, "updatedAt", "run");
  requireString(record, "evidenceRoot", "run");
};

const validateCandidate = (value: unknown, index: number): void => {
  const label = `candidates[${index}]`;
  const record = requireRecord(value, label);
  requireString(record, "id", label);
  requireString(record, "thesis", label);
  requireStringArray(record, "assumptions", label);
  requireStringArray(record, "evidenceRefs", label);
  requireStringArray(record, "risks", label);
};

const validateJuryResult = (value: unknown, index: number): void => {
  const label = `juryResults[${index}]`;
  const record = requireRecord(value, label);
  requireString(record, "jurorId", label);
  requireString(record, "lens", label);
  requireStringArray(record, "candidateIds", label);
  requireStringArray(record, "observations", label);
  requireStringArray(record, "rejectedAssumptions", label);
  requireStringArray(record, "reusableStrengths", label);
  requireStringArray(record, "uncertainty", label);
  requireStringArray(record, "synthesisGuidance", label);
  requireStringArray(record, "evidenceRefs", label);
};

const validateLease = (value: unknown, index: number): void => {
  const label = `ownershipLeases[${index}]`;
  const record = requireRecord(value, label);
  requireString(record, "surfaceId", label);
  requireString(record, "ownerAgentId", label);
  requireStringArray(record, "allowedWrites", label);
  requireStringArray(record, "forbiddenWrites", label);
  requireStringArray(record, "dependencies", label);
  requireEnum<ForgePhase>(record, "expiresAtPhase", phaseSet, label);
};

const validateAcceptanceResult = (value: unknown, label: string): void => {
  const record = requireRecord(value, label);
  requireString(record, "criterionId", label);
  requireBoolean(record, "passed", label);
  if (record.detail !== undefined && typeof record.detail !== "string") {
    throw new ForgeContractError(`${label}.detail must be a string when present`);
  }
  requireStringArray(record, "evidenceRefs", label);
};

const validateCrossOwnerRequest = (value: unknown, label: string): void => {
  const record = requireRecord(value, label);
  requireString(record, "requestId", label);
  requireString(record, "fromAgentId", label);
  requireString(record, "targetSurfaceId", label);
  requireString(record, "requestedChange", label);
  requireStringArray(record, "evidenceRefs", label);
};

const validateBuildReport = (value: unknown, index: number): void => {
  const label = `buildReports[${index}]`;
  const record = requireRecord(value, label);
  requireString(record, "agentId", label);
  requireStringArray(record, "ownedSurfaces", label);
  requireStringArray(record, "changedSurfaces", label);
  requireArray(record, "acceptanceResults", label).forEach((item, itemIndex) =>
    validateAcceptanceResult(item, `${label}.acceptanceResults[${itemIndex}]`),
  );
  requireStringArray(record, "evidenceRefs", label);
  requireArray(record, "crossOwnerRequests", label).forEach(
    (item, itemIndex) =>
      validateCrossOwnerRequest(
        item,
        `${label}.crossOwnerRequests[${itemIndex}]`,
      ),
  );
  requireStringArray(record, "unresolved", label);
};

const validateFinding = (value: unknown, index: number): void => {
  const label = `findings[${index}]`;
  const record = requireRecord(value, label);
  requireString(record, "findingId", label);
  requireString(record, "claim", label);
  requireEnum<FindingSeverity>(
    record,
    "severity",
    findingSeveritySet,
    label,
  );
  requireStringArray(record, "reproduction", label);
  requireStringArray(record, "evidenceRefs", label);
  requireEnum<FindingStatus>(record, "status", findingStatusSet, label);
};

const validateFalsificationResult = (value: unknown, index: number): void => {
  const label = `falsificationResults[${index}]`;
  const record = requireRecord(value, label);
  requireString(record, "findingId", label);
  requireString(record, "verifierAgentId", label);
  requireEnum<FalsificationOutcome>(
    record,
    "outcome",
    falsificationOutcomeSet,
    label,
  );
  requireBoolean(record, "reproductionAttempted", label);
  requireBoolean(record, "refutationAttempted", label);
  requireStringArray(record, "evidenceRefs", label);
  requireStringArray(record, "notes", label);
};

const validateHumanSignal = (value: unknown, index: number): void => {
  const label = `humanSignals[${index}]`;
  const record = requireRecord(value, label);
  requireString(record, "signalId", label);
  requireString(record, "observation", label);
  requireString(record, "artifactVersion", label);
  requireStringArray(record, "affectedDecisionIds", label);
  requireEnum<HumanSignalSeverity>(
    record,
    "severity",
    humanSignalSeveritySet,
    label,
  );
  requireStringArray(record, "evidenceRefs", label);
};

const validateReleaseGate = (value: unknown): void => {
  const label = "releaseGate";
  const record = requireRecord(value, label);
  requireString(record, "artifactVersion", label);
  requireEnum<ReleaseGateStatus>(
    record,
    "status",
    releaseGateStatusSet,
    label,
  );
  requireBoolean(record, "contractValid", label);
  requireBoolean(record, "functionalCorrectness", label);
  requireBoolean(record, "experientialQuality", label);
  requireBoolean(record, "operationalSafety", label);
  requireStringArray(record, "unresolvedFindingIds", label);
  requireStringArray(record, "humanBlockerSignalIds", label);
  requireStringArray(record, "policyConfirmationRefs", label);
  requireStringArray(record, "evidenceRefs", label);
  requireString(record, "rollbackRef", label);
};

export const validateForgeM0Fixture = (
  value: unknown,
): asserts value is ForgeM0Fixture => {
  const record = requireRecord(value, "fixture");

  validateRunState(record.run);
  requireArray(record, "candidates", "fixture").forEach(validateCandidate);
  requireArray(record, "juryResults", "fixture").forEach(validateJuryResult);
  requireArray(record, "ownershipLeases", "fixture").forEach(validateLease);
  requireArray(record, "buildReports", "fixture").forEach(validateBuildReport);
  requireArray(record, "findings", "fixture").forEach(validateFinding);
  requireArray(record, "falsificationResults", "fixture").forEach(
    validateFalsificationResult,
  );
  requireArray(record, "humanSignals", "fixture").forEach(validateHumanSignal);
  validateReleaseGate(record.releaseGate);
};

export const parseForgeM0Fixture = (json: string): ForgeM0Fixture => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    throw new ForgeContractError(
      `fixture must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  validateForgeM0Fixture(parsed);
  return parsed;
};
