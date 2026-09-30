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
- docs/MADO_DEV_DAY_2026_ADOPTION_SPEC.md — DevDay 2026 capability adoption lanes, adapter boundaries, ADRs, and milestones
- docs/devday-2026/MDD26-M0.2_EVENT_SPINE.md — normalized events, dedupe/idempotency, Policy gate, Verification, and MCP Events adapter
- docs/devday-2026/MDD26-M0.3_AGENTS_HARNESS_SPIKE.md — read-only Agents API harness, multi-agent audit, recovery evidence, and bake-off gate

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
- **MAF-M0.0** Multi-Agent Forge schema fixture ✅
- **MAF-M0.1** Deterministic Forge workflow runner
- **MDD26-M0.0** DevDay 2026 adoption baseline ✅
- **MDD26-M0.1** Plugin Release Contract ✅
- **MDD26-M0.2** Event Spine ✅ ✅

## Guiding rules

> Choose observed candidates. Do not invent executable targets.  
> Confidence is not authority. Decision is not verification.  
> Context reduction is not deletion.

## Status

The project has moved from a single decision layer toward a provider-aware decision + context plane architecture. Interfaces and thresholds remain experimental until validated on MADO workloads.


## Event Spine

MDD26-M0.2 adds a provider-neutral event path:

```
event -> dedupe ledger -> Policy -> task -> Harness -> Verifier -> Evidence
```

Ingress fixtures currently include manual events, polling fallback, and an MCP Events normalization adapter. Automatic duplicate replay is suppressed before execution.


## Agents Harness Spike

MDD26-M0.3 adds an OpenAI Agents API Harness adapter for a deliberately read-only repository audit.

- environment: `none`
- tools: none
- bounded multi-agent: up to 3 concurrent subagents
- repo access: only a selected text snapshot supplied as input
- runtime completion: never treated as MADO Verification
- recovery: retrieve session, root items, subagents, and subagent items after streaming

Run a live spike only when API credentials and a model choice are explicitly available:

```bash
OPENAI_API_KEY=... MADO_AGENTS_MODEL=... npm run agents:spike:live
```

CI validates the adapter and deterministic fixtures. A live run is still required before M0.3 can be promoted as an evidence-backed runtime decision.
