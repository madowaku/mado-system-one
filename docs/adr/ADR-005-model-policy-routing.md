# ADR-005: Model selection is operational policy

Status: Accepted
Date: 2026-09-30

## Context

New model tiers change the cost/capability frontier. Hard-coding a newly attractive model into workflows would couple domain behavior to pricing and model churn.

## Decision

Model selection is resolved by Model Policy from task requirements, consequence, modality, cost, latency and escalation state.

Domain code must not depend on a specific model identifier unless the model itself is the subject of an evaluation fixture.

## Consequences

- GPT-6.1 Sol can be evaluated aggressively without becoming an implicit permanent dependency.
- Astra-class models remain available as escalation.
- Cheaper bounded providers can handle appropriate tasks.
- Every selected provider/model should be recorded in decision/evidence traces.
