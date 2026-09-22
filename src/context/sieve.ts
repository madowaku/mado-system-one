import type { SystemOneProvider } from "../core/provider.js";
import type { DecisionRequest, NoulResult } from "../core/types.js";
import type {
  ContextChunk,
  ContextSieveConfig,
  ContextSieveDecision,
  ContextSieveInput,
  ContextSieveResult,
} from "./types.js";

const validateConfig = (config: ContextSieveConfig): void => {
  const { hideThreshold, retainThreshold } = config;

  if (
    !Number.isFinite(hideThreshold) ||
    !Number.isFinite(retainThreshold) ||
    hideThreshold < 0 ||
    retainThreshold > 1 ||
    hideThreshold >= retainThreshold
  ) {
    throw new Error(
      "context sieve thresholds must satisfy 0 <= hideThreshold < retainThreshold <= 1",
    );
  }
};

const asNoul = (value: unknown, id: string): NoulResult => {
  if (!value || typeof value !== "object" || !("type" in value) || value.type !== "noul") {
    throw new Error(`expected noul result for ${id}`);
  }

  return value as NoulResult;
};

const renderChunk = (chunk: ContextChunk): string => {
  const summary = chunk.summary ? `\nSummary: ${chunk.summary}` : "";
  const source = chunk.sourceRef ? `\nSource: ${chunk.sourceRef}` : "";

  return [
    `Kind: ${chunk.kind}`,
    summary,
    source,
    "\nContent:",
    chunk.content,
  ]
    .filter(Boolean)
    .join("");
};

const compileResult = (
  traceId: string,
  decisions: readonly ContextSieveDecision[],
  providerId?: string,
): ContextSieveResult => ({
  traceId,
  ...(providerId ? { providerId } : {}),
  decisions,
  retainedIds: decisions
    .filter((decision) => decision.disposition === "retain")
    .map((decision) => decision.chunkId),
  hiddenIds: decisions
    .filter((decision) => decision.disposition === "hide")
    .map((decision) => decision.chunkId),
  escalatedIds: decisions
    .filter((decision) => decision.disposition === "escalate")
    .map((decision) => decision.chunkId),
  reversible: true,
});

export class ContextSieve {
  readonly #provider: SystemOneProvider;
  readonly #config: ContextSieveConfig;

  constructor(options: {
    provider: SystemOneProvider;
    config: ContextSieveConfig;
  }) {
    validateConfig(options.config);
    this.#provider = options.provider;
    this.#config = options.config;
  }

  async sieve(input: ContextSieveInput): Promise<ContextSieveResult> {
    const traceId = `${input.traceId}:sieve`;
    const mandatory = input.chunks.filter((chunk) => chunk.mandatory);
    const assessable = input.chunks.filter((chunk) => !chunk.mandatory);

    const fixedDecisions: ContextSieveDecision[] = mandatory.map((chunk) => ({
      chunkId: chunk.id,
      disposition: "retain",
      reasonCodes: ["mandatory_context"],
    }));

    if (assessable.length === 0) {
      return compileResult(traceId, fixedDecisions);
    }

    const questionEntries = assessable.map((chunk) => [
      `relevance:${chunk.id}`,
      {
        type: "noul" as const,
        prompt: [
          "Is this context chunk materially relevant to completing the current task?",
          "Judge relevance, not whether the chunk is generally interesting.",
          "",
          renderChunk(chunk),
        ].join("\n"),
      },
    ] as const);

    const request: DecisionRequest = {
      traceId,
      pattern: "sieve",
      state: `Current task:\n${input.task}`,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      questions: Object.fromEntries(questionEntries),
    };

    const response = await this.#provider.decide(request);

    const assessedDecisions: ContextSieveDecision[] = assessable.map((chunk) => {
      const result = asNoul(
        response.results[`relevance:${chunk.id}`],
        `relevance:${chunk.id}`,
      );
      const probabilityRelevant = result.probabilityYes;

      if (probabilityRelevant >= this.#config.retainThreshold) {
        return {
          chunkId: chunk.id,
          disposition: "retain",
          probabilityRelevant,
          reasonCodes: ["relevance_above_retain_threshold"],
        };
      }

      if (probabilityRelevant <= this.#config.hideThreshold) {
        if (!chunk.restorationRef) {
          return {
            chunkId: chunk.id,
            disposition: "retain",
            probabilityRelevant,
            reasonCodes: [
              "relevance_below_hide_threshold",
              "non_reversible_context",
            ],
          };
        }

        return {
          chunkId: chunk.id,
          disposition: "hide",
          probabilityRelevant,
          reasonCodes: [
            "relevance_below_hide_threshold",
            "reversible_hide",
          ],
        };
      }

      return {
        chunkId: chunk.id,
        disposition: "escalate",
        probabilityRelevant,
        reasonCodes: ["uncertain_relevance"],
      };
    });

    return compileResult(
      traceId,
      [...fixedDecisions, ...assessedDecisions],
      response.providerId,
    );
  }
}
