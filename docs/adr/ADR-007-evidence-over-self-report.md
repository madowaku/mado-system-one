# ADR-007: Evidence outranks runtime self-report

Status: Accepted
Date: 2026-09-30

## Context

More autonomous runtimes can plan, delegate and report task completion. Existing MADO rules already separate execution from proof.

## Decision

A runtime's completion claim is never sufficient evidence of success.

Task completion requires task-appropriate observations that an independent verifier can inspect or reproduce.

## Consequences

- Managed agents remain Harness implementations, not Verifiers.
- Evidence adapters are required for external runtimes.
- DONE remains a workflow claim until Verification accepts the observed result.
