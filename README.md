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
- docs/MADO_LAYA_DRIFT_GUARD_RUNBOOK.md — rolling active-limited drift detection and incumbent-only AUTO HOLD
- docs/MADO_LAYA_HOLD_RECOVERY_RUNBOOK.md — typed HOLD diagnosis, requalification evidence, and new-session restart
- docs/MADO_LAYA_REBASELINE_RUNBOOK.md — workload-drift baseline candidate, recovery canary chain, and new drift baseline materialization
- docs/MADO_LAYA_BASELINE_LINEAGE_RUNBOOK.md — append-only distribution epochs and checkpoint-to-world bindings

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

## Active-Limited Drift / Auto-Hold Guard

MSO-LAYA-M1.0 keeps watching a checkpoint after it reaches limited_active.

The guard uses an accepted M0.9 canary workload as its baseline and compares a mature rolling window against explicit per-surface thresholds:

~~~text
candidate error rate
incumbent error rate
fallback rate
disagreement rate
p95 latency ratio
mean candidate confidence delta
~~~

Build a drift policy from accepted canary evidence:

~~~bash
npm run mso -- drift-plan \
  --activation-policy evidence/canary/asset-qa-v2-active.policy.json \
  --baseline-policy evidence/canary/asset-qa-v2-canary-25.policy.json \
  --baseline-traces evidence/canary/asset-qa-v2-canary-25.jsonl \
  --policy-id asset-qa-v2-active-drift \
  --window-size 200 \
  --min-selected 100 \
  --min-comparable 100 \
  --min-confidence-samples 100 \
  --max-candidate-error 0.02 \
  --max-incumbent-error 0.02 \
  --max-fallback 0.02 \
  --max-disagreement 0.08 \
  --max-latency-ratio 2 \
  --max-confidence-delta 0.15 \
  --out evidence/drift/asset-qa-v2.policy.json
~~~

The live guard shares the M0.9 authority switch with CanaryActivationProvider and observes completed traces through traceObserver. Before minimum evidence exists, drift status is blocked rather than actionable. Severe direct provider faults remain the M0.9 circuit breaker's job.

When a mature window fails a drift check, the guard performs AUTO HOLD:

~~~text
candidate authority
      ↓
AUTO HOLD
      ↓
incumbent-only
~~~

AUTO HOLD records kind=auto_hold and fallbackReason=auto_hold. It does not mutate checkpoint lineage, revoke promotion, or execute rollback.

Canary comparisons now carry candidate/incumbent confidence samples, and session summaries expose mean confidence so M1.0 can detect both confidence collapse and unexpected over-confidence relative to the accepted workload.

Offline replay uses the same evaluator:

~~~bash
npm run mso -- drift-evaluate \
  --activation-policy evidence/canary/asset-qa-v2-active.policy.json \
  --drift-policy evidence/drift/asset-qa-v2.policy.json \
  --traces evidence/canary/asset-qa-v2-active.jsonl \
  --out evidence/drift/asset-qa-v2.window.json
~~~

Every drift artifact keeps automaticHold=true and automaticRollback=false. Recovery requires diagnosis and a new reviewed activation session rather than silently clearing the old hold.

## Hold Recovery / Requalification Gate

MSO-LAYA-M1.1 makes AUTO HOLD recoverable without reopening the held activation session.

~~~text
AUTO HOLD
   |
diagnose
   |
provider/calibration issue ----> repair + replay PASS ----> new canary_1
workload drift ----------------> rebaseline
checkpoint regression ---------> new checkpoint lineage
unknown -----------------------> diagnosis continues
~~~

The old activation session is never cleared in place. A successful same-checkpoint requalification emits a new M0.9 policy with a distinct policy id and stage canary_1.

Run the gate with:

~~~bash
npm run mso -- hold-requalify \
  --registry evidence/lineage/asset-qa.json \
  --activation-policy evidence/canary/asset-qa-v2-active.policy.json \
  --drift-policy evidence/drift/asset-qa-v2.policy.json \
  --hold evidence/drift/asset-qa-v2.hold.json \
  --recovery evidence/recovery/asset-qa-v2-recovery.json \
  --recovery-traces evidence/recovery/asset-qa-v2-replay.jsonl \
  --new-policy-id asset-qa-v2-restart-001 \
  --out-dir evidence/recovery/asset-qa-v2-requalification
~~~

Same-checkpoint requalification is limited to provider_regression and calibration_drift. It requires operator review, an approval reference, diagnosis evidence, repair evidence, verification evidence, and a passing post-repair M1.0 drift window.

workload_drift returns requires_rebaseline. checkpoint_regression returns requires_new_checkpoint. unknown returns diagnosis_required.

Before issuing a restart policy, the gate rechecks the current M0.8 lineage: the held artifact must still be the promoted head with the same fingerprint and a currently known-good rollback target. The restart policy is pinned to the current lineage hash, so legitimate audit events during the HOLD do not force reuse of a stale activation hash.

A passing result records:

~~~text
eligible_for_new_canary
restartStage = canary_1
automaticReactivation = false
automaticRollback = false
oldSessionReusable = false
~~~

Blocked results write requalification.json only. restart.policy.json exists only after the gate passes.

## Rebaseline / Recovery Canary Evidence Bridge

MSO-LAYA-M1.2 handles the M1.1 workload_drift branch without pretending the old workload is still authoritative.

~~~text
old accepted baseline
      |
changed workload sample
      |
reviewed rebaseline candidate
      |
canary_1 -> canary_5 -> canary_25
      |
reviewed acceptance
      |
new limited_active policy
      |
new M1.0 drift baseline
~~~

The initial candidate records old/new operational metrics and descriptive deltas, but never overwrites the historical baseline:

~~~text
oldBaselineReplaced = false
automaticActivation = false
~~~

Build the candidate with rebaseline-plan. It requires workload_drift classification, operator-reviewed distribution evidence, adequate sample coverage, bounded provider/fallback error, bounded latency, the same promoted checkpoint fingerprint, and a known-good rollback target.

A passing candidate emits recovery-canary.policy.json at canary_1 only.

Acceptance is stricter. rebaseline-accept requires the complete recovery chain:

~~~text
canary_1  + PASS advance
canary_5  + PASS advance
canary_25 + PASS advance to limited_active
~~~

All policies must share checkpoint, provider, decision-surface, and lineage identities. Skipping a stage is rejected.

The accepted canary_25 summary becomes the new M1.0 baseline. The candidate sample itself does not.

On reviewed acceptance, M1.2 materializes:

~~~text
rebaseline.acceptance.json
limited-active.policy.json
drift.policy.json
~~~

The generated limited-active policy is still not started automatically. Historical baseline artifacts remain immutable evidence.

## Baseline Lineage / Distribution Epoch Registry

MSO-LAYA-M1.3 gives accepted workload baselines an append-only lineage independent from checkpoint ancestry.

~~~text
Checkpoint lineage:  which model generation?
Baseline lineage:    which workload world?
~~~

Together they form a two-axis evidence map:

~~~text
                 Epoch 001   Epoch 002
checkpoint-v2       ●           ●
checkpoint-v3       ●
~~~

Epoch changes and checkpoint changes are separate events. A new model generation can bind to the current workload epoch without creating a new epoch. A new workload epoch can keep the same checkpoint.

Initialize:

~~~bash
npm run mso -- baseline-lineage-init \
  --registry evidence/baseline/asset-qa.json \
  --registry-id asset-qa-distribution-lineage \
  --surface asset.qa
~~~

Seed the current accepted workload:

~~~bash
npm run mso -- baseline-register-initial \
  --registry evidence/baseline/asset-qa.json \
  --checkpoint-registry evidence/lineage/asset-qa.json \
  --activation-policy evidence/canary/asset-qa-active.policy.json \
  --drift-policy evidence/drift/asset-qa.policy.json \
  --epoch-id epoch-001 \
  --distribution-summary "Initial accepted asset QA workload" \
  --source-evidence-ref evidence/drift/asset-qa.policy.json \
  --binding-evidence-ref activation:asset-qa-active
~~~

After M1.2 accepts a workload rebaseline, register a new epoch with baseline-register-rebaseline. The previous epoch becomes superseded but remains immutable history.

If only the checkpoint changes while the workload distribution stays the same, use baseline-bind-checkpoint instead. The checkpoint-specific drift policy may have a new id, but its baseline metrics must match the current epoch.

The registry is SHA-256 hash chained, writer locked, atomic on write, and always records runtimeAuthorityManaged=false. Derived state exposes currentEpochId, epoch ancestry, all checkpoint bindings, and checkpointEpochMatrix.

## Decision Model Provider Matrix / Clef Intake

MSO-DM-M0.0 generalizes the provider layer beyond the Laya growth track.

Cloudflare Clef and Clef-flash now sit behind the same `SystemOneProvider` contract used by existing eval, comparison, Disagreement Lab, Shadow Bridge, and Promotion Gate flows. The first intake deliberately exposes text only even though the upstream Clef models are multimodal. Vision requires a separate reviewed media bridge and workload-specific evidence before it becomes a MADO adapter capability.

The machine-readable registry lives in `src/providers/matrix.ts`, while `src/providers/clef.ts` provides an injectable System One adapter plus a Cloudflare Workers AI REST transport.

~~~bash
export CLOUDFLARE_ACCOUNT_ID=<account>
export CLOUDFLARE_AUTH_TOKEN=<token>

npm run mso -- eval fixtures/eval/smoke.jsonl --provider clef-flash

npm run mso -- compare fixtures/eval/smoke.jsonl \
  --providers replay,laya,clef-flash \
  --out evidence/compare/replay-laya-clef-flash.json
~~~

Clef, Clef-flash, Laya, and future Jev adapters do not share thresholds merely because their wire shapes are similar. Probability semantics, confidence semantics, calibration, pattern suitability, latency, and operational evidence remain provider-by-task artifacts.

See `docs/MADO_DECISION_MODEL_PROVIDER_MATRIX.md`.

## Cross-Provider Calibration / Shadow Bake-off

MSO-DM-M0.1 converts the provider bake-off into an explicit SHADOW-entry gate.

It runs the same labeled fixture across multiple providers, then records accuracy, provider errors, latency, cost, pairwise disagreement, calibration coverage, Brier score, 10-bin ECE, reliability bins, and slices by pattern / task family / question type.

Calibration keeps its provenance. Choice questions use the probability of the selected option, noul uses the probability of the predicted yes/no side, and score uses provider-reported confidence only.

~~~bash
npm run mso -- dm-bakeoff fixtures/eval/smoke.jsonl \
  --providers replay,laya,clef-flash \
  --incumbent replay \
  --policy fixtures/dm/shadow-bakeoff.example-policy.json \
  --out evidence/dm/smoke-bakeoff.json
~~~

A provider ends as `reference_incumbent`, `eligible_for_shadow`, `blocked`, or `insufficient_evidence`.

Passing M0.1 does not activate anything. Every artifact records `automaticSelection=false`, `runtimeAuthorityChange=false`, and emits only a non-authoritative shadow plan for passing candidates.

See `docs/MADO_DECISION_MODEL_BAKEOFF_RUNBOOK.md`.

## Multi-Shadow Session / Shared Evidence

MSO-DM-M0.2 lets one incumbent request be observed by multiple Decision Model providers without re-running the incumbent.

~~~text
request
  |
  +--> incumbent --------------------> authoritative response
  |
  +--> Laya -------------------------+
  +--> Clef-flash -------------------+--> one mso.multi-shadow.v0 session
  +--> Clef -------------------------+        |
                                          one review row
                                          candidate pair traces
~~~

`MultiShadowSession` starts all observers concurrently but returns as soon as the incumbent completes. Shadow latency, disagreement, and provider failure never replace or delay the authoritative decision.

Each shared session embeds one compatible `mso.shadow.v0` pair trace per candidate. A candidate-specific stream for the existing Promotion Gate can be materialized with:

~~~bash
npm run mso -- multi-shadow-extract \
  --sessions evidence/multi-shadow/sessions.jsonl \
  --provider clef-flash \
  --out evidence/shadow/clef-flash.jsonl
~~~

For a single candidate, the original `ShadowBridge` remains the simpler primitive.

See `docs/MADO_MULTI_SHADOW_SESSION_RUNBOOK.md`.

## Provider Evidence Ledger / Longitudinal Decision Memory

MSO-DM-M0.3 gives each decision surface an append-only memory of how providers actually behaved over time.

It compacts M0.2 sessions into provider observations without copying raw prompt/state text, then joins later `mso.review.v0` labels back onto the observed questions.

~~~text
shared sessions
   |
   +--> latency / errors / cost
   +--> agreement / disagreement
   +--> confidence evidence
   +--> pattern + task-family slices
   |
human reviews
   |
   v
Provider Evidence Ledger
   |
   +--> disagreement clusters
   +--> reviewed accuracy
   +--> event timeline
   +--> per-provider history
~~~

The ledger is SHA-256 hash chained, writer locked, atomically replaced on mutation, rejects duplicate sessions/reviews, and rejects review labels with no matching shadow observation.

~~~bash
npm run mso -- provider-ledger-init \
  --ledger evidence/provider-ledger/asset-qa.json \
  --ledger-id asset-qa-provider-memory \
  --surface asset.qa

npm run mso -- provider-ledger-ingest-sessions \
  --ledger evidence/provider-ledger/asset-qa.json \
  --sessions evidence/multi-shadow/sessions.jsonl \
  --source-ref multi-shadow:asset-qa:2026-10-03

npm run mso -- provider-ledger-show \
  --ledger evidence/provider-ledger/asset-qa.json \
  --provider clef-flash
~~~

Every derived state records `runtimeAuthorityManaged=false` and `automaticRoutingDecision=false`. The ledger remembers evidence; it does not pick a winner.

See `docs/MADO_PROVIDER_EVIDENCE_LEDGER_RUNBOOK.md`.

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
- **MSO-LAYA-M1.0** Active-Limited Drift / Auto-Hold Guard ✅
- **MSO-LAYA-M1.1** Hold Recovery / Requalification Gate ✅
- **MSO-LAYA-M1.2** Rebaseline / Recovery Canary Evidence Bridge ✅
- **MSO-LAYA-M1.3** Baseline Lineage / Distribution Epoch Registry ✅
- **MSO-LAYA-M1.4** Checkpoint × Epoch Compatibility / Replay Gate
- **MSO-DM-M0.0** Decision Model Provider Matrix / Clef Intake ✅
- **MSO-DM-M0.1** Cross-Provider Calibration / Shadow Bake-off ✅
- **MSO-DM-M0.2** Multi-Shadow Session / Shared Evidence ✅
- **MSO-DM-M0.3** Provider Evidence Ledger / Longitudinal Decision Memory ✅
- **MSO-DM-M0.4** Provider Evidence Retrieval / Suitability Context Pack
- **MAF-M0.0** Multi-Agent Forge schema fixture ✅
- **MAF-M0.1** Deterministic Forge workflow runner

## Guiding rules

> Choose observed candidates. Do not invent executable targets.  
> Confidence is not authority. Decision is not verification.  
> Context reduction is not deletion.

## Status

The project has moved from a single decision layer toward a provider-aware decision + context plane architecture. Interfaces and thresholds remain experimental until validated on MADO workloads.
