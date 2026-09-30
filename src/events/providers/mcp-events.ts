import { createHash } from "node:crypto";

import type {
  EventProvider,
  EventSubscriptionSpec,
  NormalizedEvent,
} from "../types.js";

export const OPENAI_MCP_EVENTS_PROTOCOL_VERSION = "2026-07-28" as const;

export interface McpRawEvent {
  eventId: string;
  name: string;
  timestamp: string;
  data: Readonly<Record<string, unknown>>;
  cursor?: string | null;
}

export interface McpEventsAdapterOptions {
  source: string;
  subjectFromData?: (data: Readonly<Record<string, unknown>>) => string;
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

export const mcpSubscriptionIdentity = (input: {
  principal: string;
  callbackUrl: string;
  eventName: string;
  arguments: Readonly<Record<string, unknown>>;
}): string => {
  const canonical = canonicalJson({
    principal: input.principal,
    callbackUrl: input.callbackUrl,
    eventName: input.eventName,
    arguments: input.arguments,
  });
  return `mcp-sub-${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
};

export class McpEventsAdapter implements EventProvider<McpRawEvent> {
  readonly id: string;
  readonly #subjectFromData: (data: Readonly<Record<string, unknown>>) => string;
  readonly #subscriptions = new Map<string, EventSubscriptionSpec>();
  #counter = 0;

  constructor(options: McpEventsAdapterOptions) {
    this.id = options.source;
    this.#subjectFromData =
      options.subjectFromData ??
      ((data) => {
        for (const key of ["subject_id", "document_id", "project_id", "repository_id"]) {
          const value = data[key];
          if (typeof value === "string" && value.length > 0) return value;
        }
        return "unknown";
      });
  }

  async subscribe(spec: EventSubscriptionSpec): Promise<string> {
    this.#counter += 1;
    const id = `mcp-local-${this.#counter}`;
    this.#subscriptions.set(id, spec);
    return id;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.#subscriptions.delete(subscriptionId);
  }

  async normalize(rawEvent: McpRawEvent): Promise<NormalizedEvent> {
    if (!rawEvent.eventId || !rawEvent.name || !rawEvent.timestamp) {
      throw new Error("MCP event requires eventId, name, and timestamp");
    }

    return {
      eventId: rawEvent.eventId,
      source: this.id,
      type: rawEvent.name,
      subject: this.#subjectFromData(rawEvent.data),
      occurredAt: rawEvent.timestamp,
      payload: rawEvent.data,
      dedupeKey: `${this.id}:${rawEvent.name}:${rawEvent.eventId}`,
      policy: {
        risk: "read_only",
        requiresHuman: false,
      },
      metadata: {
        protocolVersion: OPENAI_MCP_EVENTS_PROTOCOL_VERSION,
        delivery: "webhook",
        cursor: rawEvent.cursor ?? null,
      },
    };
  }
}
