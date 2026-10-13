import assert from "node:assert/strict";
import test from "node:test";
import {
  cosineSimilarity, SarashinaApiProvider, SarashinaContractError, SarashinaHttpError,
} from "../src/providers/sarashina.js";

const vector = Array.from({ length: 1536 }, (_, i) => i === 0 ? 2 : 0);
test("Sarashina embedding maps task_type and parses exactly 1536 floats", async () => {
  let seen: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://api.sarashina.ai/v1/embeddings");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-secret");
    seen = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ data: [{ index: 0, object: "embedding", embedding: vector }] });
  };
  const p = new SarashinaApiProvider({ apiKey: "fixture-secret", fetchImpl, minIntervalMs: 0 });
  assert.deepEqual(await p.embed("こんにちは", "RETRIEVAL_QUERY"), vector);
  assert.deepEqual(seen, {
    model: "sarashina3-embedding", input: "こんにちは", task_type: "RETRIEVAL_QUERY",
  });
});

test("Sarashina rerank reads nested result, sorts and preserves input indices", async () => {
  const p = new SarashinaApiProvider({
    apiKey: "test", minIntervalMs: 0,
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.model, "sarashina3-rerank");
      assert.equal(body.task_type, "CUSTOMIZE");
      assert.equal(body.query_instruction, "技術資料を優先");
      return Response.json({
        data: [{ index: 0, result: [
          { document_id: 0, score: 0.1 },
          { document_id: 2, score: 0.8 },
          { document_id: 1, score: 0.7 },
        ] }],
      });
    },
  });
  assert.deepEqual(await p.rerank("検索", ["A", "B", "C"], "CUSTOMIZE", "技術資料を優先"), [
    { documentIndex: 2, score: 0.8 },
    { documentIndex: 1, score: 0.7 },
    { documentIndex: 0, score: 0.1 },
  ]);
});

test("Sarashina rejects malformed, duplicate and out-of-range scores", async () => {
  const p = new SarashinaApiProvider({
    apiKey: "test", minIntervalMs: 0,
    fetchImpl: async () => Response.json({ data: [{
      result: [{ document_id: 0, score: 0.9 }, { document_id: 0, score: 1.1 }],
    }] }),
  });
  await assert.rejects(p.rerank("質問", ["a", "b"]), SarashinaContractError);
  await assert.rejects(p.embed("質問", "RETRIEVAL_QUERY"), SarashinaContractError);
  await assert.rejects(p.rerank("質問", ["a"], "CUSTOMIZE"), /requires query_instruction/);
  await assert.rejects(p.rerank("質問", Array(21).fill("doc")), /1..20/);
});

test("HTTP errors redact body and credentials, fail after opted-out retry", async () => {
  const p = new SarashinaApiProvider({
    apiKey: "secret-never-print", minIntervalMs: 0, maxRetries: 0,
    fetchImpl: async () => new Response("sensitive-data", { status: 429 }),
  });
  await assert.rejects(p.embed("data", "RETRIEVAL_QUERY"), (e: unknown) => {
    assert.ok(e instanceof SarashinaHttpError);
    assert.equal(e.status, 429);
    assert.doesNotMatch(e.message, /secret|sensitive/);
    return true;
  });
});

test("cosine similarity normalizes unequal magnitudes and rejects zero vectors", () => {
  assert.equal(cosineSimilarity([2, 0], [0.25, 0]), 1);
  assert.equal(cosineSimilarity([0, 2], [2, 0]), 0);
  assert.throws(() => cosineSimilarity([0, 0], [1, 1]), /zero-norm/);
  assert.throws(() => cosineSimilarity([1, 2], [1]), /dimensions differ/);
});
