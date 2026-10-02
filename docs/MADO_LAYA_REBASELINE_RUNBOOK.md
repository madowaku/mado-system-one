# MADO Laya Rebaseline / Recovery Canary Evidence Bridge Runbook

Version: v0.1
Status: Workload-drift recovery baseline
Date: 2026-10-03

## Purpose

MSO-LAYA-M1.2 handles the M1.1 branch:

~~~text
workload_drift
  |
requires_rebaseline
~~~

A new workload distribution does not automatically replace the old baseline.

The flow is:

~~~text
old accepted baseline
  |
new workload sample
  |
distribution delta + operational health review
  |
rebaseline candidate
  |
recovery canary_1 -> canary_5 -> canary_25
  |
operator acceptance
  |
new limited_active policy
  |
new drift policy baseline
~~~

## 1. Three different things

Keep these separate:

~~~text
old baseline
  historical accepted evidence

rebaseline candidate
  reviewed hypothesis for a changed workload

accepted rebaseline
  canary-backed baseline for the next active-limited session
~~~

M1.2 never overwrites the historical baseline artifact.

## 2. Preconditions

The route is valid only when M1.1 classified the HOLD as workload_drift.

The held checkpoint must still be:

- the recorded lineage head,
- promoted,
- the same artifact fingerprint,
- attached to a currently known-good rollback target.

If checkpoint identity changed, use the new-checkpoint path instead.

## 3. Candidate workload sample

The candidate sample should represent the changed workload.

It can come from replay or other bounded evidence collection, but every trace must remain attributable to the held activation identity.

M1.2 summarizes:

- candidate request count,
- comparable questions,
- candidate confidence samples,
- candidate error rate,
- incumbent error rate,
- fallback rate,
- disagreement rate,
- p95 latency ratio,
- mean candidate confidence.

The old M1.0 baseline is preserved beside the candidate metrics.

## 4. Distribution delta is descriptive

M1.2 reports changes such as:

~~~text
mean confidence       -0.18
disagreement rate     +0.12
fallback rate         +0.00
candidate error rate  +0.00
~~~

A large confidence or disagreement shift does not automatically fail rebaseline.

That may be the workload shift itself.

Operational health has separate absolute ceilings.

## 5. Rebaseline review

Example review:

~~~json
{
  "schemaVersion": "mso.rebaseline-review.v0",
  "rebaselineId": "asset-qa-v2-rebaseline-001",
  "holdId": "hold-...",
  "recoveryId": "asset-qa-v2-workload-recovery-001",
  "operatorReviewed": true,
  "operatorApprovalRef": "ops-review:...",
  "distributionSummary": "UI-heavy assets increased materially.",
  "evidenceRefs": ["distribution-delta:..."]
}
~~~

Repository example:

~~~text
fixtures/recovery/asset-qa.example-rebaseline-review.json
~~~

## 6. Candidate health gate

The candidate workload must meet explicit per-surface minimums and ceilings:

- minimum candidate-authority samples,
- minimum comparable questions,
- minimum confidence samples,
- maximum candidate error rate,
- maximum incumbent error rate,
- maximum fallback rate,
- maximum p95 latency ratio.

These are operational-health checks.

They do not force the new workload to resemble the old distribution.

## 7. Build a rebaseline candidate

~~~bash
npm run mso -- rebaseline-plan \
  --registry evidence/lineage/asset-qa.json \
  --activation-policy evidence/canary/asset-qa-v2-active.policy.json \
  --drift-policy evidence/drift/asset-qa-v2.policy.json \
  --hold evidence/drift/asset-qa-v2.hold.json \
  --recovery evidence/recovery/asset-qa-v2-recovery.json \
  --candidate-traces evidence/recovery/asset-qa-v2-new-workload.jsonl \
  --review evidence/recovery/asset-qa-v2-rebaseline-review.json \
  --new-policy-id asset-qa-v2-recovery-canary-1 \
  --min-selected 100 \
  --min-comparable 100 \
  --min-confidence-samples 100 \
  --max-candidate-error 0.02 \
  --max-incumbent-error 0.02 \
  --max-fallback 0.02 \
  --max-latency-ratio 2 \
  --out-dir evidence/recovery/asset-qa-v2-rebaseline
~~~

Outputs:

~~~text
rebaseline.candidate.json
recovery-canary.policy.json    # only when candidate passes
~~~

The recovery policy always begins at canary_1.

## 8. Candidate does not replace baseline

Even when the candidate passes:

~~~text
oldBaselineReplaced = false
automaticActivation = false
~~~

The new distribution is only eligible for recovery canary.

## 9. Recovery canary chain

The same checkpoint must then pass the standard M0.9 ladder:

~~~text
canary_1
  |
pass
  |
canary_5
  |
pass
  |
canary_25
  |
pass
  |
eligible for limited_active
~~~

M1.2 acceptance requires:

- all three canary policies,
- all three advance evidence artifacts,
- matching checkpoint fingerprint,
- matching candidate/incumbent providers,
- matching decision surface,
- matching lineage head hash,
- pass at every stage.

Skipping 5% or presenting only 25% evidence is rejected.

## 10. Acceptance review

Example:

~~~text
fixtures/recovery/asset-qa.example-rebaseline-acceptance.json
~~~

Acceptance requires operator review, approval reference, and evidence refs.

Healthy canary evidence without reviewed acceptance does not materialize a new baseline.

## 11. Accept the new baseline

~~~bash
npm run mso -- rebaseline-accept \
  --registry evidence/lineage/asset-qa.json \
  --candidate evidence/recovery/asset-qa-v2-rebaseline/rebaseline.candidate.json \
  --canary-1-policy evidence/canary/recovery-1.policy.json \
  --canary-1-advance evidence/canary/recovery-1.advance.json \
  --canary-5-policy evidence/canary/recovery-5.policy.json \
  --canary-5-advance evidence/canary/recovery-5.advance.json \
  --canary-25-policy evidence/canary/recovery-25.policy.json \
  --canary-25-advance evidence/canary/recovery-25.advance.json \
  --review evidence/recovery/asset-qa-v2-rebaseline-acceptance.json \
  --limited-active-policy-id asset-qa-v2-active-rebaseline \
  --drift-policy-id asset-qa-v2-drift-rebaseline \
  --window-size 200 \
  --min-selected 100 \
  --min-comparable 100 \
  --min-confidence-samples 100 \
  --max-candidate-error 0.02 \
  --max-incumbent-error 0.02 \
  --max-fallback 0.02 \
  --max-disagreement 0.12 \
  --max-latency-ratio 2 \
  --max-confidence-delta 0.15 \
  --out-dir evidence/recovery/asset-qa-v2-rebaseline-accepted
~~~

Outputs on pass:

~~~text
rebaseline.acceptance.json
limited-active.policy.json
drift.policy.json
~~~

## 12. What becomes the new baseline

The new M1.0 drift policy uses the accepted canary_25 summary as its baseline.

That means the baseline is not the initial candidate sample.

It is the workload after staged runtime evidence has confirmed bounded operation.

## 13. Activation remains separate

Even after acceptance:

~~~text
automaticActivation = false
oldBaselineReplaced = false
~~~

The generated limited-active policy is eligible evidence.

Starting that runtime session remains an explicit operational action.

Historical baseline artifacts are never rewritten.

## 14. Rebaseline versus recalibration

Use rebaseline when the workload distribution legitimately changed.

Use calibration recovery when the workload is stable but threshold/confidence mapping became wrong.

A lower mean confidence may be:

- acceptable new workload behavior, or
- broken calibration.

Diagnosis decides the route before M1.2 begins.

## 15. Rebaseline versus retraining

A workload shift does not automatically require retraining.

If the same checkpoint remains operationally healthy and passes recovery canary, a new baseline may be appropriate.

If accuracy or labeled re-evaluation later shows checkpoint failure, return to the new-checkpoint path.

## 16. Evidence boundaries

M1.2 records:

- old baseline metrics,
- candidate workload metrics,
- signed-off distribution description,
- descriptive deltas,
- candidate health checks,
- recovery canary policy identities,
- recovery canary advance evidence,
- final accepted canary metrics,
- generated limited-active policy id,
- generated drift policy id.

Agreement remains a stability signal, not a correctness label.

## 17. Non-goals

M1.2 does not:

- mutate historical baselines,
- infer workload drift automatically from one metric,
- skip staged canary,
- auto-start limited-active authority,
- retrain a checkpoint,
- replace M0.7 labeled evaluation,
- claim that distribution change is inherently safe.

It provides a controlled bridge from a changed world to a new operational baseline.
