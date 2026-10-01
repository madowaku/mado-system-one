import type { SystemOneProvider } from "../core/provider.js";
import { validateDecisionResponse } from "../core/provider.js";
import type {
  DecisionRequest,
  DecisionResponse,
  ProviderCapabilities,
  ProviderHealth,
} from "../core/types.js";
import type { ReplayRecord } from "../eval/skeleton.js";

export interface ReplayProviderOptions {
  id?: string;
  records: readonly ReplayRecord[];
}

export class ReplaySystemOneProvider implements SystemOneProvider {
  readonly id: string;
  readonly #records: ReadonlyMap<string, ReplayRecord>;

  constructor(options: ReplayProviderOptions) {
    this.id = options.id ?? "replay";
    this.#records = new Map(options.records.map((record) => [record.traceId, record]));
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    const record = this.#records.get(request.traceId);
    if (!record) {
      throw new Error(`no replay record for traceId ${request.traceId}`);
    }

    const response: DecisionResponse = {
      traceId: request.traceId,
      providerId: this.id,
      probabilitySemantics: "provider_defined",
      confidenceSemantics: "provider_defined",
      calibrationStatus: "unknown",
      results: record.results,
      ...(record.modelId ? { modelId: record.modelId } : {}),
      ...(record.latencyMs !== undefined ? { latencyMs: record.latencyMs } : {}),
      ...(record.estimatedCost !== undefined ? { estimatedCost: record.estimatedCost } : {}),
    };
    validateDecisionResponse(request, response);
    return response;
  }

  capabilities(): ProviderCapabilities {
    return {
      primitives: ["choice", "noul", "score"],
      modalities: ["text"],
      inferenceFamily: "unknown",
      specialization: "task",
      probabilitySemantics: "provider_defined",
      confidenceSemantics: "provider_defined",
      calibration: {
        status: "unknown",
        notes: "replayed fixture output; not a live inference engine",
      },
      supportsBatch: false,
      supportsAdaptiveReads: false,
    };
  }

  async health(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      detail: `${this.#records.size} replay records loaded`,
    };
  }
}
