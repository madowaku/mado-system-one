# MADO Laya Hold Recovery / Requalification Runbook

Version: v0.1
Status: Hold recovery baseline
Date: 2026-10-02

## Purpose

MSO-LAYA-M1.1 defines how a checkpoint can recover after M1.0 AUTO HOLD.

The core rule is:

~~~text
AUTO HOLD is never cleared in place.
~~~

A held activation session remains historical evidence.

Recovery either:

- produces a new canary_1 activation policy for the same checkpoint,
- requires a new workload baseline,
- requires a new checkpoint lineage,
- or remains blocked while diagnosis is incomplete.

## 1. Recovery flow

~~~text
AUTO HOLD
   |
preserve evidence
   |
diagnose
   |
classify cause
   |
repair / rebaseline / retrain
   |
verify
   |
requalification gate
   |
new activation session or remain held
~~~

M1.1 does not mutate the old CanaryKillSwitch.

## 2. Diagnosis classes

The recovery case uses one of five explicit classes:

~~~text
provider_regression
calibration_drift
workload_drift
checkpoint_regression
unknown
~~~

The class controls the allowed recovery route.

### provider_regression

Examples:

- local runtime regression,
- dependency/runtime packaging regression,
- provider execution bug,
- environment-specific provider failure.

The exact checkpoint may be requalified if repair and replay evidence pass.

### calibration_drift

Examples:

- threshold profile became invalid,
- confidence mapping changed,
- bounded score mapping or calibration configuration regressed.

The same checkpoint may be requalified only after reviewed repair and a passing post-repair replay window.

### workload_drift

The old accepted canary workload is no longer representative.

Direct same-checkpoint requalification is blocked.

The route is:

~~~text
requires_rebaseline
~~~

Build a reviewed replacement baseline, then create a new activation lifecycle.

### checkpoint_regression

The checkpoint itself is considered the faulty artifact.

Direct recovery is blocked.

The route is:

~~~text
requires_new_checkpoint
~~~

Return through fine-tune / re-eval / promotion / lineage before another activation.

### unknown

Do not reopen candidate authority.

The route is:

~~~text
diagnosis_required
~~~

## 3. Recovery case

Example:

~~~json
{
  "schemaVersion": "mso.hold-recovery-case.v0",
  "recoveryId": "asset-qa-v2-recovery-001",
  "holdId": "hold-...",
  "classification": "provider_regression",
  "diagnosisSummary": "Candidate runtime dependency regressed.",
  "operatorReviewed": true,
  "operatorApprovalRef": "ops-review:recovery-001",
  "diagnosisEvidenceRefs": ["incident:42"],
  "repairSummary": "Runtime repaired.",
  "repairEvidenceRefs": ["change:42"],
  "verificationEvidenceRefs": ["replay:42"]
}
~~~

The repository includes:

~~~text
fixtures/recovery/asset-qa.example-recovery.json
~~~

## 4. Evidence required for same-checkpoint recovery

provider_regression and calibration_drift require:

- operatorReviewed=true,
- operatorApprovalRef,
- diagnosis evidence,
- repair evidence,
- verification evidence,
- a passing post-repair drift replay window.

A missing requirement leaves the HOLD in place.

## 5. Post-repair replay

Recovery traces are evaluated with the same M1.0 drift policy that produced the hold.

For same-checkpoint recovery:

~~~text
recovery window status = pass
recovery window action = continue
~~~

is required.

This does not prove global correctness.

It proves that the repaired path satisfies the bounded operational drift contract that previously failed.

## 6. Run the requalification gate

~~~bash
npm run mso -- hold-requalify \
  --registry evidence/lineage/asset-qa.json \
  --activation-policy evidence/canary/asset-qa-v2-active.policy.json \
  --drift-policy evidence/drift/asset-qa-v2.policy.json \
  --hold evidence/drift/asset-qa-v2.hold.json \
  --recovery evidence/recovery/asset-qa-v2-recovery.json \
  --recovery-traces evidence/recovery/asset-qa-v2-replay.jsonl \
  --new-policy-id asset-qa-v2-restart-001 \
  --out-dir evidence/recovery/asset-qa-v2-requalification
~~~

The output directory contains:

~~~text
requalification.json
restart.policy.json     # only when requalification passes
~~~

A blocked result never emits restart.policy.json.

## 7. New session only

A successful result records:

~~~text
action = eligible_for_new_canary
restartStage = canary_1
automaticReactivation = false
oldSessionReusable = false
~~~

The restart policy always begins at canary_1.

It never resumes directly at limited_active.

## 8. Current lineage is rechecked

The original activation policy was pinned to the lineage hash that existed before HOLD.

During diagnosis, audit events may legitimately be added.

M1.1 therefore does not require the old lineage hash to remain current forever.

Instead, before same-checkpoint requalification it verifies that:

- the held checkpoint is still the current recorded lineage head,
- the checkpoint is still promoted,
- the artifact fingerprint is unchanged,
- its rollback target still exists,
- the rollback target is still known-good.

The new canary policy is then pinned to the current lineage head hash.

This preserves freshness without making harmless audit events permanently block recovery.

## 9. What cannot be reused

The following remain historical and are not reset:

- old activation policy id,
- old AUTO HOLD event,
- old activation-session authority state,
- old kill/hold switch instance.

A successful requalification creates a distinct policy id.

## 10. Identity checks

The gate cross-checks:

- hold id,
- drift policy id,
- activation policy id,
- decision surface,
- checkpoint id,
- checkpoint fingerprint,
- recovery-window policy identity.

Cross-wiring evidence from another checkpoint or decision surface is rejected.

## 11. AUTO HOLD remains cheaper than rollback

M1.1 preserves the M1.0 distinction:

~~~text
AUTO HOLD
  remove candidate authority
  preserve lineage
  diagnose

ROLLBACK
  change checkpoint generation state
  external runtime operation
~~~

A provider or calibration issue may recover without changing checkpoint lineage.

A checkpoint regression should not.

## 12. Workload drift

Workload drift is not treated as model failure by default.

If the task distribution legitimately changed:

~~~text
old baseline
  |
  X no longer representative
  |
new reviewed baseline
  |
new canary lifecycle
~~~

M1.1 routes this condition to requires_rebaseline rather than pretending the old thresholds still define health.

## 13. Checkpoint regression

If the diagnosis says the artifact itself regressed:

~~~text
held checkpoint
   |
requires_new_checkpoint
   |
fine-tune / replacement
   |
M0.7 re-eval
   |
M0.5 promotion evidence
   |
M0.8 lineage
   |
M0.9 canary
~~~

The faulty checkpoint is not directly requalified.

## 14. Operator review

Requalification does not mean automatic reactivation.

The gate requires an operator approval reference for the same-checkpoint route and emits:

~~~text
automaticReactivation=false
~~~

The new policy is an eligible plan, not a silently started deployment.

## 15. Failure behavior

Missing diagnosis evidence:

~~~text
hold_remains
~~~

Missing repair or verification evidence for provider/calibration recovery:

~~~text
hold_remains
~~~

Post-repair drift replay still fails:

~~~text
hold_remains
~~~

Workload drift:

~~~text
requires_rebaseline
~~~

Checkpoint regression:

~~~text
requires_new_checkpoint
~~~

Unknown cause:

~~~text
diagnosis_required
~~~

## 16. Non-goals

M1.1 does not:

- clear the original AUTO HOLD,
- mutate the original activation session,
- resume directly at limited_active,
- invent a new baseline for workload drift,
- retrain a regressed checkpoint,
- automatically reactivate runtime authority,
- automatically rollback checkpoint lineage.

It turns HOLD from a dead end into a typed recovery junction.
