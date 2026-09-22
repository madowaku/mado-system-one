import { randomUUID } from "node:crypto";

import { PolicyGate } from "./policy.js";
import { verifyOutcome } from "./verifier.js";
import type {
  ActionRecord,
  ApprovalRecord,
  LearningCandidate,
  OutcomeContract,
  PlannedAction,
  RuntimeCapabilityRef,
  RuntimeEvidenceItem,
  RuntimeRun,
  ToolAdapter,
} from "./types.js";

export interface RuntimePlan {
  capabilities: readonly RuntimeCapabilityRef[];
  actions: readonly PlannedAction[];
}

export interface RuntimeDefinition {
  outcome: OutcomeContract;
  plan: RuntimePlan;
}

export class SystemOneRuntime {
  readonly #policy: PolicyGate;
  readonly #adapters: ReadonlyMap<string, ToolAdapter>;
  readonly #now: () => string;

  constructor(options: {
    policy: PolicyGate;
    adapters: readonly ToolAdapter[];
    now?: () => string;
  }) {
    this.#policy = options.policy;
    this.#adapters = new Map(
      options.adapters.map((adapter) => [adapter.capabilityId, adapter]),
    );
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  createRun(intent: string, definition: RuntimeDefinition): RuntimeRun {
    const now = this.#now();

    return {
      id: randomUUID(),
      intent,
      outcome: definition.outcome,
      status: "queued",
      capabilities: definition.plan.capabilities,
      actions: definition.plan.actions.map((action) => ({
        ...action,
        status: "planned",
      })),
      approvals: [],
      evidence: [],
      learnings: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  async execute(run: RuntimeRun): Promise<RuntimeRun> {
    let current = {
      ...run,
      status: "running" as const,
      updatedAt: this.#now(),
    };

    for (const action of current.actions) {
      if (action.status === "executed" || action.status === "rejected") {
        continue;
      }

      const policy = this.#policy.evaluate(action);

      if (policy.decision === "deny") {
        current = this.#replaceAction(current, action.id, {
          ...action,
          status: "rejected",
          output: { policyReason: policy.reason },
        });
        continue;
      }

      if (policy.decision === "ask") {
        const approved = current.approvals.some(
          (approval) =>
            approval.actionId === action.id && approval.decision === "approved",
        );

        if (!approved) {
          return {
            ...current,
            status: "requires_action",
            updatedAt: this.#now(),
          };
        }
      }

      const adapter = this.#adapters.get(action.capability);

      if (!adapter) {
        return {
          ...current,
          status: "failed",
          updatedAt: this.#now(),
        };
      }

      const result = await adapter.execute(action.operation, action.input);

      if (!result.ok) {
        return this.#replaceAction(
          {
            ...current,
            status: "failed",
            updatedAt: this.#now(),
          },
          action.id,
          {
            ...action,
            status: "failed",
            output: { error: result.error ?? "tool execution failed" },
          },
        );
      }

      const executedAt = this.#now();
      current = this.#replaceAction(current, action.id, {
        ...action,
        status: "executed",
        output: result.output,
        executedAt,
      });

      const collected: RuntimeEvidenceItem[] = (result.evidence ?? []).map(
        (item) => ({
          ...item,
          id: randomUUID(),
          createdAt: executedAt,
        }),
      );

      current = {
        ...current,
        evidence: [...current.evidence, ...collected],
        updatedAt: executedAt,
      };
    }

    const verification = verifyOutcome(current.outcome, current.evidence);

    return {
      ...current,
      verification,
      status: verification.success ? "completed" : "failed",
      updatedAt: this.#now(),
    };
  }

  approve(
    run: RuntimeRun,
    actionId: string,
    explanation?: string,
  ): RuntimeRun {
    const approval: ApprovalRecord = {
      id: randomUUID(),
      actionId,
      decision: "approved",
      ...(explanation ? { explanation } : {}),
      decidedAt: this.#now(),
    };

    return {
      ...run,
      approvals: [...run.approvals, approval],
      updatedAt: this.#now(),
    };
  }

  withLearnings(
    run: RuntimeRun,
    learnings: readonly LearningCandidate[],
  ): RuntimeRun {
    return {
      ...run,
      learnings,
      updatedAt: this.#now(),
    };
  }

  #replaceAction(
    run: RuntimeRun,
    actionId: string,
    replacement: ActionRecord,
  ): RuntimeRun {
    return {
      ...run,
      actions: run.actions.map((action) =>
        action.id === actionId ? replacement : action,
      ),
      updatedAt: this.#now(),
    };
  }
}
