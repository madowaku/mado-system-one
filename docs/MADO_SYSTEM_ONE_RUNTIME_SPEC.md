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
  -> Outcome Contract
  -> Capability references
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

## Current implementation slice

v0.1 M0 introduces:

- RuntimeRun and OutcomeContract types
- explicit ActionRecord and ApprovalRecord
- AUTO / ASK / DENY PolicyGate
- ToolAdapter boundary
- evidence requirement linkage
- independent deterministic verifier
- resumable ASK fixture
- evidence-failure fixture

The initial fixture is intentionally deterministic and does not require a live
model or external service. Later model-backed planning must preserve these
contracts rather than bypass them.

## M0 smoke acceptance

The fixture passes only when:

- the same run moves through execution,
- every action is policy-evaluated,
- tool adapters emit evidence,
- all required evidence is present,
- verification marks success.

A successful command with missing evidence must fail verification.

## Next slices

### M0.2 Capability Pager bridge

Map the existing CapabilityRegistry / CapabilityResolver output into
RuntimeCapabilityRef while keeping progressive disclosure.

### M0.3 Outcome Compiler

Add a structured model adapter that compiles an Intent into an OutcomeContract.
The deterministic contract remains the test oracle.

### M0.4 Evidence Bundle persistence

Persist run.json, actions, approvals, evidence, verification, and a summary
under a run-scoped workspace.

### M0.5 Typed Action Loop

Allow the bounded Decision Plane to choose the next observed action candidate
without granting execution authority.

### M0.6 Learning Compiler

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
