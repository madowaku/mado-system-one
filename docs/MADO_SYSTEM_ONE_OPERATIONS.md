# MADO_SYSTEM_ONE_OPERATIONS.md

Version: v0.1
Status: Operational baseline
Date: 2026-09-22

## 0. Purpose

Architecture defines what exists.

The Pattern Atlas defines what judgments are made.

Operations defines how a System One decision surface earns trust, becomes active, specializes, and rolls back.

## 1. Lifecycle

~~~
OFF
-> SHADOW
-> CALIBRATING
-> ACTIVE_LIMITED
-> ACTIVE
-> ACTIVE_WITH_ESCALATION
-> SPECIALIZING
-> LOCALIZED
~~~

At every active stage:

- BYPASS
- KILL
- ROLLBACK

must remain available.

## 2. OFF

System One has no influence.

Use for initial rollout, incident recovery, or unsupported environments.

## 3. SHADOW

System One sees the same bounded decision surface but cannot affect execution.

Record:

- would_have_done
- actually_did
- provider
- model
- inference family
- probability semantics
- confidence semantics
- calibration status
- uncertainty
- policy result
- verification result
- latency and cost

Shadow traces are evidence, not labels.

## 4. CALIBRATING

Use representative target-workload traces to set:

- accept thresholds,
- abstain thresholds,
- confirmation thresholds,
- routing thresholds,
- uncertainty bands.

Do not copy thresholds from demos or other providers.

## 5. ACTIVE_LIMITED

Allow System One to influence low-consequence reversible work first.

Good examples:

- choose cached result,
- stop repeated identical retry,
- choose research depth,
- rank files,
- hide restorable context,
- choose model tier.

Do not begin with payment, deletion, permission change, or publication.

## 6. ACTIVE

System One can influence normal reversible workflow control.

Policy remains authoritative for consequential actions.

## 7. ACTIVE_WITH_ESCALATION

Uncertainty may spend more compute.

~~~
cheap decision
-> confident?
   yes: continue
   no: extra read or stronger provider
-> still uncertain?
   yes: planner / verifier / human
~~~

## 8. Kill switch

Every active deployment needs a tested kill path.

Possible controls:

- enabled: false
- environment disable flag
- CLI bypass flag
- runtime administrative control

The kill path must preserve logs and restore a known fallback.

## 9. Bypass

KILL disables System One broadly.

BYPASS skips it for one task, route, or session.

Bypass is useful for debugging, baseline comparison, unsupported domains, and suspicious provider behavior.

## 10. Fail behavior

Explicit fail modes:

- bypass
- fail_closed
- escalate

Use bypass for optional optimization.

Use fail_closed when the System One surface protects a high-impact boundary.

Use escalate when a stronger provider, deterministic check, or human can resolve uncertainty.

## 11. Human control boundary

Confidence is not execution authority.

Suggested human-confirm classes include:

- send
- publish
- pay
- purchase
- delete
- install
- change permission
- expose secret
- external share
- account change

Confirmation should happen close to execution.

## 12. Decision trace

A useful trace records:

- trace id
- pattern
- mode
- observation id
- candidate-set identity
- provider and model
- inference family
- probability semantics
- confidence semantics
- calibration status
- decision
- uncertainty
- policy outcome
- executed action
- verification outcome
- latency and cost

## 13. Promotion criteria

SHADOW to CALIBRATING requires representative traces and known disagreement cases.

CALIBRATING to ACTIVE_LIMITED requires:

- known threshold profile,
- known abstain behavior,
- tested fallback,
- tested kill switch,
- baseline comparison,
- redaction checks.

ACTIVE_LIMITED to ACTIVE requires downstream non-regression and acceptable false-allow / false-drop behavior.

## 14. Rollback

Every promotion has a predefined rollback target.

Rollback first. Analyze second.

Do not hot-fix unsafe calibration during an incident if a known-safe baseline exists.

## 15. Drift

Drift can come from:

- provider update,
- model update,
- prompt or compiler change,
- candidate compiler change,
- task distribution shift,
- UI change,
- specialist staleness.

Monitor:

- confidence distribution,
- abstain rate,
- override rate,
- verification failure,
- false-drop rate,
- routing distribution,
- provider errors.

A drift event can return a surface to SHADOW.

## 16. Replay

Stored traces support offline counterfactual evaluation.

~~~
historical decisions
-> new provider / thresholds
-> replay
-> compare with known outcomes
~~~

Replay is required for safe provider bake-offs.

## 17. SPECIALIZE

SPECIALIZE is an operational lifecycle step, not a Pattern Atlas decision.

Good specialization targets are high-frequency, stable-schema, bounded, repeatable decisions with clear labels.

Avoid specialization first on rare open-ended or safety-critical judgments.

## 18. Training data

Decision logs are not ground truth.

Prefer label sources in this order:

1. deterministic invariant,
2. verified successful outcome,
3. human-reviewed label,
4. oracle fixture,
5. weak model label as auxiliary data only.

Do not train a specialist blindly on old router predictions.

## 19. LOCALIZED stack

Preferred mature stack:

~~~
tiny specialist
-> uncertain: general System One
-> uncertain: Astra / Human
~~~

Localization keeps fallback.

## 20. Privacy

Before cloud inference, classify data sensitivity.

Example policy:

- public: approved cloud or local
- internal: approved provider set
- private: local preferred
- secret: never transmit as model context

Decision traces must not become a secret-leak channel.

## 21. Retry and mutation

Decision inference may be safely retried when read-only.

World mutation must be separately idempotent or confirmed.

Never equate a failed network response with permission to repeat a payment, send, or delete operation.

## 22. Circuit breaker

Repeated provider failures trigger a circuit breaker and fallback according to risk.

System One is an optimization and control layer, not a single point of failure.

## 23. Metrics

Quality:
- decision_accuracy
- downstream_task_success
- verification_failure_rate
- human_override_rate
- false_allow_rate
- false_drop_rate

Efficiency:
- cost_saved
- tokens_avoided
- tool_calls_avoided
- retries_avoided
- latency_saved
- frontier_calls_avoided

Coverage:
- automation_coverage
- abstain_rate
- escalation_rate
- human_confirm_rate

Reliability:
- provider_error_rate
- timeout_rate
- fallback_rate
- kill_switch_activations
- rollback_count

## 24. Incident response

~~~
1. KILL or BYPASS
2. preserve logs
3. restore known baseline
4. identify affected traces
5. classify failure
6. reproduce offline
7. fix code / provider / calibration
8. return to SHADOW
9. promote again
~~~

## 25. Chaos tests

Test:

- provider timeout,
- provider error,
- invalid JSON,
- malformed probabilities,
- equal candidates,
- missing candidates,
- stale observation,
- network loss,
- secret redaction,
- kill switch,
- fallback provider,
- human confirmation path.

Operational safety should be tested as deliberately as model quality.

## 26. North Star

Trust is not global.

Trust is scoped to a decision surface, provider, workload, mode, threshold profile, fallback, authority boundary, and evidence trail.

It is measured, reversible, and earned.
