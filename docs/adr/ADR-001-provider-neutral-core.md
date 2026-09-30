# ADR-001: Provider-neutral core

Status: Accepted
Date: 2026-09-30

## Context

DevDay introduces attractive provider-specific runtime, model, plugin and event capabilities. MADO already defines stable responsibilities across System One, Context, Policy, Harness, Evidence and Verifier.

Binding domain logic directly to one provider would make short-term integration easy but weaken portability and replay.

## Decision

MADO core contracts remain provider-neutral.

Provider-specific behavior enters through adapters, provider profiles or capability registry entries.

Provider APIs may implement or accelerate MADO responsibilities, but may not silently redefine them.

## Consequences

- OpenAI features can be adopted quickly without becoming architectural authority.
- Additional adapter code is accepted as the price of portability.
- Evidence schemas and bounded decision contracts outlive provider changes.
- New provider surfaces should begin in SHADOW where practical.
