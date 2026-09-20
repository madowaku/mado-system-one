# AGENTS.md

## Project mission

Build MADO's reusable System One layer: fast, typed, bounded decisions around deeper reasoning agents.

## Stable responsibility split

- System One: route, compute, rank, gate, act, score, abstain, sieve, walk, verify
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
5. Keep Policy and Independent Verification outside learned decision authority.
6. Record probability semantics: direct_logits, sampled_agreement, generated_probability, heuristic, or unknown.
7. Do not copy thresholds across providers or task families without calibration.
8. New providers and major decision surfaces should begin in SHADOW where practical.
9. Active deployments need a tested BYPASS / KILL / ROLLBACK path.
10. Decision traces are potential training data, not automatic ground truth.

## Implementation order

Follow the M0 roadmap in README. Start with M0.0 contracts and a deterministic Mock/Replay provider before live provider integration.

## Repository shape

Keep architecture, pattern catalog, operations, implementations, evals, examples, and the reusable Skill in this repository until there is a strong reason to split them.
