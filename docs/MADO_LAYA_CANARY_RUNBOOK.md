# MADO Laya Canary Activation / Rollback Drill Runbook

Version: v0.1
Status: Canary activation baseline
Date: 2026-10-02

## Purpose

MSO-LAYA-M0.9 moves a promoted Laya checkpoint into bounded runtime authority gradually.

The rollout ladder is:

~~~text
off
 -> canary_1
 -> canary_5
 -> canary_25
 -> limited_active
~~~

Traffic fractions are fixed by stage:

~~~text
off            0%
canary_1       1%
canary_5       5%
canary_25      25%
limited_active 100% of the explicitly eligible bounded surface
~~~

A stage change is never automatic.

## 1. Preconditions

Canary planning starts from an M0.8 lineage registry whose recorded head is a promoted checkpoint.

The registry must still show:

- candidate fingerprint matching the promoted checkpoint,
- promotion gate identity,
- known-good rollback ancestor,
- current event-chain head hash.

A canary policy pins that event-chain hash.

Any later lineage mutation makes the old policy stale.

## 2. Create a canary policy

~~~bash
npm run mso -- canary-plan \
  --registry evidence/lineage/asset-qa.json \
  --policy-id asset-qa-v2-canary-1 \
  --candidate-provider laya-candidate-v2 \
  --incumbent-provider current-incumbent \
  --stage canary_1 \
  --patterns gate,score \
  --max-consecutive-errors 2 \
  --min-error-rate-attempts 20 \
  --max-error-rate 0.05 \
  --out evidence/canary/asset-qa-v2-canary-1.policy.json
~~~

The circuit-breaker values are explicit per decision surface.

Do not copy them blindly from another workload.

## 3. Explicit request eligibility

A request can reach candidate authority only when all of the following are true:

- request pattern is allowed by policy,
- metadata.decisionSurface matches the policy surface,
- metadata.canaryEligible is true,
- metadata.reversible is true,
- metadata.impactClass is low,
- request risk tags do not include a blocked consequential class.

Blocked risk tags include:

- payment
- purchase
- delete
- publish
- permission_change
- secret_exposure
- external_share
- account_change

Requests missing any required attestation stay on the incumbent.

This is true even at limited_active.

## 4. Deterministic traffic assignment

Eligible requests are bucketed from:

~~~text
SHA-256(policyId + traceId)
~~~

The same trace under the same policy receives the same bucket.

This avoids random routing changes during retries or replay.

## 5. Runtime authority behavior

For a selected canary request:

~~~text
request
  |
  +-- candidate --------> possible returned authority
  |
  +-- incumbent --------> observer + fallback
~~~

Both providers run concurrently.

If candidate succeeds and the kill switch is still clear, the candidate response can be returned.

If candidate fails, the request falls back to the already-running incumbent.

If KILL becomes active before candidate return, the incumbent is returned instead.

For non-selected or out-of-scope traffic, only the incumbent runs.

## 6. Circuit breaker

M0.9 can trip KILL on:

- too many consecutive candidate errors,
- candidate error rate above the configured ceiling after the configured minimum attempts.

KILL is one-way for the lifetime of that canary provider instance.

Do not silently reset a tripped canary.

Create a new reviewed activation session instead.

After KILL, candidate inference is not invoked for later requests.

## 7. Canary evidence

Each trace records:

- policy and session identity,
- stage and traffic fraction,
- deterministic bucket,
- eligibility and rejection reasons,
- kill-switch state at start and return,
- circuit-breaker counters,
- selected authority,
- returned authority,
- fallback reason,
- incumbent/candidate provider snapshots,
- comparison coverage and agreement.

Live canary traces record labelsKnown=false.

Incumbent agreement is a stability signal, not proof of correctness.

## 8. Evaluate a stage

Use a decision-surface-specific advance policy.

An example schema is available at:

~~~text
fixtures/canary/asset-qa.example-advance-policy.json
~~~

Evaluate:

~~~bash
npm run mso -- canary-evaluate \
  --policy evidence/canary/asset-qa-v2-canary-1.policy.json \
  --traces evidence/canary/asset-qa-v2-canary-1.jsonl \
  --advance-policy fixtures/canary/asset-qa.example-advance-policy.json \
  --out evidence/canary/asset-qa-v2-canary-1.advance.json
~~~

The gate checks:

- minimum candidate-authority request count,
- minimum comparable question count,
- candidate error rate,
- incumbent error rate,
- candidate-to-incumbent fallback rate,
- disagreement rate,
- optional p95 latency ratio,
- zero kill-switch trips.

A KILL trip always prevents stage advance.

The result sets automaticStageAdvance=false.

## 9. Stage progression

A passing stage produces eligibility evidence only.

The operator creates a new policy for the next stage:

~~~text
canary_1
  pass
   |
new canary-plan
   |
canary_5
~~~

Because the new plan re-pins the lineage event-chain hash, rollout cannot quietly continue from stale ancestry evidence.

## 10. Synthetic rollback drill

Before relying on the rollback path, run the built-in fault drill:

~~~bash
npm run mso -- canary-drill \
  --registry evidence/lineage/asset-qa.json \
  --out-dir evidence/drills/asset-qa-v2
~~~

The drill uses a cloned in-memory registry and synthetic reversible requests.

It performs:

~~~text
candidate success
candidate success
synthetic candidate failure
  |
  +-- incumbent fallback
  +-- circuit breaker KILL
next request -> incumbent only
stage advance -> fail / hold
rollback plan -> generated
simulated external switch -> recorded only in cloned registry
rollback target -> restored
~~~

The production registry file is not mutated.

The drill reports:

~~~text
productionRegistryMutated=false
externalRuntimeAuthorityChanged=false
~~~

## 11. Drill artifacts

The output bundle contains:

~~~text
policy.json
canary-traces.jsonl
advance.json
rollback-plan.json
simulated-registry.json
drill.json
~~~

The drill passes only when all control-path checks pass.

## 12. Real rollback

A real incident still follows M0.8 two-phase rollback:

~~~text
rollback-plan
  |
operator/runtime performs actual checkpoint switch
  |
lineage-record-rollback --execution-ref ...
~~~

The canary provider can KILL candidate authority immediately.

The lineage registry does not execute the external checkpoint switch.

## 13. Failure semantics

Candidate error:

~~~text
candidate error
 -> incumbent fallback
 -> evidence
 -> circuit breaker may KILL
~~~

Incumbent error while candidate succeeds:

~~~text
candidate can still return on selected traffic
 -> observer records incumbent error
 -> stage gate sees fallback-path instability
~~~

Candidate and incumbent both fail:

~~~text
request fails
 -> provider errors remain visible
~~~

Evidence write failure must not replace a valid provider response.

## 14. Limited active

limited_active means 100% of the explicitly eligible bounded surface.

It does not mean global authority.

Requests outside the decision surface, without explicit eligibility, without low-impact/reversible attestations, or carrying blocked risk tags remain on the incumbent.

## 15. Non-goals

M0.9 does not:

- make high-impact irreversible actions canary-eligible,
- auto-advance rollout stages,
- auto-reset a tripped kill switch,
- auto-promote a checkpoint,
- mutate the lineage registry during the synthetic drill,
- execute external production rollback,
- treat incumbent agreement as a correctness label.

It adds bounded authority, fast fallback, and a tested escape hatch.
