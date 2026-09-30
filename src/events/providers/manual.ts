import type {
  EventProvider,
  EventSubscriptionSpec,
  NormalizedEvent,
} from "../types.js";

export interface ManualRawEvent {
  eventId: string;
  type: string;
  subject: string;
  occurredAt: string;
  payload: unknown;
  dedupeKey?: string;
  policy?: NormalizedEvent["policy"];
  metadata?: Readonly<Record<string, unknown>>;
}

export class ManualEventProvider implements EventProvider<ManualRawEvent> {
  readonly id = "manual";
  readonly #subscriptions = new Set<string>();
  #counter = 0;

  async subscribe(spec: EventSubscriptionSpec): Promise<string> {
    this.#counter += 1;
    const id = `manual-sub-${this.#counter}-${spec.type}`;
    this.#subscriptions.add(id);
    return id;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.#subscriptions.delete(subscriptionId);
  }

  async normalize(rawEvent: ManualRawEvent): Promise<NormalizedEvent> {
    return {
      eventId: rawEvent.eventId,
      source: this.id,
      type: rawEvent.type,
      subject: rawEvent.subject,
      occurredAt: rawEvent.occurredAt,
      payload: rawEvent.payload,
      dedupeKey:
        rawEvent.dedupeKey ??
        `${this.id}:${rawEvent.type}:${rawEvent.subject}:${rawEvent.eventId}`,
      policy: rawEvent.policy ?? {
        risk: "read_only",
        requiresHuman: false,
      },
      ...(rawEvent.metadata ? { metadata: rawEvent.metadata } : {}),
    };
  }
}
