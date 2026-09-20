import type { SystemOneProvider } from "../core/provider.js";
import type { ChoiceResult, DecisionRequest, NoulResult } from "../core/types.js";
import { CapabilityRegistry } from "./registry.js";
import type {
  CapabilityDescriptor,
  CapabilityResolutionInput,
  CapabilityResolverConfig,
  CapabilitySuggestion,
} from "./types.js";

const validateConfig = (config: CapabilityResolverConfig): void => {
  if (!Number.isInteger(config.topK) || config.topK < 1) {
    throw new Error("topK must be a positive integer");
  }

  for (const [name, value] of [
    ["needThreshold", config.needThreshold],
    ["fitThreshold", config.fitThreshold],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${name} must be within [0, 1]`);
    }
  }
};

const asChoice = (value: unknown, id: string): ChoiceResult => {
  if (!value || typeof value !== "object" || !("type" in value) || value.type !== "choice") {
    throw new Error(`expected choice result for ${id}`);
  }
  return value as ChoiceResult;
};

const asNoul = (value: unknown, id: string): NoulResult => {
  if (!value || typeof value !== "object" || !("type" in value) || value.type !== "noul") {
    throw new Error(`expected noul result for ${id}`);
  }
  return value as NoulResult;
};

const makeWideState = (
  request: string,
  capabilities: readonly CapabilityDescriptor[],
): string => {
  const index = capabilities
    .map(
      (capability) =>
        `[${capability.id}] ${capability.name}: ${capability.shortDescription}`,
    )
    .join("\n");

  return `User request:\n${request}\n\nAvailable capability index:\n${index}`;
};

const makeDeepState = (
  request: string,
  capabilities: readonly CapabilityDescriptor[],
): string => {
  const details = capabilities
    .map((capability) => {
      const description = capability.fullDescription ?? capability.shortDescription;
      const instructions = capability.instructionsRef
        ? `\nInstructions reference: ${capability.instructionsRef}`
        : "";
      return `[${capability.id}] ${capability.name}\n${description}${instructions}`;
    })
    .join("\n\n");

  return `User request:\n${request}\n\nDeep candidate details:\n${details}`;
};

export class CapabilityResolver {
  readonly #provider: SystemOneProvider;
  readonly #registry: CapabilityRegistry;
  readonly #config: CapabilityResolverConfig;

  constructor(options: {
    provider: SystemOneProvider;
    registry: CapabilityRegistry;
    config: CapabilityResolverConfig;
  }) {
    validateConfig(options.config);
    this.#provider = options.provider;
    this.#registry = options.registry;
    this.#config = options.config;
  }

  async resolve(input: CapabilityResolutionInput): Promise<CapabilitySuggestion> {
    const available = this.#registry.listAvailable();
    const wideTraceId = `${input.traceId}:wide`;

    if (available.length === 0) {
      return {
        suggestedCapability: null,
        confidence: 1,
        alternatives: [],
        reasonCodes: ["no_available_capabilities"],
        advisoryOnly: true,
        wideTraceId,
      };
    }

    const wideRequest: DecisionRequest = {
      traceId: wideTraceId,
      pattern: "route",
      state: makeWideState(input.request, available),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      questions: {
        needsCapability: {
          type: "noul",
          prompt: "Does this request benefit from one of the listed specialized capabilities?",
        },
        wideRank: {
          type: "choice",
          prompt: "Which listed capability is most relevant to the request?",
          options: available.map((capability) => ({
            id: capability.id,
            label: capability.name,
            description: capability.shortDescription,
          })),
          allowAbstain: true,
        },
      },
    };

    const wideResponse = await this.#provider.decide(wideRequest);
    const need = asNoul(wideResponse.results.needsCapability, "needsCapability");
    const wideRank = asChoice(wideResponse.results.wideRank, "wideRank");

    if (need.probabilityYes < this.#config.needThreshold) {
      return {
        suggestedCapability: null,
        confidence: 1 - need.probabilityYes,
        alternatives: [],
        reasonCodes: ["capability_not_needed"],
        advisoryOnly: true,
        wideTraceId,
      };
    }

    const topCandidates = available
      .map((capability) => ({
        capability,
        wideProbability: wideRank.distribution[capability.id] ?? 0,
      }))
      .sort((a, b) => b.wideProbability - a.wideProbability)
      .slice(0, this.#config.topK);

    const deepTraceId = `${input.traceId}:deep`;
    const fitQuestionEntries = topCandidates.map(({ capability }) => [
      `fit:${capability.id}`,
      {
        type: "noul" as const,
        prompt: `Does capability "${capability.name}" actually fit this request?`,
      },
    ] as const);

    const deepRequest: DecisionRequest = {
      traceId: deepTraceId,
      pattern: "route",
      state: makeDeepState(
        input.request,
        topCandidates.map(({ capability }) => capability),
      ),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      questions: {
        finalChoice: {
          type: "choice",
          prompt: "Among the deep candidates, which is the best fit?",
          options: topCandidates.map(({ capability }) => ({
            id: capability.id,
            label: capability.name,
            description: capability.fullDescription ?? capability.shortDescription,
          })),
          allowAbstain: true,
        },
        ...Object.fromEntries(fitQuestionEntries),
      },
    };

    const deepResponse = await this.#provider.decide(deepRequest);
    const finalChoice = asChoice(deepResponse.results.finalChoice, "finalChoice");

    const scored = topCandidates.map(({ capability, wideProbability }) => {
      const fit = asNoul(
        deepResponse.results[`fit:${capability.id}`],
        `fit:${capability.id}`,
      ).probabilityYes;

      return {
        capability,
        fit,
        finalProbability: finalChoice.distribution[capability.id] ?? 0,
        wideProbability,
      };
    });

    const eligible = scored
      .filter((candidate) => candidate.fit >= this.#config.fitThreshold)
      .sort(
        (a, b) =>
          b.finalProbability - a.finalProbability ||
          b.fit - a.fit ||
          b.wideProbability - a.wideProbability,
      );

    if (eligible.length === 0) {
      return {
        suggestedCapability: null,
        confidence: Math.max(...scored.map((candidate) => 1 - candidate.fit), 0),
        alternatives: [],
        reasonCodes: ["no_candidate_passed_fit_gate"],
        advisoryOnly: true,
        wideTraceId,
        deepTraceId,
      };
    }

    const selected = eligible[0]!;
    const confidence = Math.min(selected.fit, selected.finalProbability || selected.wideProbability);

    return {
      suggestedCapability: selected.capability.id,
      confidence,
      alternatives: eligible.slice(1).map((candidate) => candidate.capability.id),
      reasonCodes: ["wide_rank", "deep_fit", "advisory_suggestion"],
      advisoryOnly: true,
      wideTraceId,
      deepTraceId,
    };
  }
}
