import { buildReadOnlyRepoAuditSession } from "./request.js";
import type {
  AgentsApiRawEvent,
  AgentsApiTransport,
  AgentsHarnessRun,
  AgentsRecoveryEvidence,
  AgentsTerminalStatus,
  AgentsUsageSummary,
  HarnessBakeoffComparison,
  HarnessBakeoffRecord,
  ManagedHarnessEvidence,
  RepoAuditSessionInput,
} from "./types.js";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const eventTerminalStatus = (
  event: AgentsApiRawEvent,
): AgentsTerminalStatus | null => {
  switch (event.type) {
    case "agent.session.turn.completed":
      return "completed";
    case "agent.session.turn.failed":
      return "failed";
    case "agent.session.turn.cancelled":
      return "cancelled";
    default:
      return null;
  }
};

const sessionIdFromEvent = (event: AgentsApiRawEvent): string | undefined => {
  if (typeof event.session_id === "string" && event.session_id.length > 0) {
    return event.session_id;
  }
  const session = event.session;
  if (isRecord(session) && typeof session.id === "string" && session.id.length > 0) {
    return session.id;
  }
  return undefined;
};

const findUsage = (value: unknown, depth = 0): Readonly<Record<string, unknown>> | null => {
  if (depth > 6 || !isRecord(value)) return null;
  const usage = value.usage;
  if (isRecord(usage)) return usage;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findUsage(item, depth + 1);
        if (found) return found;
      }
    } else if (isRecord(child)) {
      const found = findUsage(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
};

const finiteNumber = (
  record: Readonly<Record<string, unknown>>,
  ...keys: string[]
): number | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
};

const addUsage = (
  current: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    sawInput: boolean;
    sawCached: boolean;
    sawOutput: boolean;
    sawTotal: boolean;
  },
  usage: Readonly<Record<string, unknown>>,
): void => {
  const input = finiteNumber(usage, "input_tokens", "inputTokens");
  const inputDetails = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : isRecord(usage.inputTokensDetails)
      ? usage.inputTokensDetails
      : null;
  const cached =
    finiteNumber(usage, "cached_input_tokens", "cachedInputTokens") ??
    (inputDetails
      ? finiteNumber(inputDetails, "cached_tokens", "cachedTokens")
      : undefined);
  const output = finiteNumber(usage, "output_tokens", "outputTokens");
  const total = finiteNumber(usage, "total_tokens", "totalTokens");

  if (input !== undefined) {
    current.inputTokens += input;
    current.sawInput = true;
  }
  if (cached !== undefined) {
    current.cachedInputTokens += cached;
    current.sawCached = true;
  }
  if (output !== undefined) {
    current.outputTokens += output;
    current.sawOutput = true;
  }
  if (total !== undefined) {
    current.totalTokens += total;
    current.sawTotal = true;
  }
};

const finalizeUsage = (usage: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sawInput: boolean;
  sawCached: boolean;
  sawOutput: boolean;
  sawTotal: boolean;
}): AgentsUsageSummary => {
  const any =
    usage.sawInput || usage.sawCached || usage.sawOutput || usage.sawTotal;
  if (!any) return { status: "unknown" };

  const status =
    usage.sawInput && usage.sawOutput ? "known" : "partial";

  return {
    status,
    ...(usage.sawInput ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.sawCached ? { cachedInputTokens: usage.cachedInputTokens } : {}),
    ...(usage.sawOutput ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.sawTotal ? { totalTokens: usage.totalTokens } : {}),
  };
};

const itemId = (item: Readonly<Record<string, unknown>>): string | undefined =>
  typeof item.id === "string" && item.id.length > 0 ? item.id : undefined;

const subagentId = (
  item: Readonly<Record<string, unknown>>,
): string | undefined =>
  typeof item.id === "string" && item.id.length > 0 ? item.id : undefined;

const assistantTextFromItems = (
  items: readonly Readonly<Record<string, unknown>>[],
): readonly string[] => {
  const output: string[] = [];
  for (const item of items) {
    if (item.role !== "assistant" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isRecord(content) &&
        typeof content.text === "string" &&
        content.text.trim()
      ) {
        output.push(content.text);
      }
    }
  }
  return output;
};

export class AgentsRepoAuditHarness {
  readonly #transport: AgentsApiTransport;

  constructor(transport: AgentsApiTransport) {
    this.#transport = transport;
  }

  async run(input: RepoAuditSessionInput): Promise<AgentsHarnessRun> {
    const request = buildReadOnlyRepoAuditSession(input);
    const rawEvents: AgentsApiRawEvent[] = [];
    const eventTypes = new Set<string>();
    const outputText: string[] = [];
    const usageEventIds = new Set<string>();
    const usageAccumulator = {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      sawInput: false,
      sawCached: false,
      sawOutput: false,
      sawTotal: false,
    };

    let sessionId: string | undefined;
    let terminalStatus: AgentsTerminalStatus = "unknown";
    const recoveryErrors: string[] = [];

    try {
      for await (const event of this.#transport.streamSession(request)) {
        rawEvents.push(event);
        if (event.type) eventTypes.add(event.type);
        sessionId ??= sessionIdFromEvent(event);

        const terminal = eventTerminalStatus(event);
        if (terminal) {
          terminalStatus = terminal;
          const eventIdentity =
            typeof event.event_id === "string"
              ? event.event_id
              : `terminal-${rawEvents.length}`;
          if (!usageEventIds.has(eventIdentity)) {
            const usage = findUsage(event);
            if (usage) addUsage(usageAccumulator, usage);
            usageEventIds.add(eventIdentity);
          }
        }

        if (
          event.type === "agent.session.turn.output_text.done" &&
          typeof event.text === "string" &&
          event.text.trim()
        ) {
          outputText.push(event.text);
        }
      }
    } catch (error) {
      recoveryErrors.push(
        `stream: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let sessionRetrieved = false;
    let rootItemsRetrieved = false;
    let subagentsRetrieved = false;
    let subagentItemsRetrieved = false;
    let rootItems: readonly Readonly<Record<string, unknown>>[] = [];
    let subagents: readonly Readonly<Record<string, unknown>>[] = [];
    const subagentItems: Record<
      string,
      readonly Readonly<Record<string, unknown>>[]
    > = {};

    if (sessionId) {
      try {
        await this.#transport.retrieveSession(sessionId);
        sessionRetrieved = true;
      } catch (error) {
        recoveryErrors.push(
          `session: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      try {
        rootItems = await this.#transport.listSessionItems(sessionId);
        rootItemsRetrieved = true;
      } catch (error) {
        recoveryErrors.push(
          `root_items: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      try {
        subagents = await this.#transport.listSessionSubagents(sessionId);
        subagentsRetrieved = true;
      } catch (error) {
        recoveryErrors.push(
          `subagents: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      let allSubagentItems = subagentsRetrieved;
      for (const subagent of subagents) {
        const id = subagentId(subagent);
        if (!id) {
          allSubagentItems = false;
          recoveryErrors.push("subagent item missing id");
          continue;
        }
        try {
          subagentItems[id] = await this.#transport.listSubagentItems(
            sessionId,
            id,
          );
        } catch (error) {
          allSubagentItems = false;
          recoveryErrors.push(
            `subagent_items:${id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      subagentItemsRetrieved = allSubagentItems;
    }

    const recoveredOutput = assistantTextFromItems(rootItems);
    for (const text of recoveredOutput) {
      if (!outputText.includes(text)) outputText.push(text);
    }

    const subagentIds = subagents
      .map(subagentId)
      .filter((id): id is string => id !== undefined);

    const evidenceRefs: string[] = [];
    if (sessionId) evidenceRefs.push(`agents://session/${sessionId}`);
    for (const item of rootItems) {
      const id = itemId(item);
      if (sessionId && id) {
        evidenceRefs.push(`agents://session/${sessionId}/item/${id}`);
      }
    }
    for (const id of subagentIds) {
      evidenceRefs.push(`agents://session/${sessionId}/subagent/${id}`);
      for (const item of subagentItems[id] ?? []) {
        const childItemId = itemId(item);
        if (childItemId) {
          evidenceRefs.push(
            `agents://session/${sessionId}/subagent/${id}/item/${childItemId}`,
          );
        }
      }
    }

    const recovery: AgentsRecoveryEvidence = {
      sessionRetrieved,
      rootItemsRetrieved,
      subagentsRetrieved,
      subagentItemsRetrieved,
      errors: recoveryErrors,
    };

    return {
      runtime: "openai_agents_api",
      snapshotId: input.snapshotId,
      ...(sessionId ? { sessionId } : {}),
      terminalStatus,
      eventCount: rawEvents.length,
      eventTypes: [...eventTypes],
      outputText,
      subagentIds,
      usage: finalizeUsage(usageAccumulator),
      evidenceRefs: [...new Set(evidenceRefs)],
      recovery,
      rawEvents,
      rootItems,
      subagentItems,
    };
  }
}

export const toManagedHarnessEvidence = (
  run: AgentsHarnessRun,
): ManagedHarnessEvidence => ({
  runtime: "openai_agents_api",
  snapshotId: run.snapshotId,
  runtimeStatus: run.terminalStatus,
  verificationStatus: "not_run",
  evidenceRefs: run.evidenceRefs,
  detail:
    run.terminalStatus === "completed"
      ? "Agents API turn completed. MADO independent Verification has not run."
      : `Agents API runtime status is ${run.terminalStatus}. MADO independent Verification has not run.`,
});

export const toHarnessBakeoffRecord = (
  run: AgentsHarnessRun,
  options: {
    runtime?: string;
    madoVerified?: boolean | null;
    notes?: readonly string[];
  } = {},
): HarnessBakeoffRecord => ({
  runtime: options.runtime ?? run.runtime,
  runtimeCompleted: run.terminalStatus === "completed",
  madoVerified: options.madoVerified ?? null,
  usageStatus: run.usage.status,
  totalTokens: run.usage.totalTokens ?? null,
  estimatedCostUsd: null,
  evidenceRefCount: run.evidenceRefs.length,
  recoveryAvailable:
    run.recovery.sessionRetrieved && run.recovery.rootItemsRetrieved,
  notes: [
    "Dollar cost is intentionally not embedded; apply current model/tool/container pricing to observed usage.",
    ...(options.notes ?? []),
  ],
});

export const compareHarnessBakeoffRecords = (
  left: HarnessBakeoffRecord,
  right: HarnessBakeoffRecord,
): HarnessBakeoffComparison => ({
  left,
  right,
  comparable: {
    completion: true,
    verification: left.madoVerified !== null && right.madoVerified !== null,
    tokenUsage: left.totalTokens !== null && right.totalTokens !== null,
    dollarCost:
      left.estimatedCostUsd !== null && right.estimatedCostUsd !== null,
    evidenceCount: true,
    recovery: true,
  },
});
