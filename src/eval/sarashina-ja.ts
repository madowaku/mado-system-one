import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import {
  cosineSimilarity,
  type SarashinaRetrievalProvider,
} from "../providers/sarashina.js";

export type RetrievalMode = "lexical" | "embedding" | "embedding-rerank";
export interface JapaneseRetrievalDocument { id: string; text: string; }
export interface JapaneseRetrievalCase {
  caseId: string;
  taskFamily: string;
  query: string;
  documents: readonly JapaneseRetrievalDocument[];
  relevantDocIds: readonly string[];
}
export interface JapaneseRetrievalFixture {
  datasetId: string;
  cases: readonly JapaneseRetrievalCase[];
}
export interface RetrievalStageResult {
  orderedDocIds: readonly string[];
  recallAt5: number;
  mrrAt5: number;
  latencyMs: number;
}
export interface RetrievalCaseEvidence {
  caseId: string;
  taskFamily: string;
  relevantDocIds: readonly string[];
  lexical: RetrievalStageResult;
  embedding?: RetrievalStageResult;
  rerank?: RetrievalStageResult;
  error?: { stage: "embedding" | "rerank"; category: string };
}
export interface RetrievalStageMetrics {
  cases: number;
  errors: number;
  coverage: number;
  recallAt5: number | null;
  mrrAt5: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
}
export interface JapaneseRetrievalEvidence {
  schemaVersion: "mso.sarashina-ja-retrieval.v0";
  datasetId: string;
  runId: string;
  completedAt: string;
  mode: RetrievalMode;
  providerId: "sarashina-retrieval";
  sourceRefs: readonly string[];
  metrics: { lexical: RetrievalStageMetrics; embedding?: RetrievalStageMetrics; rerank?: RetrievalStageMetrics };
  cases: readonly RetrievalCaseEvidence[];
  authority: {
    evidenceOnly: true;
    automaticProviderRanking: false;
    automaticRoutingDecision: false;
    runtimeAuthorityManaged: false;
    requiresHumanReview: true;
  };
  // This is retrieval evidence, not compatible with the SystemOne choice/noul/score ledger.
  ledgerIntegration: "separate_retrieval_evidence";
}
const valid = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const percentile = (numbers: number[], p: number): number | null => {
  if (!numbers.length) return null;
  const ordered = [...numbers].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(p * ordered.length) - 1)] ?? null;
};
export const parseJapaneseRetrievalCase = (item: unknown): JapaneseRetrievalCase => {
  if (!valid(item) || !nonEmpty(item.caseId) || !nonEmpty(item.taskFamily) ||
    !nonEmpty(item.query) || !Array.isArray(item.documents) ||
    item.documents.length < 1 || item.documents.length > 20 ||
    !Array.isArray(item.relevantDocIds) || item.relevantDocIds.length < 1) {
    throw new Error("invalid Japanese retrieval fixture: required caseId, taskFamily, query, 1..20 documents and gold IDs");
  }
  const docs: JapaneseRetrievalDocument[] = item.documents.map((d: unknown) => {
    if (!valid(d) || !nonEmpty(d.id) || !nonEmpty(d.text)) {
      throw new Error("invalid Japanese retrieval document");
    }
    return { id: d.id, text: d.text };
  });
  const ids = new Set(docs.map((d) => d.id));
  if (ids.size !== docs.length || item.relevantDocIds.some((id: unknown) => !nonEmpty(id) || !ids.has(id))) {
    throw new Error("duplicate/missing gold document ID");
  }
  if (new Set(item.relevantDocIds).size !== item.relevantDocIds.length) {
    throw new Error("duplicate gold document ID");
  }
  return {
    caseId: item.caseId, taskFamily: item.taskFamily, query: item.query,
    documents: docs, relevantDocIds: item.relevantDocIds as string[],
  };
};
export const readJapaneseRetrievalFixture = async (
  path: string, datasetId: string,
): Promise<JapaneseRetrievalFixture> => {
  if (!nonEmpty(datasetId)) throw new Error("datasetId is required");
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error("empty Japanese retrieval fixture");
  const cases = lines.map((line, i) => {
    try { return parseJapaneseRetrievalCase(JSON.parse(line) as unknown); }
    catch (error) { throw new Error("fixture line " + (i + 1) + ": " + String(error)); }
  });
  if (new Set(cases.map((c) => c.caseId)).size !== cases.length) {
    throw new Error("fixture caseIds must be unique");
  }
  return { datasetId, cases };
};

const grams = (s: string): string[] => {
  const clean = s.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
  return [...clean].length < 2 ? [clean] :
    Array.from({ length: [...clean].length - 1 }, (_, i) => [...clean].slice(i, i + 2).join(""));
};
export const lexicalRank = (query: string, docs: readonly JapaneseRetrievalDocument[]): string[] => {
  const needle = new Set(grams(query));
  return docs.map((doc, index) => {
    const hay = new Set(grams(doc.text));
    const overlap = [...needle].filter((term) => hay.has(term)).length;
    return { id: doc.id, index, score: overlap / Math.max(1, needle.size) };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map((d) => d.id);
};
export const retrievalScoresAt5 = (
  ordered: readonly string[], relevant: readonly string[],
): Pick<RetrievalStageResult, "recallAt5" | "mrrAt5"> => {
  const gold = new Set(relevant);
  const top = ordered.slice(0, 5);
  const hitCount = top.filter((id) => gold.has(id)).length;
  const first = top.findIndex((id) => gold.has(id));
  return { recallAt5: hitCount / gold.size, mrrAt5: first < 0 ? 0 : 1 / (first + 1) };
};
const stage = (ordered: readonly string[], gold: readonly string[], latencyMs: number): RetrievalStageResult =>
  ({ orderedDocIds: ordered, ...retrievalScoresAt5(ordered, gold), latencyMs });
const aggregate = (all: readonly RetrievalCaseEvidence[], kind: "lexical" | "embedding" | "rerank"): RetrievalStageMetrics => {
  const vals = all.map((c) => c[kind]).filter((s): s is RetrievalStageResult => s !== undefined);
  const avg = (key: "recallAt5" | "mrrAt5"): number | null =>
    vals.length ? vals.reduce((sum, v) => sum + v[key], 0) / vals.length : null;
  return {
    cases: vals.length,
    errors: all.length - vals.length,
    coverage: all.length ? vals.length / all.length : 0,
    recallAt5: avg("recallAt5"),
    mrrAt5: avg("mrrAt5"),
    latencyP50Ms: percentile(vals.map((v) => v.latencyMs), 0.5),
    latencyP95Ms: percentile(vals.map((v) => v.latencyMs), 0.95),
  };
};
const failureCategory = (e: unknown): string => e instanceof Error ? e.name : "UnknownError";

export const runJapaneseRetrievalBenchmark = async (
  fixture: JapaneseRetrievalFixture,
  options: { mode: RetrievalMode; provider?: SarashinaRetrievalProvider; runId?: string; now?: () => Date },
): Promise<JapaneseRetrievalEvidence> => {
  if (!fixture.cases.length) throw new Error("empty fixture");
  const { mode, provider } = options;
  if (!["lexical", "embedding", "embedding-rerank"].includes(mode)) {
    throw new Error("invalid benchmark mode");
  }
  if (mode !== "lexical" && !provider) throw new Error("live provider is required");
  const cases: RetrievalCaseEvidence[] = [];
  const cache = new Map<string, readonly number[]>();
  for (const c of fixture.cases) {
    const start = performance.now();
    const lexical = lexicalRank(c.query, c.documents);
    const item: RetrievalCaseEvidence = {
      caseId: c.caseId, taskFamily: c.taskFamily,
      relevantDocIds: c.relevantDocIds,
      lexical: stage(lexical, c.relevantDocIds, performance.now() - start),
    };
    if (mode !== "lexical" && provider) {
      let current: "embedding" | "rerank" = "embedding";
      try {
        const started = performance.now();
        const queryVec = await provider.embed(c.query, "RETRIEVAL_QUERY");
        const scored = [];
        for (let i = 0; i < c.documents.length; i++) {
          const d = c.documents[i];
          if (!d) continue;
          const cacheKey = d.text;
          let vector = cache.get(cacheKey);
          if (!vector) {
            vector = await provider.embed(d.text, "RETRIEVAL_DOCUMENT");
            cache.set(cacheKey, vector);
          }
          scored.push({ id: d.id, index: i, score: cosineSimilarity(queryVec, vector) });
        }
        const embedding = scored.sort((a, b) => b.score - a.score || a.index - b.index).map((x) => x.id);
        item.embedding = stage(embedding, c.relevantDocIds, performance.now() - started);
        if (mode === "embedding-rerank") {
          current = "rerank";
          const startedRerank = performance.now();
          const rankDocs = embedding.map((id) => c.documents.find((d) => d.id === id));
          if (rankDocs.some((d) => !d)) throw new Error("missing rerank document");
          const hits = await provider.rerank(c.query, rankDocs.map((d) => d!.text));
          const reranked = hits.map((hit) => rankDocs[hit.documentIndex]!.id);
          item.rerank = stage(reranked, c.relevantDocIds, performance.now() - startedRerank);
        }
      } catch (e) {
        item.error = { stage: current, category: failureCategory(e) };
      }
    }
    cases.push(item);
  }
  const metrics: JapaneseRetrievalEvidence["metrics"] = { lexical: aggregate(cases, "lexical") };
  if (mode !== "lexical") metrics.embedding = aggregate(cases, "embedding");
  if (mode === "embedding-rerank") metrics.rerank = aggregate(cases, "rerank");
  return {
    schemaVersion: "mso.sarashina-ja-retrieval.v0", datasetId: fixture.datasetId,
    runId: options.runId ?? "sarashina-ja-" + Date.now(),
    completedAt: (options.now?.() ?? new Date()).toISOString(),
    mode, providerId: "sarashina-retrieval",
    sourceRefs: [
      "https://docs.sarashina.ai/api-reference/embeddings",
      "https://docs.sarashina.ai/api-reference/rerank",
    ],
    metrics, cases,
    authority: {
      evidenceOnly: true, automaticProviderRanking: false,
      automaticRoutingDecision: false, runtimeAuthorityManaged: false,
      requiresHumanReview: true,
    },
    ledgerIntegration: "separate_retrieval_evidence",
  };
};
export const writeJapaneseRetrievalEvidence = async (path: string, evidence: JapaneseRetrievalEvidence): Promise<void> => {
  if (evidence.schemaVersion !== "mso.sarashina-ja-retrieval.v0" ||
    !evidence.authority.evidenceOnly || evidence.authority.automaticProviderRanking ||
    evidence.authority.automaticRoutingDecision || evidence.authority.runtimeAuthorityManaged ||
    !evidence.authority.requiresHumanReview) throw new Error("unsafe retrieval evidence authority");
  await mkdir(dirname(path), { recursive: true });
  const temp = path + ".tmp-" + process.pid;
  await writeFile(temp, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  await rename(temp, path);
};
