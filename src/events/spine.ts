import { InMemoryEventLedger } from "./ledger.js";
import type {
  EventEvidenceRecord,
  EventPolicyEvaluator,
  EventProcessResult,
  EventTaskExecutor,
  EventTaskPlanner,
  EventVerifier,
  NormalizedEvent,
} from "./types.js";

export interface EventSpineOptions {
  ledger?: InMemoryEventLedger;
  policy: EventPolicyEvaluator;
  planner: EventTaskPlanner;
  executor: EventTaskExecutor;
  verifier: EventVerifier;
  clock?: () => string;
}

export class EventSpine {
  readonly #ledger: InMemoryEventLedger;
  readonly #policy: EventPolicyEvaluator;
  readonly #planner: EventTaskPlanner;
  readonly #executor: EventTaskExecutor;
  readonly #verifier: EventVerifier;
  readonly #clock: () => string;

  constructor(options: EventSpineOptions) {
    this.#ledger = options.ledger ?? new InMemoryEventLedger();
    this.#policy = options.policy;
    this.#planner = options.planner;
    this.#executor = options.executor;
    this.#verifier = options.verifier;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  ledger(): InMemoryEventLedger {
    return this.#ledger;
  }

  async process(event: NormalizedEvent): Promise<EventProcessResult> {
    const claim = this.#ledger.claim(event, this.#clock());
    if (!claim.accepted) {
      return {
        status: "duplicate",
        event,
        evidence: this.#evidence(
          event,
          "not_evaluated",
          "not_run",
          "not_run",
          [],
          `Duplicate suppressed by ${claim.duplicateBy ?? "ledger"}.`,
        ),
      };
    }

    const policyOutcome = await this.#policy.evaluate(event);
    if (policyOutcome !== "allow") {
      this.#ledger.mark(event.eventId, "blocked", policyOutcome, this.#clock());
      const status =
        policyOutcome === "confirm"
          ? "confirmation_required"
          : policyOutcome === "deny"
            ? "denied"
            : "escalated";
      return {
        status,
        event,
        evidence: this.#evidence(
          event,
          policyOutcome,
          "not_run",
          "not_run",
          [],
          `Execution blocked by Policy: ${policyOutcome}.`,
        ),
      };
    }

    const task = await this.#planner.plan(event);
    const execution = await this.#executor.execute(task, event);

    if (execution.status === "failed") {
      this.#ledger.mark(event.eventId, "failed", execution.summary, this.#clock());
      return {
        status: "execution_failed",
        event,
        evidence: this.#evidence(
          event,
          policyOutcome,
          "failed",
          "not_run",
          execution.evidenceRefs,
          execution.summary,
          task.taskId,
        ),
      };
    }

    const verification = await this.#verifier.verify(task, execution, event);
    const refs = [...new Set([...execution.evidenceRefs, ...verification.evidenceRefs])];

    if (verification.status !== "pass") {
      this.#ledger.mark(
        event.eventId,
        "failed",
        `verification:${verification.status}`,
        this.#clock(),
      );
      return {
        status:
          verification.status === "fail"
            ? "verification_failed"
            : "verification_uncertain",
        event,
        evidence: this.#evidence(
          event,
          policyOutcome,
          "completed",
          verification.status,
          refs,
          verification.detail,
          task.taskId,
        ),
      };
    }

    this.#ledger.mark(event.eventId, "completed", verification.detail, this.#clock());
    return {
      status: "completed",
      event,
      evidence: this.#evidence(
        event,
        policyOutcome,
        "completed",
        "pass",
        refs,
        verification.detail,
        task.taskId,
      ),
    };
  }

  #evidence(
    event: NormalizedEvent,
    policyOutcome: EventEvidenceRecord["policyOutcome"],
    executionStatus: EventEvidenceRecord["executionStatus"],
    verificationStatus: EventEvidenceRecord["verificationStatus"],
    evidenceRefs: readonly string[],
    detail: string,
    taskId?: string,
  ): EventEvidenceRecord {
    return {
      eventId: event.eventId,
      dedupeKey: event.dedupeKey,
      policyOutcome,
      executionStatus,
      verificationStatus,
      evidenceRefs,
      createdAt: this.#clock(),
      detail,
      ...(taskId ? { taskId } : {}),
    };
  }
}
