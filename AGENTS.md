# AGENTS.md

## Project mission

Build MADO's reusable System One layer: fast, typed, bounded decisions and task-aware context control around deeper reasoning agents.

## Stable responsibility split

- System One: route, compute, rank, gate, act, score, abstain, sieve, walk, verify
- Context Plane: decide what information reaches expensive reasoning
- State Plane: preserve explicit observed state and freshness
- Astra / Codex: reason, plan, generate
- Policy: allow, confirm, deny
- Harness: execute
- Evidence: observe and record
- Verifier: prove or reject outcomes

## Non-negotiable rules

1. Prefer observed finite candidates over generated executable targets.
2. Always provide NONE / ABSTAIN / ESCALATE where the candidate set may be incomplete.
3. Never treat confidence as authorization.
4. Never treat DONE as proof of success.
5. Keep Policy and independent Verification outside learned decision authority.
6. Record provider inference family, probability semantics, confidence semantics, and calibration status.
7. Wire compatibility does not imply probability or quality compatibility.
8. Do not copy thresholds across providers or task families without evaluation.
9. Provider quality is pattern-specific. Do not infer GATE quality from SIEVE quality or vice versa.
10. Mandatory context bypasses learned filtering.
11. Hide context only when it is recoverable; otherwise retain conservatively.
12. New providers and major decision surfaces should begin in SHADOW where practical.
13. Active deployments need a tested BYPASS / KILL / ROLLBACK path.
14. Decision traces are potential training data, not automatic ground truth.
15. Contract validity, semantic quality, calibration, and operational safety are separate eval layers.

## Implementation order

Follow the roadmap in README.

Current priorities:

1. preserve stable provider contracts,
2. build deterministic Mock / Replay fixtures,
3. connect live providers behind adapters,
4. evaluate providers per pattern,
5. keep context reductions reversible and evidence-backed.

## Repository shape

Keep architecture, pattern catalog, operations, Context Plane, implementations, evals, examples, and reusable Skills in this repository until there is a strong reason to split them.
