# MADO Laya Active-Limited Drift / Auto-Hold Runbook

Version: v0.1
Status: Active-limited drift baseline
Date: 2026-10-02

## Purpose

MSO-LAYA-M1.0 adds continuous drift detection after a checkpoint has reached limited_active.

The guard does not auto-rollback.

Its job is narrower:

~~~text
active-limited candidate authority
        |
rolling drift monitor
        |
normal ---------> continue
drift ----------> AUTO HOLD
                    |
                    +--> incumbent-only
                    +--> preserve checkpoint lineage
                    +--> no automatic rollback
~~~

The checkpoint remains registered and promoted in lineage.

The activation session loses candidate authority until a new reviewed session is created.

## 1. What AUTO HOLD means

AUTO HOLD reuses the M0.9 authority switch but records the switch state as:

~~~text
kind = auto_hold
~~~

After HOLD:

- candidate inference is not invoked for later requests,
- incumbent becomes the only returned authority,
- canary traces use fallbackReason=auto_hold,
- the lineage registry is unchanged,
- no rollback event is emitted,
- no checkpoint files are changed.

AUTO HOLD is deliberately cheaper and less destructive than rollback.

## 2. Build the drift baseline

Use evidence from an accepted M0.9 canary stage for the same:

- candidate checkpoint,
- candidate provider,
- incumbent provider,
- decision surface.

The recommended source is the accepted canary_25 stage immediately before limited_active.

Create the limited-active activation policy first, then build the drift policy:

~~~bash
npm run mso -- drift-plan \
  --activation-policy evidence/canary/asset-qa-v2-active.policy.json \
  --baseline-policy evidence/canary/asset-qa-v2-canary-25.policy.json \
  --baseline-traces evidence/canary/asset-qa-v2-canary-25.jsonl \
  --policy-id asset-qa-v2-active-drift \
  --window-size 200 \
  --min-selected 100 \
  --min-comparable 100 \
  --min-confidence-samples 100 \
  --max-candidate-error 0.02 \
  --max-incumbent-error 0.02 \
  --max-fallback 0.02 \
  --max-disagreement 0.08 \
  --max-latency-ratio 2 \
  --max-confidence-delta 0.15 \
  --out evidence/drift/asset-qa-v2.policy.json
~~~

Thresholds are decision-surface policy.

The numbers above are illustrative, not global defaults.

## 3. Policy identity

A drift policy is pinned to:

- limited-active activation policy id,
- decision surface,
- candidate checkpoint id,
- candidate checkpoint fingerprint,
- candidate provider id,
- incumbent provider id,
- lineage event-chain head hash.

A drift policy cannot be reused with a different checkpoint or activation generation.

## 4. Baseline metrics

The accepted canary baseline records:

- candidate error rate,
- incumbent error rate,
- fallback rate,
- disagreement rate,
- p95 candidate/incumbent latency ratio,
- candidate confidence sample count,
- mean candidate confidence.

Confidence monitoring is relative to the accepted workload.

M1.0 does not assume one universal "healthy confidence" value.

## 5. Rolling window

The live guard holds only after minimum evidence is available.

Window policy includes:

~~~text
window.size
minCandidateSelected
minComparableQuestions
minCandidateConfidenceSamples
~~~

Before all minimums are satisfied, the window status is blocked.

A blocked window cannot AUTO HOLD from drift thresholds.

Severe provider failures are still handled immediately by the M0.9 circuit breaker.

## 6. Drift checks

Once the rolling window is mature, M1.0 checks:

- candidate provider error rate,
- incumbent provider error rate,
- candidate-to-incumbent fallback rate,
- disagreement rate,
- p95 latency ratio,
- absolute delta of mean candidate confidence versus accepted baseline.

Any failed check produces action=auto_hold.

Disagreement remains a stability signal, not a correctness label.

## 7. Live integration

Use one shared M0.9 authority switch instance:

~~~text
CanaryKillSwitch
    |
    +-- CanaryActivationProvider
    |
    +-- ActiveLimitedDriftGuard
~~~

The guard is connected through CanaryActivationProvider.traceObserver.

Conceptually:

~~~ts
const killSwitch = new CanaryKillSwitch();

const guard = new ActiveLimitedDriftGuard({
  policy: driftPolicy,
  activationPolicy,
  killSwitch,
  holdSink,
});

const provider = new CanaryActivationProvider({
  incumbent,
  candidate,
  policy: activationPolicy,
  killSwitch,
  sink: canarySink,
  traceObserver: (trace) => guard.observe(trace),
});
~~~

The control path and evidence-storage path are separate.

A failure to persist ordinary canary evidence must not disable the drift decision path.

## 8. Confidence telemetry

M1.0 extends canary question comparisons with:

~~~text
incumbentConfidence
candidateConfidence
~~~

Canary session summaries now include:

~~~text
candidateConfidenceSamples
meanCandidateConfidence
incumbentConfidenceSamples
meanIncumbentConfidence
~~~

The guard compares the current rolling mean with the accepted baseline mean.

This detects both unexpected confidence collapse and unexpected over-confidence movement.

## 9. HOLD evidence

A HOLD event records:

- drift policy identity,
- activation policy identity,
- candidate checkpoint and fingerprint,
- trigger trace id,
- triggering timestamp,
- failed checks,
- full rolling-window evidence,
- candidateAuthorityAfterHold=false,
- fallbackAuthority=incumbent,
- automaticHold=true,
- automaticRollback=false.

HOLD events can be written to JSONL with JsonlDriftHoldEvidenceSink.

## 10. Offline evaluation

Existing active-limited traces can be replayed through the same evaluator:

~~~bash
npm run mso -- drift-evaluate \
  --activation-policy evidence/canary/asset-qa-v2-active.policy.json \
  --drift-policy evidence/drift/asset-qa-v2.policy.json \
  --traces evidence/canary/asset-qa-v2-active.jsonl \
  --out evidence/drift/asset-qa-v2.window.json
~~~

Offline evaluation reports the action that the live guard would take.

It does not mutate a kill switch and does not execute rollback.

## 11. HOLD versus KILL

M0.9 KILL and M1.0 AUTO HOLD both remove candidate authority for the current activation session.

Their evidence semantics differ:

~~~text
KILL
  immediate operational fault
  circuit breaker / operator action

AUTO HOLD
  mature rolling-window drift
  quality/reliability distribution changed
~~~

The shared switch records kind=kill or kind=auto_hold.

Neither resets itself automatically.

## 12. Recovery

Do not simply clear an AUTO HOLD in place.

Recommended recovery loop:

~~~text
AUTO HOLD
   |
preserve traces
   |
diagnose drift
   |
replay / re-eval / recalibrate / retrain as needed
   |
new activation policy
   |
canary again
~~~

The old activation session remains historical evidence.

## 13. Concurrency note

Drift checks run when a completed canary trace is available.

A trace requiring incumbent/candidate comparison closes after both observer results are known.

Requests already selected before the HOLD observation may still be in flight.

AUTO HOLD prevents subsequent selection once the shared authority switch has entered auto_hold.

The M0.9 immediate circuit breaker remains the faster path for direct candidate provider failures.

## 14. AUTO HOLD is not rollback

M1.0 explicitly records:

~~~text
automaticHold=true
automaticRollback=false
~~~

Reasons:

- drift may come from workload change rather than checkpoint corruption,
- rollback changes checkpoint generation state,
- HOLD preserves evidence while removing candidate authority,
- the operator can decide whether recovery means recalibration, retraining, routing change, or M0.8 rollback.

## 15. Non-goals

M1.0 does not:

- infer correctness from incumbent agreement,
- reset a held session automatically,
- mutate checkpoint lineage,
- revoke promotion automatically,
- execute rollback automatically,
- choose universal drift thresholds,
- cancel candidate requests already in flight before HOLD is observed.

It adds a reversible authority brake for a model that was already trusted enough to reach limited_active.
