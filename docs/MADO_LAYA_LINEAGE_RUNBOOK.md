# MADO Laya Checkpoint Lineage / Rollback Runbook

Version: v0.1
Status: Operational lineage baseline
Date: 2026-10-02

## Purpose

MSO-LAYA-M0.8 records checkpoint ancestry, promotion evidence, rollback safety, and executed rollback attestations without taking runtime authority.

The registry is evidence, not a deployment controller.

~~~text
base-v1
  |
  +-- candidate-v2
        |
        +-- candidate-v3
~~~

Every state-changing registry event is hash-chained.

## 1. Create one registry per decision surface

~~~bash
npm run mso -- lineage-init \
  --registry evidence/lineage/asset-qa.json \
  --registry-id asset-qa-laya \
  --surface asset.qa
~~~

Registry initialization is exclusive. An existing registry is not silently overwritten.

The registry records providerFamily=laya and runtimeAuthorityManaged=false.

## 2. Register the known baseline

~~~bash
npm run mso -- lineage-register \
  --registry evidence/lineage/asset-qa.json \
  --checkpoint-id base-v1 \
  --checkpoint-dir checkpoints/base-v1 \
  --ref base-v1 \
  --origin base \
  --known-good \
  --known-good-ref production-baseline-approval:asset.qa:v1
~~~

A rollback-safe checkpoint requires an evidence reference.

The registry does not infer known-good status from age, model name, or ancestry.

## 3. Register a fine-tuned child

~~~bash
npm run mso -- lineage-register \
  --registry evidence/lineage/asset-qa.json \
  --checkpoint-id candidate-v2 \
  --checkpoint-dir checkpoints/candidate-v2 \
  --ref candidate-v2 \
  --origin fine_tune \
  --parent base-v1 \
  --pack-ref evidence/finetune/pack-v2/manifest.json \
  --reeval evidence/reeval/candidate-v2/summary.json
~~~

For a fine-tuned child:

- parent checkpoint must already exist,
- the re-eval candidate fingerprint must match the checkpoint being registered,
- the re-eval base fingerprint must match the registered parent.

A checkpoint fingerprint cannot be registered twice under different names.

## 4. Record promotion eligibility

After M0.5 Promotion Gate passes:

~~~bash
npm run mso -- lineage-promote \
  --registry evidence/lineage/asset-qa.json \
  --checkpoint-id candidate-v2 \
  --gate evidence/promotion/candidate-v2.json \
  --reeval evidence/reeval/candidate-v2/summary.json \
  --rollback-target base-v1
~~~

The registry verifies:

- gate surface matches the registry surface,
- gate says eligible_for_promotion,
- automaticPromotion is false,
- gate candidate provider matches re-eval candidate provider,
- candidate fingerprint matches the registered checkpoint,
- re-eval base fingerprint matches the parent,
- rollback target is a known-good ancestor,
- if a recorded head already exists, the candidate must be its direct child.

Recording promotion does not switch runtime provider authority.

## 5. Attest or revoke rollback safety

After a promoted checkpoint has earned status as a safe fallback for the next generation:

~~~bash
npm run mso -- lineage-set-rollback-safety \
  --registry evidence/lineage/asset-qa.json \
  --checkpoint-id candidate-v2 \
  --eligible true \
  --evidence-ref rollback-approval:candidate-v2 \
  --reason "holdout, shadow, and operational controls accepted"
~~~

Rollback eligibility can later be revoked:

~~~bash
npm run mso -- lineage-set-rollback-safety \
  --registry evidence/lineage/asset-qa.json \
  --checkpoint-id candidate-v2 \
  --eligible false \
  --evidence-ref incident:regression-77 \
  --reason "critical regression discovered"
~~~

The latest attestation is part of the hash-chained event history.

## 6. Inspect lineage state

~~~bash
npm run mso -- lineage-show \
  --registry evidence/lineage/asset-qa.json
~~~

Derived state includes checkpoint parent and children, fingerprints, lifecycle, rollback-safety status, evidence references, recorded lineage head, event count, and current event-chain head hash.

Lifecycle values distinguish registered, promoted, restored, superseded, and rolled_back.

A restored checkpoint is not described as newly promoted.

## 7. Plan rollback

Rollback planning is non-executing.

~~~bash
npm run mso -- rollback-plan \
  --registry evidence/lineage/asset-qa.json \
  --to base-v1 \
  --reason "candidate regression incident" \
  --out evidence/rollback/plan.json
~~~

Optional --from is an assertion about the current recorded head, not a way to jump from another branch.

The plan records automaticExecution=false, runtimeAuthorityChanged=false, and requiredAction=operator_switch_runtime_checkpoint_then_record_execution.

The target must be registered, marked known-good, and an ancestor of the recorded head.

The plan captures the current registry event-chain hash.

## 8. Execute outside the registry

The actual runtime switch remains an operator/runtime responsibility.

The registry does not change environment variables, rewrite production routing, restart services, load a different checkpoint, or alter provider authority.

Rollback first according to the operational control plane.

## 9. Record completed rollback

After the runtime change has actually happened, record its external execution reference:

~~~bash
npm run mso -- lineage-record-rollback \
  --registry evidence/lineage/asset-qa.json \
  --plan evidence/rollback/plan.json \
  --execution-ref ops-change-123
~~~

The record is rejected when the plan belongs to another registry, the registry changed after planning, the target fingerprint changed, rollback safety was revoked, or the source is no longer the recorded head.

The restored ancestor becomes the recorded lineage head.

This is an attestation of an external action, not the action itself.

## 10. Hash-chain integrity

Each event contains event id, occurrence timestamp, previous event hash, typed payload, and event hash.

The event hash is SHA-256 over a canonicalized event representation.

Editing an old event breaks verification of the registry.

This is tamper-evident, not a substitute for signed storage or access control.

## 11. Concurrent writers

Registry mutations use an exclusive sibling lock file and atomic replacement.

A second local writer is rejected while the lock is held.

This protects the local JSON registry from common lost-update races. It does not turn a shared network filesystem into distributed consensus.

## 12. Branch safety

Once a recorded head exists, a promoted candidate must be a direct child of that head.

This prevents an old sibling candidate from silently jumping ahead of a newer lineage.

A rollback may only move upward through ancestry to a known-good checkpoint.

Cross-tree rollback is rejected.

## 13. Multi-generation loop

~~~text
base-v1 [known good]
  |
  +-- v2
      re-eval
      promotion gate
      promote
      rollback-safety attestation
        |
        +-- v3
            re-eval
            promotion gate
            promote
~~~

If v3 fails:

~~~text
v3
 |
 rollback plan
 |
 v2 [known good]
~~~

If v2 safety is later revoked, it cannot be selected as a new rollback target.

## 14. Evidence boundaries

Checkpoint identity is artifact identity.

Human names such as english, candidate-v2, or directory names are not sufficient.

The registry pins the SHA-256 checkpoint fingerprint produced by M0.7.

Promotion evidence remains external but is referenced by gate id and evidence ref, re-eval id and evidence ref, fine-tune pack ref where available, rollback-safety evidence ref, and rollback execution ref.

## 15. Non-goals

M0.8 does not deploy a checkpoint, automatically promote a checkpoint, automatically execute rollback, decide global promotion thresholds, sign registry events cryptographically, or replicate the registry across machines.

It makes model generations traceable and rollback choices bounded.
