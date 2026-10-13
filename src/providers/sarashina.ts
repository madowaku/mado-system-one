// MSO-DM-M0.5: retrieval API contract, intentionally NOT a SystemOneProvider.
// Relevance scores are uncalibrated and cannot authorize policy decisions.
export type SarashinaEmbeddingTask =
  | "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "QUESTION_ANSWERING"
  | "FACT_VERIFICATION" | "SEMANTIC_SIMILARITY" | "CLASSIFICATION" | "CLUSTERING";
export type SarashinaRerankTask =
  | "GENERAL_RETRIEVAL" | "GENERAL_QA" | "NEWS_RETRIEVAL"
  | "SEMANTIC_SIMILARITY" | "CUSTOMIZE";

export interface SarashinaRerankHit {
  documentIndex: number;
  score: number; // Ranking signal; NOT a calibrated probability.
}
export interface SarashinaRetrievalProvider {
  readonly id: string;
  embed(input: string, task: SarashinaEmbeddingTask): Promise<readonly number[]>;
  rerank(query: string, documents: readonly string[], task?: SarashinaRerankTask, instruction?: string): Promise<readonly SarashinaRerankHit[]>;
}
export interface SarashinaOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  maxRetries?: number;
}
export const SARASHINA_RETRIEVAL_MODELS = Object.freeze({
  embedding: "sarashina3-embedding",
  rerank: "sarashina3-rerank",
});
export class SarashinaContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SarashinaContractError";
  }
}
export class SarashinaHttpError extends Error {
  constructor(readonly status: number) {
    super("Sarashina API HTTP " + status);
    this.name = "SarashinaHttpError";
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const nonEmpty = (s: string, name: string): void => {
  if (!s.trim()) throw new SarashinaContractError(name + " must be non-empty");
};
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export class SarashinaApiProvider implements SarashinaRetrievalProvider {
  readonly id = "sarashina-retrieval";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly apiKey: string;
  private readonly nextCall = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();

  constructor(options: SarashinaOptions) {
    nonEmpty(options.apiKey, "apiKey");
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.sarashina.ai";
    const url = new URL(this.baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new SarashinaContractError("baseUrl must be an HTTPS origin without credentials or query");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? wait;
    this.minIntervalMs = options.minIntervalMs ?? 1100;
    this.maxRetries = options.maxRetries ?? 1;
    if (!Number.isInteger(this.minIntervalMs) || this.minIntervalMs < 0 ||
      !Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 3) {
      throw new SarashinaContractError("invalid pacing/retry configuration");
    }
  }

  private async post(path: string, model: string, body: Record<string, unknown>): Promise<unknown> {
    const action = async (): Promise<unknown> => {
      for (let attempt = 0; ; attempt++) {
        const delta = (this.nextCall.get(model) ?? 0) - Date.now();
        if (delta > 0) await this.sleep(delta);
        this.nextCall.set(model, Date.now() + this.minIntervalMs);
        const response = await this.fetchImpl(new URL(path, this.baseUrl), {
          method: "POST",
          headers: {
            Authorization: "Bearer " + this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });
        if (response.ok) return response.json() as Promise<unknown>;
        if (attempt >= this.maxRetries || (response.status !== 429 && response.status < 500)) {
          // Do not log response body, fixture text, or credentials.
          throw new SarashinaHttpError(response.status);
        }
        await this.sleep(response.status === 429 ? 65_000 : 1000 * (2 ** attempt));
      }
    };
    const result = this.queue.then(action);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async embed(input: string, task: SarashinaEmbeddingTask): Promise<readonly number[]> {
    nonEmpty(input, "input");
    const valid: readonly string[] = [
      "RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY", "QUESTION_ANSWERING",
      "FACT_VERIFICATION", "SEMANTIC_SIMILARITY", "CLASSIFICATION", "CLUSTERING",
    ];
    if (!valid.includes(task)) throw new SarashinaContractError("invalid embedding task");
    const response = await this.post("/v1/embeddings", SARASHINA_RETRIEVAL_MODELS.embedding, {
      model: SARASHINA_RETRIEVAL_MODELS.embedding, input, task_type: task,
    });
    if (!record(response) || !Array.isArray(response.data) || response.data.length !== 1 ||
      !record(response.data[0]) || response.data[0].index !== 0 ||
      !Array.isArray(response.data[0].embedding) ||
      response.data[0].embedding.length !== 1536 ||
      !response.data[0].embedding.every(finite)) {
      throw new SarashinaContractError("invalid embedding response (expected 1536 finite floats)");
    }
    return response.data[0].embedding as number[];
  }

  async rerank(
    query: string, documents: readonly string[],
    task: SarashinaRerankTask = "GENERAL_RETRIEVAL", instruction?: string,
  ): Promise<readonly SarashinaRerankHit[]> {
    nonEmpty(query, "query");
    if (documents.length < 1 || documents.length > 20 || documents.some((d) => !d.trim())) {
      throw new SarashinaContractError("rerank requires 1..20 non-empty documents");
    }
    if (task === "CUSTOMIZE" && !instruction?.trim()) {
      throw new SarashinaContractError("CUSTOMIZE requires query_instruction");
    }
    if (!["GENERAL_RETRIEVAL", "GENERAL_QA", "NEWS_RETRIEVAL", "SEMANTIC_SIMILARITY", "CUSTOMIZE"].includes(task)) {
      throw new SarashinaContractError("invalid rerank task");
    }
    const response = await this.post("/v1/rerank", SARASHINA_RETRIEVAL_MODELS.rerank, {
      model: SARASHINA_RETRIEVAL_MODELS.rerank,
      query, documents, task_type: task,
      ...(task === "CUSTOMIZE" ? { query_instruction: instruction } : {}),
    });
    if (!record(response) || !Array.isArray(response.data) ||
      response.data.length !== 1 || !record(response.data[0]) ||
      !Array.isArray(response.data[0].result)) {
      throw new SarashinaContractError("invalid rerank response envelope");
    }
    const ranked: SarashinaRerankHit[] = [];
    const ids = new Set<number>();
    for (const item of response.data[0].result) {
      if (!record(item) || !Number.isInteger(item.document_id) ||
        (item.document_id as number) < 0 || (item.document_id as number) >= documents.length ||
        !finite(item.score) || item.score < 0 || item.score > 1 ||
        ids.has(item.document_id as number)) {
        throw new SarashinaContractError("invalid/duplicate rerank document score");
      }
      ids.add(item.document_id as number);
      ranked.push({ documentIndex: item.document_id as number, score: item.score });
    }
    if (ranked.length !== documents.length) {
      throw new SarashinaContractError("rerank must return all documents");
    }
    return ranked.sort((a, b) => b.score - a.score || a.documentIndex - b.documentIndex);
  }
}

// Cosine, not dot product: Sarashina embedding output is not normalized.
export const cosineSimilarity = (a: readonly number[], b: readonly number[]): number => {
  if (!a.length || a.length !== b.length) throw new SarashinaContractError("embedding dimensions differ");
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (!finite(x) || !finite(y)) throw new SarashinaContractError("non-finite embedding");
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  if (aa === 0 || bb === 0) throw new SarashinaContractError("zero-norm embedding");
  return dot / Math.sqrt(aa * bb);
};
