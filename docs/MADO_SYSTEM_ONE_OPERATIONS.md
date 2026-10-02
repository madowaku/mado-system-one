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

Implementation invariant for the runtime bridge:

- the incumbent provider remains authoritative,
- shadow inference must not delay the incumbent response,
- shadow failure must not fail the incumbent request,
- incumbent failure must not be replaced by a shadow answer,
- live traces record `labelsKnown: false`,
- disagreement review requires a human or verified downstream outcome before becoming ground truth,
- full live input capture requires explicit redaction; minimal capture is the default.

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

For learned-provider canary activation, M0.9 narrows ACTIVE_LIMITED further:

- rollout stages are off -> 1% -> 5% -> 25% -> limited active,
- stage assignment is deterministic per policy and trace,
- every canary policy is pinned to the current checkpoint lineage head hash,
- any lineage mutation invalidates the old activation policy,
- request metadata must explicitly attest matching decision surface, canary eligibility, reversibility, and low impact,
- payment, purchase, delete, publish, permission-change, secret-exposure, external-share, and account-change risk tags are excluded,
- selected canary traffic runs incumbent in parallel as observer and fallback,
- candidate provider failure falls back to incumbent,
- a one-way circuit breaker can KILL candidate authority for the activation session,
- stage advancement is evidence-only and never automatic,
- a kill-switch trip prevents stage advancement,
- stage evidence must include enough candidate requests and comparable questions, candidate and incumbent reliability, fallback rate, disagreement, and optional latency budget.

limited_active means all explicitly eligible traffic on one bounded surface. It does not imply global provider authority.

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

Promotion is evidence-driven and scoped to one decision surface.

The MSO promotion gate uses the following evidence ladder:

~~~text
experimental
  -> shadow
  -> candidate
  -> promoted
~~~

This ladder is an evaluation/adoption state and does not itself mutate the runtime SystemOneMode.

**experimental -> shadow** requires labeled offline evidence that meets the decision-surface policy for:

- minimum case count,
- minimum accuracy,
- maximum provider error rate.

**shadow -> candidate** requires representative live shadow evidence that meets the policy for:

- minimum shadow traces,
- minimum comparable questions,
- agreement floor,
- provider error ceiling,
- high-confidence disagreement ceiling,
- disagreement review coverage,
- optional latency and shadow-lag budgets.

Agreement is a stability signal only. Live shadow traces record `labelsKnown: false`.

**candidate -> promoted** additionally requires:

- enough reviewed or verified disagreement labels,
- acceptable candidate accuracy on those reviewed disagreement cases,
- tested fallback,
- tested kill switch,
- checked redaction path,
- attached threshold profile,
- recorded rollback target.

A passing gate emits eligibility evidence only. It must record `automaticPromotion: false` and must not silently change provider authority.

Thresholds are defined per decision surface. There is no universal provider-wide promotion threshold.

The runtime lifecycle still maps separately:

- SHADOW to CALIBRATING requires representative traces and known disagreement cases.
- CALIBRATING to ACTIVE_LIMITED requires a known threshold profile, known abstain behavior, tested fallback, tested kill switch, baseline comparison, and redaction checks.
- ACTIVE_LIMITED to ACTIVE requires downstream non-regression and acceptable false-allow / false-drop behavior.

## 14. Rollback

Every promotion has a predefined rollback target.

Rollback first. Analyze second.

Do not hot-fix unsafe calibration during an incident if a known-safe baseline exists.

For Laya checkpoint generations, the lineage registry adds these invariants:

- checkpoint identity is the M0.7 artifact fingerprint, not a directory or model nickname,
- rollback targets must be registered known-good ancestors,
- known-good status carries an evidence reference and can later be revoked,
- once a lineage head exists, a promoted candidate must be its direct child,
- rollback planning does not change runtime authority,
- a rollback plan pins the current registry event-chain hash and becomes stale after any registry mutation,
- completed rollback is recorded only after an external execution reference exists,
- rollback restoration is recorded as restored, not as a new promotion,
- registry events are hash-chained and local writers are serialized.

The checkpoint lineage registry is an evidence ledger. It is not the runtime deployment controller.

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

For a Laya limited-active surface, the M1.0 drift guard adds a rolling operational window over completed M0.9 traces.

The accepted canary workload is the baseline. The guard must not invent a global confidence baseline.

A mature window checks:

- candidate provider error rate,
- incumbent provider error rate,
- candidate-to-incumbent fallback rate,
- disagreement rate as a stability signal,
- p95 candidate/incumbent latency ratio,
- absolute movement in mean candidate confidence relative to accepted canary evidence.

The rolling window has explicit minimum evidence requirements for candidate-authority requests, comparable questions, and candidate confidence samples.

Before those minimums are satisfied, drift status is BLOCKED and must not trigger a drift HOLD. Immediate provider failure remains the M0.9 circuit-breaker path.

A failed mature window triggers AUTO HOLD:

~~~text
limited-active candidate authority
  -> auto_hold
  -> incumbent-only
~~~

AUTO HOLD is an authority change inside the activation session. It does not mutate checkpoint lineage and does not automatically roll back a checkpoint.

The authority switch records whether it was triggered as kill or auto_hold. A held session is one-way and must not silently reset itself.

Recovery from AUTO HOLD requires preserving traces, diagnosis, offline replay/re-evaluation as needed, and a new reviewed activation session.

M1.1 formalizes the recovery junction:

- provider_regression and calibration_drift may requalify the same checkpoint only after operator review, explicit approval evidence, repair evidence, verification evidence, and a passing post-repair drift replay,
- workload_drift must route to a reviewed replacement baseline rather than treating the old baseline as still authoritative,
- checkpoint_regression must route through a new checkpoint lineage rather than reopening the held artifact,
- unknown diagnosis remains held,
- the original activation session and AUTO HOLD are never cleared in place,
- a passing same-checkpoint requalification creates a distinct canary_1 policy,
- requalification is eligibility evidence only and never automatic runtime reactivation,
- current lineage state is rechecked before issuing a restart policy: same promoted checkpoint fingerprint, current recorded head, and known-good rollback target,
- the new restart policy is pinned to the current lineage event-chain hash.

Older canary evidence that lacks candidate confidence telemetry is insufficient for a confidence-drift baseline. Do not synthesize missing confidence values.

A drift event can ultimately return a surface to SHADOW, but M1.0 first removes candidate authority with HOLD so diagnosis can distinguish workload drift from checkpoint failure.

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

For Laya fine-tune candidate packs:

- a reviewed hard label and a soft training target are separate evidence,
- hard labels must not be silently converted into one-hot targets,
- soft-target provenance must identify the source run or verified outcome,
- target argmax must agree with the reviewed label before training eligibility,
- train/validation splitting is grouped by case identity to prevent state leakage,
- validation evidence remains untouched by training and calibration,
- a fine-tuned checkpoint re-enters evaluation as a new candidate and inherits no promotion status,
- the exact base and candidate checkpoint artifacts are fingerprinted before re-evaluation,
- post-training evaluation uses an untouched holdout and reports slice regressions, not only aggregate gains,
- a candidate eval artifact may re-enter Promotion Gate only under a candidate-specific policy identity.

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
- auto_hold_activations
- drift_window_failures
- rollback_count

## 24. Incident response

~~~
1. KILL, AUTO HOLD, or BYPASS
2. preserve logs
3. identify affected traces
4. classify failure
5. reproduce offline
6. fix code / provider / calibration or route to rebaseline/new checkpoint
7. run requalification gate
8. if same-checkpoint recovery passes, start a new canary_1 session
9. if checkpoint state changed, return through re-eval / promotion / lineage
10. only use rollback when checkpoint-generation state actually needs to change

When checkpoint rollback is involved:

- generate a rollback plan against the current lineage head,
- switch runtime authority through the operational control plane,
- preserve the external change/incident reference,
- record the completed rollback in the lineage registry,
- revoke rollback-safety status for any checkpoint no longer considered a safe fallback.
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

For HOLD recovery, test at least these branches:

- reviewed provider regression with passing replay creates a new canary_1 policy,
- calibration drift without passing replay remains held,
- workload drift cannot direct-resume and routes to rebaseline,
- checkpoint regression cannot direct-resume and routes to a new checkpoint,
- unknown diagnosis cannot reopen candidate authority,
- an audit-only lineage mutation can be re-pinned when the same promoted artifact and rollback safety remain valid,
- a changed lineage head or changed checkpoint fingerprint blocks same-checkpoint requalification,
- blocked requalification does not emit a restart policy.

For canary rollout, the mandatory rollback drill injects a synthetic candidate failure and verifies:

- candidate failure returns the incumbent,
- the circuit breaker trips KILL,
- later requests stay incumbent-only,
- the stage gate holds instead of advancing,
- a rollback plan targets a known-good lineage ancestor,
- simulated rollback restores the cloned registry only,
- production registry and external runtime authority remain unchanged by the drill.

## 26. North Star

Trust is not global.

Trust is scoped to a decision surface, provider, workload, mode, threshold profile, fallback, authority boundary, and evidence trail.

It is measured, reversible, and earned.
