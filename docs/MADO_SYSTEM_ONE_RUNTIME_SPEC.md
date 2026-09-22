# MADO_SYSTEM_ONE_RUNTIME_SPEC.md

Version: v0.1
Status: implementation bootstrap
Date: 2026-09-22

## Purpose

MADO System One Runtime connects the existing bounded-decision, Context, Policy,
Harness, Evidence, and Verification planes into one resumable execution loop.

The v0.1 target is deliberately narrow:

~~~text
Intent
  -> Outcome Compiler
  -> Outcome Contract + Capability Requirements
  -> Capability Pager
  -> Runtime capability references
  -> Planned Actions
  -> Policy Gate
  -> Tool Adapter
  -> Evidence
  -> Verification
  -> Completed / Failed / Requires Action
~~~

## Core invariants

1. No side effect bypasses Policy.
2. Confidence never creates authority.
3. Tool success is not task success.
4. Completion requires explicit evidence requirements to be satisfied.
5. REQUIRES_ACTION is a normal resumable state, not a failure.
6. Tool-specific details stay behind adapters.
7. Runtime state is explicit and inspectable.
8. Capability routing remains advisory and never grants execution authority.
9. NONE stays unresolved. The Pager must not invent an executable target.
10. Only selected capability details are paged into the Runtime surface.
11. Outcome compilation defines what must be true, not which concrete tool must win.
12. The Outcome Compiler must not produce executable actions or grant authority.

## Current implementation slice

v0.1 currently includes:

- RuntimeRun and OutcomeContract types
- explicit ActionRecord and ApprovalRecord
- AUTO / ASK / DENY PolicyGate
- ToolAdapter boundary
- evidence requirement linkage
- independent deterministic verifier
- resumable ASK fixture
- evidence-failure fixture
- Capability Pager bridge over CapabilityRegistry / CapabilityResolver
- multi-requirement capability routing with deduplication
- unresolved NONE preservation
- Outcome Compiler adapter boundary
- contract validation before routing
- Intent -> Outcome Contract + Capability Requirements fixture
- Outcome Compiler -> Capability Pager integration fixture

The fixtures are intentionally deterministic and do not require a live external
model. Later Astra/Codex/Jev adapters must preserve these contracts rather than
bypass them.

## Runtime M0 smoke acceptance

The fixture passes only when:

- the same run moves through execution,
- every action is policy-evaluated,
- tool adapters emit evidence,
- all required evidence is present,
- verification marks success.

A successful command with missing evidence must fail verification.

## Runtime M0.2 Capability Pager bridge

The existing CapabilityResolver remains a bounded advisory router. The Runtime
adds a Pager above it instead of turning routing confidence into authority.

~~~text
Outcome capability requirements
  -> one bounded ROUTE problem per requirement
  -> wide short catalog
  -> top-K deep fit
  -> selected capability
  -> page selected descriptor only
  -> deduplicate selections
  -> RuntimeCapabilityRef[]
~~~

A Runtime task may need several capabilities, while the existing resolver
returns one recommendation per bounded routing request. The Pager bridges that
shape mismatch by resolving several explicit capability requirements.

If the resolver returns NONE, the requirement is recorded as unresolved. The
Pager does not silently choose an alternative.

Alternatives remain advisory metadata. They are not automatically paged as
required capabilities and they do not receive execution authority.

## Runtime M0.3 Outcome Compiler

The Outcome Compiler translates a human Intent into a bounded contract for the
rest of the Runtime.

~~~text
human intent
  -> Outcome Compiler Adapter
  -> Outcome Contract
     - goal
     - deliverables
     - required evidence
     - constraints
     - completion criteria
  -> Capability Requirements
     - natural-language capability need
     - reason
  -> Capability Pager
~~~

The Compiler does not choose concrete capability IDs. A request such as
"inspect project state" remains a natural-language capability requirement until
the M0.2 Pager resolves it against the observed Capability Registry.

The Compiler also does not emit executable actions. Action planning remains a
later boundary, and Policy remains the authority boundary.

Before a compiled contract enters the Runtime, deterministic validation rejects:

- blank goals or descriptions
- missing deliverables
- missing evidence requirements
- missing completion criteria
- duplicate deliverable IDs
- duplicate evidence requirement IDs
- duplicate completion criterion IDs
- duplicate capability requirement IDs
- blank capability requests or reasons

This keeps evidence mapping and later replay unambiguous.

### Adapter boundary

M0.3 introduces OutcomeCompilerAdapter rather than binding Runtime Core to a
specific model SDK.

A future Astra, Codex, Jev, local model, or deterministic compiler can implement
the same adapter contract.

The first fixture uses a deterministic adapter so the contract itself is the
test oracle.

## Next slices

### Runtime M0.4 Evidence Bundle persistence

Persist run.json, actions, approvals, evidence, verification, and a summary
under a run-scoped workspace.

### Runtime M0.5 Typed Action Loop

Allow the bounded Decision Plane to choose the next observed action candidate
without granting execution authority.

### Runtime M0.6 Learning Compiler

Produce provenance-linked memory, skill patch, capability note, or none
candidates after verified runs.

## Non-goals for v0.1

- autonomous swarms
- scheduler / heartbeat
- vector database
- self-modifying skills
- multi-provider routing
- UI
- cloud queueing

The goal is a small runtime heart that can survive larger models and larger
tool catalogs without surrendering policy or verification boundaries.
