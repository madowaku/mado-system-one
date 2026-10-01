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
- **MSO-LAYA-M0.4** Real Shadow Bridge
- **MAF-M0.0** Multi-Agent Forge schema fixture ✅
- **MAF-M0.1** Deterministic Forge workflow runner

## Guiding rules

> Choose observed candidates. Do not invent executable targets.  
> Confidence is not authority. Decision is not verification.  
> Context reduction is not deletion.

## Status

The project has moved from a single decision layer toward a provider-aware decision + context plane architecture. Interfaces and thresholds remain experimental until validated on MADO workloads.
