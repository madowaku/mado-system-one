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

## Guiding rules

> Choose observed candidates. Do not invent executable targets.  
> Confidence is not authority. Decision is not verification.  
> Context reduction is not deletion.

## Status

The project has moved from a single decision layer toward a provider-aware decision + context plane architecture. Interfaces and thresholds remain experimental until validated on MADO workloads.
