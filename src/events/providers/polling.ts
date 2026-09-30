import type {
  EventProvider,
  EventSubscriptionSpec,
  NormalizedEvent,
} from "../types.js";

export interface PollingRawEvent {
  eventId: string;
  type: string;
  subject: string;
  occurredAt: string;
  payload: unknown;
  freshnessToken: string;
  dedupeKey?: string;
  policy?: NormalizedEvent["policy"];
}

export class PollingEventProvider implements EventProvider<PollingRawEvent> {
  readonly id: string;
  readonly #subscriptions = new Map<string, EventSubscriptionSpec>();
  #counter = 0;

  constructor(source: string) {
    this.id = `polling:${source}`;
  }

  async subscribe(spec: EventSubscriptionSpec): Promise<string> {
    this.#counter += 1;
    const id = `poll-sub-${this.#counter}`;
    this.#subscriptions.set(id, spec);
    return id;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.#subscriptions.delete(subscriptionId);
  }

  async normalize(rawEvent: PollingRawEvent): Promise<NormalizedEvent> {
    if (!rawEvent.freshnessToken) {
      throw new Error("polling event requires a freshnessToken");
    }

    return {
      eventId: rawEvent.eventId,
      source: this.id,
      type: rawEvent.type,
      subject: rawEvent.subject,
      occurredAt: rawEvent.occurredAt,
      payload: rawEvent.payload,
      dedupeKey:
        rawEvent.dedupeKey ??
        `${this.id}:${rawEvent.type}:${rawEvent.subject}:${rawEvent.freshnessToken}`,
      policy: rawEvent.policy ?? {
        risk: "read_only",
        requiresHuman: false,
      },
      metadata: {
        freshnessToken: rawEvent.freshnessToken,
        delivery: "polling",
      },
    };
  }
}
