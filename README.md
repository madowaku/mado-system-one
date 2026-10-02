# mado-system-one

MADO System One is the bounded-decision and context-control layer for MADO.

~~~
System One   = route / compute / rank / gate / act / score / abstain / sieve / walk / verify
Context      = compile what the reasoner should see
Astra/Codex  = reason / plan / generate
Policy       = allow / confirm / deny
Harness      = execute
Evidence     = observe / record
Verifier     = prove
~~~

## Core documents

- docs/MADO_SYSTEM_ONE_ARCHITECTURE.md — v0.3 architecture, provider semantics, planes, lifecycle
- docs/MADO_SYSTEM_ONE_PATTERN_ATLAS.md — reusable bounded-decision patterns
- docs/MADO_SYSTEM_ONE_OPERATIONS.md — shadow rollout, calibration, activation, rollback, specialization
- docs/MADO_SYSTEM_ONE_CONTEXT_PLANE_SPEC.md — query-aware context compilation and reversible SIEVE
- docs/MADO_MULTI_AGENT_FORGE_SPEC.md — contract-first multi-agent production, ownership, independent review, falsification, and human override
- docs/MADO_LAYA_FINETUNE_RUNBOOK.md — reviewed disagreement → soft-target candidate pack → held-out validation loop
- docs/MADO_LAYA_REEVAL_RUNBOOK.md — checkpoint export → hold-out re-eval → regression slices → Promotion Gate re-entry
- docs/MADO_LAYA_LINEAGE_RUNBOOK.md — checkpoint ancestry, promotion evidence, rollback safety, and rollback recording
- docs/MADO_LAYA_CANARY_RUNBOOK.md — staged runtime authority, circuit-breaker fallback, stage evidence, and rollback drill

## v0.3 shape

~~~
State Plane
   ↓
Context Plane ──────→ task-specific context
   ↓
Decision Plane ─────→ route / compute / gate / act
   ↓
Harness
   ↓
Evidence Plane
~~~

Capability discovery uses progressive disclosure:

~~~
wide short catalog
→ top-K
→ deep schema
→ absolute fit
~~~

## Provider semantics

MADO does not treat API compatibility as semantic compatibility.

Every provider profile records:

- inference family
- specialization level
- probability semantics
- confidence semantics
- calibration status
- pattern-specific support evidence

A threshold from one provider is not automatically valid for another.

## Operational lifecycle

~~~
OFF
 ↓
SHADOW
 ↓
CALIBRATING
 ↓
ACTIVE_LIMITED
 ↓
ACTIVE
 ↓
ACTIVE_WITH_ESCALATION
 ↓
SPECIALIZING
 ↓
LOCALIZED
~~~

Every active deployment retains BYPASS / KILL / ROLLBACK. High-impact irreversible actions remain outside learned decision authority.

## Eval skeleton

MSO-LAYA-M0.0 adds a provider-neutral evaluation spine.

~~~
JSONL fixture
  ↓
SystemOneProvider
  ↓
typed response validation
  ↓
correctness + latency + cost metrics
  ↓
evidence JSON
~~~

Run the deterministic smoke fixture with:

~~~
npm run eval:smoke
~~~

The replay provider exists to test the harness itself before live providers are attached. Provider failures are captured per case so one bad decision does not destroy the whole evaluation run.

## Laya adapter

MSO-LAYA-M0.1 maps the existing MADO provider contract to Laya's TypeScript runtime.

The adapter keeps Laya optional so ordinary installs and CI do not pull model runtime dependencies. For a live local eval, install the peer explicitly:

~~~
npm install laya-ts
npm run mso -- eval fixtures/eval/smoke.jsonl --provider laya
~~~

Optional routing controls:

~~~
npm run mso -- eval fixtures/eval/smoke.jsonl   --provider laya   --model english   --lang en
~~~

Important semantics:

- MADO `choice.confidence` receives Laya `answer_confidence`, not Laya's entropy-based `confidence`.
- Laya local inference is recorded as estimated API cost `0`.
- MADO score ranges are translated to Laya's zero-based score levels and mapped back after inference.
- Non-integer MADO score bounds are rejected by the adapter rather than silently distorted.
- Laya remains experimental until MADO workload calibration and shadow evidence justify promotion.

## Multi-provider comparison

MSO-LAYA-M0.2 runs the same fixture through multiple providers and writes one comparison bundle.

~~~bash
npm run mso -- compare fixtures/eval/smoke.jsonl \
  --providers replay,laya \
  --out evidence/compare/replay-vs-laya.json
~~~

The comparison intentionally keeps **agreement** separate from **correctness**. For every provider pair it records:

- comparable questions, agreements, disagreements, and agreement rate
- both-correct / left-only-correct / right-only-correct / both-wrong counts
- numeric answer deltas for `noul` and `score`
- confidence deltas when both providers expose confidence
- the full underlying eval runs in the same evidence bundle

`score` agreement defaults to an absolute tolerance of `0.5` and can be changed with `--score-tolerance`.

The runner is provider-array based rather than hard-coded to two engines, so a future command can be:

~~~bash
mso compare fixture.jsonl --providers replay,laya,jev
~~~

without changing the comparison schema.

## Disagreement Lab

MSO-LAYA-M0.3 turns comparison mismatches into a human-review queue.

~~~bash
npm run mso -- disagreements fixtures/eval/smoke.jsonl \
  --providers replay,laya \
  --pair replay:laya \
  --focus laya \
  --high-confidence 0.8
~~~

The lab writes two artifacts:

- a compact summary JSON with priority/category/slice counts
- a JSONL review queue with one disagreement per line

Each review row restores the original fixture context:

- state, typed question, expected answer
- task family, tags, and language
- both provider answers and confidences
- pairwise correctness/agreement metadata
- review priority and category
- a conservative `fineTuneCandidate` flag that still requires human review

Priority is intentionally asymmetric around the selected `--focus` provider:

- **P0**: focus provider error, or focus provider is wrong with high confidence while the other provider is correct
- **P1**: focus provider is wrong, or both providers are wrong
- **P2**: the other provider is wrong or unavailable while focus is usable
- **P3**: both are correct but disagree under the stricter comparison tolerance

`both_wrong` is routed to ground-truth review rather than training by default. Agreement is evidence, not authority.

## Real Shadow Bridge

MSO-LAYA-M0.4 runs an incumbent provider and a shadow provider on the same live `DecisionRequest`, while keeping the incumbent authoritative.

~~~ts
const sink = new PartitionedShadowEvidenceSink({
  tracePath: "evidence/shadow/live.jsonl",
  reviewQueuePath: "evidence/shadow/review.jsonl",
});

const provider = new ShadowBridge({
  incumbent: currentProvider,
  shadow: layaProvider,
  sink,
  capture: "minimal",
});

const response = await provider.decide(request);
// response is always the incumbent response.
// Laya cannot replace it, even if the incumbent fails.

await provider.flush(); // shutdown/test boundary
~~~

Operational invariants:

- the incumbent response is returned without waiting for shadow inference or evidence writes
- shadow output never becomes execution authority
- shadow provider failure does not fail the incumbent request
- incumbent failure is never replaced by a successful shadow answer
- every trace is explicitly marked `labelsKnown: false`
- disagreements become `human_label_required`, not automatic training labels
- provider failures become `provider_error_review`
- `flush()` drains in-flight observations at shutdown or deterministic test boundaries

Evidence capture defaults to `minimal`: trace id, pattern, question ids, and bounded identifiers only. State, questions, and free-form metadata are excluded by default. Use `capture: "full"` only with an appropriate `redactRequest` function when live context must enter the evidence trail.

A partitioned sink writes:

~~~text
evidence/shadow/live.jsonl    # every shadow trace
evidence/shadow/review.jsonl  # disagreements / provider failures only
~~~

This is intentionally different from offline eval. Live shadow traffic has no oracle label, so the bridge records agreement, confidence deltas, answer deltas, latency, and failures without pretending to know which provider is correct.

## Promotion Gate

MSO-LAYA-M0.5 turns offline eval, real shadow traces, reviewed disagreements, and operational controls into an explicit promotion-eligibility artifact.

~~~bash
npm run mso -- promotion-check \
  --policy fixtures/promotion/asset-qa-laya.example-policy.json \
  --eval evidence/eval/laya-asset-qa.json \
  --shadow evidence/shadow/live.jsonl \
  --reviews evidence/shadow/reviews-reviewed.jsonl \
  --controls fixtures/promotion/asset-qa-laya.example-controls.json \
  --out evidence/promotion/asset-qa-laya-gate.json
~~~

The gate evaluates three transitions without changing runtime state:

~~~text
experimental -> shadow
shadow       -> candidate
candidate    -> promoted
~~~

The evidence contains the maximum eligible stage, every individual check, measured values, required thresholds, and blocking reasons. It always records `automaticPromotion: false`.

The stages use different evidence:

- **experimental -> shadow**: labeled offline cases, accuracy, and provider error rate
- **shadow -> candidate**: live exposure, comparable-question coverage, agreement, provider errors, high-confidence disagreement rate, disagreement review coverage, and optional latency budgets
- **candidate -> promoted**: verified disagreement labels plus fallback, kill-switch, redaction, threshold-profile, and rollback attestations

Raw live agreement is never treated as correctness. A candidate can reach `candidate` with strong shadow stability, but it cannot become promotion-eligible without reviewed/verified labels and operational controls.

Promotion policy thresholds are explicit per decision surface. There are no built-in universal Laya thresholds. The files under `fixtures/promotion/` are examples for schema and workflow only, not production defaults.

## Fine-tune Candidate

MSO-LAYA-M0.6 converts reviewed Disagreement Lab records into a provenance-bearing Laya RLCD candidate pack.

~~~bash
npm run mso -- finetune-pack \
  --queue evidence/disagreements/<lab>.jsonl \
  --annotations evidence/finetune/annotations.jsonl \
  --out-dir evidence/finetune/<pack> \
  --validation-fraction 0.2 \
  --split-seed mso-laya-2026-10
~~~

The output contains:

~~~text
manifest.json
train.jsonl
validation.jsonl
held.jsonl
~~~

Training-ready rows use Laya's `{state, questions, gold}` case schema. MADO choice options are mapped to Laya criteria, noul targets use `false/true` probabilities, and score targets are mapped to Laya's zero-based levels.

The gate into `train.jsonl` is deliberately strict:

- source disagreement must already be marked `fineTuneCandidate: true`
- an explicit include annotation is required
- reviewed hard label, label source, and review time are required
- an RLCD soft target is required
- soft-target provenance `sourceRef` is required
- the soft target argmax must agree with the reviewed hard label

A reviewed hard label without a soft target is preserved in `held.jsonl` as `missing_soft_target`; it is never silently converted into a one-hot target.

Splitting is deterministic, grouped by `caseId`, and stratified by task family. Questions from the same state cannot land on opposite sides of train/validation. The generated `validation.jsonl` is not training input.

The current Laya trainer owns a separate calibration slice inside the training set. MADO therefore keeps validation fully untouched for post-training evaluation. Fine-tuning creates a new candidate checkpoint; it does not inherit the previous checkpoint's promotion status.

## Candidate Re-eval Loop

MSO-LAYA-M0.7 evaluates a fine-tuned candidate against its base checkpoint on the untouched M0.6 validation split.

The Python fine-tune output must first be materialized to the ONNX form consumed by `laya-ts`:

~~~bash
python laya-ts/scripts/export_onnx.py \
  --model-dir <candidate-pytorch-checkpoint> \
  --out-dir <candidate-onnx-checkpoint>
~~~

Then run:

~~~bash
npm run mso -- candidate-reeval \
  --validation evidence/finetune/<pack>/validation.jsonl \
  --base-checkpoint <base-onnx-checkpoint> \
  --candidate-checkpoint <candidate-onnx-checkpoint> \
  --model english \
  --out-dir evidence/reeval/<candidate>
~~~

M0.7 restores the original MADO evaluation contract from `_mado.evaluation`, fingerprints both ONNX checkpoints with SHA-256, and runs the same labeled holdout through both providers.

The output bundle contains:

~~~text
summary.json
validation.eval.jsonl
base.eval.json
candidate.eval.json
incumbent.eval.json       # optional
regressions.jsonl
~~~

The summary reports aggregate accuracy/case-accuracy/error/latency deltas plus confidence coverage, Brier score, 10-bin ECE, and regression slices across task family, question type, language, and tags.

Aggregate improvement does not erase local regression. `regressions.jsonl` records questions where the base was correct and the candidate became wrong or unavailable.

`candidate.eval.json` is the labeled offline artifact intended to re-enter MSO-LAYA-M0.5 Promotion Gate. A fine-tuned checkpoint inherits no previous promotion status.

M0.6 packs created before this milestone do not contain the re-evaluation metadata. Regenerate the fine-tune pack before using M0.7.

## Checkpoint Lineage / Rollback Registry

MSO-LAYA-M0.8 records checkpoint generations as a hash-chained event ledger.

~~~text
base-v1 [known good]
  |
  +-- candidate-v2
        |
        +-- candidate-v3
~~~

The registry is scoped to one decision surface and explicitly records:

~~~text
runtimeAuthorityManaged: false
~~~

It tracks artifact fingerprints, parent/child ancestry, promotion evidence references, rollback-safety attestations, and recorded rollback executions without changing production routing.

Initialize and seed a registry:

~~~bash
npm run mso -- lineage-init \
  --registry evidence/lineage/asset-qa.json \
  --registry-id asset-qa-laya \
  --surface asset.qa

npm run mso -- lineage-register \
  --registry evidence/lineage/asset-qa.json \
  --checkpoint-id base-v1 \
  --checkpoint-dir checkpoints/base-v1 \
  --origin base \
  --known-good \
  --known-good-ref production-baseline-approval:asset.qa:v1
~~~

Registering a fine-tuned child can bind it to M0.7 re-evaluation evidence. The candidate fingerprint must match the re-eval candidate, and the re-eval base fingerprint must match the registered parent.

Promotion recording requires an M0.5 gate that is actually `eligible_for_promotion`, matching M0.7 evidence, a known-good rollback ancestor, and the current lineage head as the candidate's parent.

Rollback safety can be attested or revoked later with `lineage-set-rollback-safety`. This lets a promoted generation become the known-good rollback parent for the next generation without rewriting history.

Rollback is deliberately two-phase:

~~~text
rollback-plan
  ↓
operator/runtime performs actual checkpoint switch
  ↓
lineage-record-rollback --execution-ref ...
~~~

Plans are non-executing and pin the current registry event-chain hash. If any event is added after planning, the stale plan is rejected.

The ledger protects common local races with an exclusive writer lock and atomic replacement. Each event carries `prevEventHash` and `eventHash`; editing historical event contents breaks verification.

Lifecycle state distinguishes `promoted` from `restored`, so incident recovery is not misreported as a fresh promotion.

## Canary Activation / Rollback Drill

MSO-LAYA-M0.9 turns a promoted lineage head into bounded runtime authority gradually:

~~~text
off
 -> canary_1
 -> canary_5
 -> canary_25
 -> limited_active
~~~

Traffic assignment is deterministic from policy id + trace id. The same request does not bounce randomly between providers during retry/replay.

A candidate can receive authority only when the request is explicitly marked for the matching decision surface and attests:

~~~text
canaryEligible = true
reversible     = true
impactClass    = low
~~~

Consequential risk tags such as payment, delete, publish, permission change, secret exposure, external sharing, or account change keep the request on the incumbent.

Build a lineage-pinned plan:

~~~bash
npm run mso -- canary-plan \
  --registry evidence/lineage/asset-qa.json \
  --policy-id asset-qa-v2-canary-1 \
  --candidate-provider laya-candidate-v2 \
  --incumbent-provider current-incumbent \
  --stage canary_1 \
  --patterns gate,score \
  --max-consecutive-errors 2 \
  --min-error-rate-attempts 20 \
  --max-error-rate 0.05 \
  --out evidence/canary/asset-qa-v2-canary-1.policy.json
~~~

The policy pins the exact candidate checkpoint fingerprint, promotion gate, rollback target, and M0.8 lineage head hash. Any later registry mutation makes the old policy stale.

For selected traffic, candidate and incumbent run concurrently. A successful candidate can return authority while the incumbent remains observer/fallback. Candidate failure returns the already-running incumbent and feeds a one-way circuit breaker. Once KILL trips, later requests are incumbent-only.

Canary traces keep live labels unknown and record route bucket, eligibility, returned authority, fallback, provider errors, comparison coverage, disagreement, and kill state.

Stage advancement is evidence-only:

~~~bash
npm run mso -- canary-evaluate \
  --policy evidence/canary/asset-qa-v2-canary-1.policy.json \
  --traces evidence/canary/asset-qa-v2-canary-1.jsonl \
  --advance-policy fixtures/canary/asset-qa.example-advance-policy.json \
  --out evidence/canary/asset-qa-v2-canary-1.advance.json
~~~

The stage gate requires enough candidate traffic and comparable questions, healthy candidate and incumbent error rates, bounded fallback/disagreement, optional latency budget, and zero kill-switch trips. It always records automaticStageAdvance=false.

The synthetic escape-hatch drill is:

~~~bash
npm run mso -- canary-drill \
  --registry evidence/lineage/asset-qa.json \
  --out-dir evidence/drills/asset-qa-v2
~~~

It injects a candidate failure, verifies incumbent fallback, trips KILL, verifies later incumbent-only routing, blocks stage advance, creates a rollback plan, and records a simulated rollback only in a cloned registry. The production registry and external runtime authority are not mutated by the drill.

limited_active means 100% of the explicitly eligible bounded surface, not global learned authority.

## Roadmap

- **M0.0** Core contracts ✅
- **M0.1** Capability Router fixture ✅
- **v0.3** Provider semantics hardening ✅
- **v0.3** Reversible Context Sieve fixture ✅
- **M0.2** TypeSafe Jev provider
- **M0.3** Replay provider
- **M0.4** Policy gate
- **M0.5** Typed Action Loop smoke fixture
- **M0.6** Pattern-aware provider bake-off
- **M0.7** Context Sieve eval pack
- **M0.8** Structured Read experimental provider
- **M0.9** Multimodal typed-decision spike
- **MSO-LAYA-M0.0** Provider-neutral Eval Skeleton ✅
- **MSO-LAYA-M0.1** Laya Adapter ✅
- **MSO-LAYA-M0.2** Replay vs Laya Tri-Runner ✅
- **MSO-LAYA-M0.3** Disagreement Lab ✅
- **MSO-LAYA-M0.4** Real Shadow Bridge ✅
- **MSO-LAYA-M0.5** Promotion Gate ✅
- **MSO-LAYA-M0.6** Fine-tune Candidate ✅
- **MSO-LAYA-M0.7** Candidate Re-eval Loop ✅
- **MSO-LAYA-M0.8** Checkpoint Lineage / Rollback Registry ✅
- **MSO-LAYA-M0.9** Canary Activation / Rollback Drill ✅
- **MSO-LAYA-M1.0** Active-Limited Drift / Auto-Hold Guard
- **MAF-M0.0** Multi-Agent Forge schema fixture ✅
- **MAF-M0.1** Deterministic Forge workflow runner

## Guiding rules

> Choose observed candidates. Do not invent executable targets.  
> Confidence is not authority. Decision is not verification.  
> Context reduction is not deletion.

## Status

The project has moved from a single decision layer toward a provider-aware decision + context plane architecture. Interfaces and thresholds remain experimental until validated on MADO workloads.
