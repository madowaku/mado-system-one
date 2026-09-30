# ADR-004: Bounded decisions are explicit contracts

Status: Accepted
Date: 2026-09-30

## Context

DevDay introduces a Decisions API aimed at finite answer spaces. MADO System One already treats finite candidate decisions as a core primitive.

## Decision

Bounded decision surfaces are defined independently from any model or Decisions API.

Decision contracts must include valid outcomes such as NONE, ABSTAIN or ESCALATE whenever the observed candidate set may be incomplete or uncertainty is operationally meaningful.

## Consequences

- Deterministic rules, SystemOneProvider, structured LLM output and Decisions API can be evaluated against the same contract.
- Provider substitution does not change workflow semantics.
- High-consequence false PASS behavior remains an explicit evaluation concern.
