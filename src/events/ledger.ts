import type { NormalizedEvent } from "./types.js";

export type EventLedgerStatus =
  | "claimed"
  | "completed"
  | "blocked"
  | "failed";

export interface EventLedgerEntry {
  eventId: string;
  dedupeKey: string;
  status: EventLedgerStatus;
  firstSeenAt: string;
  updatedAt: string;
  detail?: string;
}

export interface EventClaimResult {
  accepted: boolean;
  duplicateBy?: "event_id" | "dedupe_key";
  existing?: EventLedgerEntry;
}

export class InMemoryEventLedger {
  readonly #byEventId = new Map<string, EventLedgerEntry>();
  readonly #eventIdByDedupeKey = new Map<string, string>();

  claim(event: NormalizedEvent, now = new Date().toISOString()): EventClaimResult {
    const sameId = this.#byEventId.get(event.eventId);
    if (sameId) {
      return { accepted: false, duplicateBy: "event_id", existing: sameId };
    }

    const existingEventId = this.#eventIdByDedupeKey.get(event.dedupeKey);
    if (existingEventId) {
      const existing = this.#byEventId.get(existingEventId);
      return {
        accepted: false,
        duplicateBy: "dedupe_key",
        ...(existing ? { existing } : {}),
      };
    }

    const entry: EventLedgerEntry = {
      eventId: event.eventId,
      dedupeKey: event.dedupeKey,
      status: "claimed",
      firstSeenAt: now,
      updatedAt: now,
    };

    this.#byEventId.set(event.eventId, entry);
    this.#eventIdByDedupeKey.set(event.dedupeKey, event.eventId);
    return { accepted: true };
  }

  mark(
    eventId: string,
    status: Exclude<EventLedgerStatus, "claimed">,
    detail?: string,
    now = new Date().toISOString(),
  ): EventLedgerEntry {
    const current = this.#byEventId.get(eventId);
    if (!current) {
      throw new Error(`cannot mark unknown event: ${eventId}`);
    }

    const next: EventLedgerEntry = {
      ...current,
      status,
      updatedAt: now,
      ...(detail !== undefined ? { detail } : {}),
    };
    this.#byEventId.set(eventId, next);
    return next;
  }

  get(eventId: string): EventLedgerEntry | undefined {
    return this.#byEventId.get(eventId);
  }

  entries(): readonly EventLedgerEntry[] {
    return [...this.#byEventId.values()];
  }
}
