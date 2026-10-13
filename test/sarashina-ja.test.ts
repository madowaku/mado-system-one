import assert from "node:assert/strict";
import test from "node:test";
import {
  lexicalRank, parseJapaneseRetrievalCase, retrievalScoresAt5,
  runJapaneseRetrievalBenchmark, type JapaneseRetrievalFixture,
} from "../src/eval/sarashina-ja.js";
import type { SarashinaRetrievalProvider } from "../src/providers/sarashina.js";

const fixture: JapaneseRetrievalFixture = {
  datasetId: "synthetic-ja",
  cases: [{
    caseId: "asset-license", taskFamily: "game.assets",
    query: "素材のライセンス",
    documents: [
      { id: "irrelevant", text: "ゲームエンジンのレンダリング性能" },
      { id: "relevant", text: "素材の商用利用ライセンスとクレジット表記" },
      { id: "other", text: "AIモデルのパラメータ" },
    ],
    relevantDocIds: ["relevant"],
  }],
};
const makeProvider = (rerankError = false): SarashinaRetrievalProvider => ({
  id: "sarashina-retrieval",
  async embed(text, task) {
    assert.ok(task === "RETRIEVAL_QUERY" || task === "RETRIEVAL_DOCUMENT");
    return text.includes("ライセンス") ? [1, 0] : [0, 1];
  },
  async rerank(_query, docs) {
    if (rerankError) throw new Error("SECRET DOCUMENT INTERNAL ERROR");
    return docs.map((text, index) => ({
      documentIndex: index,
      score: text.includes("ライセンス") ? 0.99 : 0.01,
    })).sort((a, b) => b.score - a.score);
  },
});
test("fixture rejects missing gold docs and duplicate IDs", () => {
  assert.throws(() => parseJapaneseRetrievalCase({
    ...fixture.cases[0], relevantDocIds: ["not-found"],
  }), /gold document ID/);
  assert.throws(() => parseJapaneseRetrievalCase({
    ...fixture.cases[0],
    documents: [{ id: "same", text: "a" }, { id: "same", text: "b" }],
  }), /gold document ID/);
});
test("lexical baseline and @5 metrics are deterministic", () => {
  assert.deepEqual(lexicalRank("素材", fixture.cases[0]!.documents).slice(0, 1), ["relevant"]);
  assert.deepEqual(retrievalScoresAt5(["x","y","relevant"], ["relevant"]), {
    recallAt5: 1, mrrAt5: 1/3,
  });
  assert.deepEqual(retrievalScoresAt5(["x","y"], ["relevant"]), {
    recallAt5: 0, mrrAt5: 0,
  });
});
test("offline never calls provider and carries evidence-only authority", async () => {
  const evidence = await runJapaneseRetrievalBenchmark(fixture, { mode: "lexical", now: () => new Date("2026-10-13T00:00:00Z") });
  assert.equal(evidence.schemaVersion, "mso.sarashina-ja-retrieval.v0");
  assert.equal(evidence.metrics.lexical.coverage, 1);
  assert.equal(evidence.metrics.embedding, undefined);
  assert.equal(evidence.authority.automaticRoutingDecision, false);
  assert.equal(evidence.authority.runtimeAuthorityManaged, false);
  assert.equal(evidence.ledgerIntegration, "separate_retrieval_evidence");
  assert.ok(!JSON.stringify(evidence).includes("商用利用"));
});
test("embedding and rerank use provider signals without claiming calibrated confidence", async () => {
  const evidence = await runJapaneseRetrievalBenchmark(fixture, {
    mode: "embedding-rerank", provider: makeProvider(),
  });
  assert.equal(evidence.metrics.embedding?.coverage, 1);
  assert.equal(evidence.metrics.embedding?.recallAt5, 1);
  assert.equal(evidence.metrics.rerank?.mrrAt5, 1);
  assert.deepEqual(evidence.cases[0]?.rerank?.orderedDocIds[0], "relevant");
  assert.ok(!JSON.stringify(evidence).includes("score\":0.99"));
});
test("rerank errors do not mask embedding results or leak exception text", async () => {
  const evidence = await runJapaneseRetrievalBenchmark(fixture, {
    mode: "embedding-rerank", provider: makeProvider(true),
  });
  assert.equal(evidence.metrics.embedding?.coverage, 1);
  assert.equal(evidence.metrics.rerank?.coverage, 0);
  assert.equal(evidence.metrics.rerank?.mrrAt5, null);
  assert.equal(evidence.cases[0]?.error?.stage, "rerank");
  assert.equal(evidence.cases[0]?.error?.category, "Error");
  assert.ok(!JSON.stringify(evidence).includes("SECRET DOCUMENT"));
});
test("live retrieval requires injected provider", async () => {
  await assert.rejects(runJapaneseRetrievalBenchmark(fixture, { mode: "embedding" }), /provider is required/);
});
