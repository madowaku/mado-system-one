import type { SystemOneProvider } from "../core/provider.js";
import { validateDecisionResponse } from "../core/provider.js";
import type {
  DecisionRequest,
  DecisionResponse,
  ProviderCapabilities,
  ProviderHealth,
} from "../core/types.js";

export type MockResponder =
  | DecisionResponse
  | ((request: DecisionRequest) => DecisionResponse | Promise<DecisionResponse>);

export interface MockProviderOptions {
  id?: string;
  responder: MockResponder;
  capabilities?: Partial<ProviderCapabilities>;
  validateResponses?: boolean;
}

export class MockSystemOneProvider implements SystemOneProvider {
  readonly id: string;

  readonly #responder: MockResponder;
  readonly #capabilities: ProviderCapabilities;
  readonly #validateResponses: boolean;

  constructor(options: MockProviderOptions) {
    this.id = options.id ?? "mock";
    this.#responder = options.responder;
    this.#validateResponses = options.validateResponses ?? true;

    this.#capabilities = {
      primitives: options.capabilities?.primitives ?? ["choice", "noul", "score"],
      modalities: options.capabilities?.modalities ?? ["text"],
      probabilitySemantics: options.capabilities?.probabilitySemantics ?? "heuristic",
      supportsBatch: options.capabilities?.supportsBatch ?? false,
      supportsAdaptiveReads: options.capabilities?.supportsAdaptiveReads ?? false,
    };
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    const response =
      typeof this.#responder === "function"
        ? await this.#responder(request)
        : this.#responder;

    const normalized: DecisionResponse = {
      ...response,
      traceId: request.traceId,
      providerId: response.providerId || this.id,
    };

    if (this.#validateResponses) {
      validateDecisionResponse(request, normalized);
    }

    return normalized;
  }

  capabilities(): ProviderCapabilities {
    return this.#capabilities;
  }

  async health(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      detail: "deterministic mock provider",
    };
  }
}
