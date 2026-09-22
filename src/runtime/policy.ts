import type {
  PlannedAction,
  PolicyResult,
  PolicyRule,
} from "./types.js";

const matches = (rule: PolicyRule, action: PlannedAction): boolean =>
  rule.capability === action.capability && rule.operation === action.operation;

export class PolicyGate {
  readonly #rules: readonly PolicyRule[];
  readonly #defaultDecision: PolicyResult;

  constructor(options?: {
    rules?: readonly PolicyRule[];
    defaultDecision?: PolicyResult;
  }) {
    this.#rules = options?.rules ?? [];
    this.#defaultDecision = options?.defaultDecision ?? {
      decision: "ask",
      reason: "no explicit policy rule",
    };
  }

  evaluate(action: PlannedAction): PolicyResult {
    const rule = this.#rules.find((candidate) => matches(candidate, action));

    if (!rule) {
      return this.#defaultDecision;
    }

    return {
      decision: rule.decision,
      reason: rule.reason,
    };
  }
}
