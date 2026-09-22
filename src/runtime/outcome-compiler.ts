import type { CapabilityRequirement } from "./capability-pager.js";
import type { OutcomeContract } from "./types.js";

export interface OutcomeCompilerInput {
  traceId: string;
  intent: string;
  context?: readonly string[];
  metadata?: Readonly<Record<string, unknown>>;
}

export interface OutcomeCompilationDraft {
  outcome: OutcomeContract;
  capabilityRequirements: readonly CapabilityRequirement[];
  assumptions?: readonly string[];
}

export interface OutcomeCompilationResult {
  traceId: string;
  compilerId: string;
  outcome: OutcomeContract;
  capabilityRequirements: readonly CapabilityRequirement[];
  assumptions: readonly string[];
}

export interface OutcomeCompilerAdapter {
  readonly id: string;
  compile(input: OutcomeCompilerInput): Promise<OutcomeCompilationDraft>;
}

const requireText = (value: string, label: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
};

const requireUniqueIds = (
  items: readonly { id: string }[],
  label: string,
): void => {
  const seen = new Set<string>();

  for (const item of items) {
    requireText(item.id, `${label} id`);

    if (seen.has(item.id)) {
      throw new Error(`duplicate ${label} id: ${item.id}`);
    }

    seen.add(item.id);
  }
};

const validateOutcome = (outcome: OutcomeContract): void => {
  requireText(outcome.goal, "outcome goal");

  if (outcome.deliverables.length === 0) {
    throw new Error("outcome must contain at least one deliverable");
  }

  if (outcome.requiredEvidence.length === 0) {
    throw new Error("outcome must contain at least one evidence requirement");
  }

  if (outcome.completionCriteria.length === 0) {
    throw new Error("outcome must contain at least one completion criterion");
  }

  requireUniqueIds(outcome.deliverables, "deliverable");
  requireUniqueIds(outcome.requiredEvidence, "evidence requirement");
  requireUniqueIds(outcome.completionCriteria, "completion criterion");

  for (const deliverable of outcome.deliverables) {
    requireText(deliverable.description, `deliverable ${deliverable.id} description`);
  }

  for (const evidence of outcome.requiredEvidence) {
    requireText(evidence.description, `evidence requirement ${evidence.id} description`);
  }

  for (const criterion of outcome.completionCriteria) {
    requireText(
      criterion.description,
      `completion criterion ${criterion.id} description`,
    );
  }

  for (const constraint of outcome.constraints) {
    requireText(constraint, "constraint");
  }
};

const validateCapabilityRequirements = (
  requirements: readonly CapabilityRequirement[],
): void => {
  requireUniqueIds(requirements, "capability requirement");

  for (const requirement of requirements) {
    requireText(
      requirement.request,
      `capability requirement ${requirement.id} request`,
    );
    requireText(
      requirement.reason,
      `capability requirement ${requirement.id} reason`,
    );
  }
};

export class OutcomeCompiler {
  readonly #adapter: OutcomeCompilerAdapter;

  constructor(options: { adapter: OutcomeCompilerAdapter }) {
    this.#adapter = options.adapter;
  }

  async compile(input: OutcomeCompilerInput): Promise<OutcomeCompilationResult> {
    requireText(input.traceId, "traceId");
    requireText(input.intent, "intent");

    const draft = await this.#adapter.compile(input);

    validateOutcome(draft.outcome);
    validateCapabilityRequirements(draft.capabilityRequirements);

    for (const assumption of draft.assumptions ?? []) {
      requireText(assumption, "assumption");
    }

    return {
      traceId: input.traceId,
      compilerId: this.#adapter.id,
      outcome: draft.outcome,
      capabilityRequirements: draft.capabilityRequirements,
      assumptions: draft.assumptions ?? [],
    };
  }
}
