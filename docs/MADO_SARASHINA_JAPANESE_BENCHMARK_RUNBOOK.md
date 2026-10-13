# MSO-DM-M0.5 Sarashina Provider Contract / Japanese Intelligence Benchmark

Status: offline implementation; live provider verification requires an API key.
Date: 2026-10-13

## Boundary and integration

M0.5 adds a task-specialized retrieval capability, not another SystemOneProvider. Sarashina3 rerank scores are **uncalibrated ranking signals**, not probabilities, confidence, or authorization. Never import them into DecisionResponse / CalibrationProfile or copy thresholds to a policy gate.

- Provider: src/providers/sarashina.ts
- Benchmark/evidence: src/eval/sarashina-ja.ts
- CLI: src/eval/sarashina-cli.ts
- Fixtures: fixtures/dm/sarashina-ja.example.jsonl
- Tests: test/sarashina-provider.test.ts and test/sarashina-ja.test.ts

The M0.3 Provider Evidence Ledger and M0.4 Suitability Context Pack are for typed decision questions. M0.5 writes a separate retrieval-evidence document with schemaVersion mso.sarashina-ja-retrieval.v0 and explicitly leaves runtime authority unchanged.

## Transport contract

Embeddings POST https://api.sarashina.ai/v1/embeddings
- model = sarashina3-embedding
- input is ONE string; task_type required
- RETRIEVAL_QUERY for queries; RETRIEVAL_DOCUMENT for documents
- Response: data[0].embedding, 1536 floats; not unit-normalized, use cosine.

Rerank POST https://api.sarashina.ai/v1/rerank
- model = sarashina3-rerank
- query string, documents array of 1..20 strings, task_type
- CUSTOMIZE needs query_instruction
- Response: data[0].result[] with document_id (0-based index) and score
- score is NOT a calibrated probability.

Authorization: Bearer via SARASHINA_API_KEY. Limits: 60 RPM for each retrieval model. Client serializes requests and waits >=1100ms between requests per model; on 429 it backs off 65s and retries once. HTTP errors redact response bodies; evidence does not include raw text, prompts or credentials.

Sources:
- https://docs.sarashina.ai/api-reference/embeddings
- https://docs.sarashina.ai/api-reference/rerank
- https://docs.sarashina.ai/rate-limits

## Offline run (no API key needed)

    npm test
    npm run sarashina:ja -- fixtures/dm/sarashina-ja.example.jsonl --dataset mso-ja-game-v0 --out evidence/dm/ja-lexical.json

Lexical baseline uses NFKC character bigrams, stable input-order ties. This is a smoke baseline, not a production Japanese retrieval reference.

## Explicit live opt-in

Create an API key at https://sarashina.ai. During free beta, inputs may be used for improvements. Run only public/synthetic fixtures unless privacy and terms are cleared.

    export SARASHINA_API_KEY="..." 
    npm run sarashina:ja -- fixtures/dm/sarashina-ja.example.jsonl --dataset mso-ja-game-v0 --mode embedding-rerank --live --out evidence/dm/ja-live.json

PowerShell: $env:SARASHINA_API_KEY="...".

Remote modes (embedding or embedding-rerank) require --live and an API key. The key alone never starts a remote request.

## Evaluation meaning

For every labeled Japanese query:
1. lexical baseline ranking;
2. embed query with RETRIEVAL_QUERY and documents with RETRIEVAL_DOCUMENT; cosine order;
3. rerank the same embedding-ranked candidate set, maximum 20.

Records Recall@5, MRR@5, P50/P95 stage latency, failures, coverage and ordered document IDs. Errors are typed but not dumped. Means exclude failed cases and are null when there is no successful result. Always compare coverage and slices before claiming gains.

The evidence authority flags are:
- evidenceOnly = true
- automaticProviderRanking = false
- automaticRoutingDecision = false
- runtimeAuthorityManaged = false
- requiresHumanReview = true

## Follow-up gates

M0.5: unit/build/offline smoke. Live testing only after consent and key setup.
M0.5.1: >=50 reviewed Japanese test queries, independent baseline, corpus-scale candidate recall, per-task statistics, confidence intervals, and duplicate/leakage checks.
M0.5.2: mini/nano, guard, translate with separate response semantics and policy boundaries.

Note: These synthetic 8-document queries validate the harness and are too small to establish production-grade search quality. They do not measure recall on larger corpora.
