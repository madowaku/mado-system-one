# MADO Laya Baseline Lineage / Distribution Epoch Registry Runbook

Version: v0.1
Status: Distribution epoch lineage baseline
Date: 2026-10-03

## Purpose

MSO-LAYA-M1.3 gives workload baselines an append-only lineage of their own.

Checkpoint lineage answers:

~~~text
Which model artifact generation was trusted?
~~~

Baseline lineage answers:

~~~text
Which workload distribution was considered normal?
~~~

Together:

~~~text
Checkpoint Generation × Workload Epoch
~~~

## 1. Two independent axes

A checkpoint can change while the workload epoch stays the same.

A workload epoch can change while the checkpoint stays the same.

Example:

~~~text
                 Epoch 001   Epoch 002
checkpoint-v2       ●           ●
checkpoint-v3       ●
~~~

Each dot is an explicit checkpoint-to-epoch binding.

## 2. Registry contract

Schema:

~~~text
mso.baseline-lineage.v0
~~~

The registry is:

- append-only,
- SHA-256 hash chained,
- atomic on write,
- single-writer locked,
- scoped to one decision surface,
- non-authoritative over runtime execution.

It records evidence. It does not start or stop a provider.

## 3. Events

M1.3 has two event types:

~~~text
epoch_registered
checkpoint_binding_recorded
~~~

epoch_registered advances the workload lineage.

checkpoint_binding_recorded links a model generation to an already accepted workload epoch.

## 4. Epoch identity

Each epoch records:

- epoch id,
- ordinal,
- origin: initial or rebaseline,
- parent epoch,
- child epochs,
- lifecycle: current or superseded,
- distribution summary,
- accepted baseline metrics,
- source canary policy,
- source drift policy,
- evidence references,
- M1.2 rebaseline id when applicable.

## 5. Binding identity

Each checkpoint binding records:

- binding id,
- epoch id,
- checkpoint id,
- checkpoint fingerprint,
- limited-active activation policy id,
- checkpoint-specific drift policy id,
- activation-time checkpoint-lineage head hash,
- checkpoint-lineage head hash observed when binding is recorded,
- evidence reference.

The activation-time and recorded lineage hashes may differ after legitimate audit-only events.

The checkpoint identity and fingerprint must still match the current checkpoint lineage head.

## 6. Initialize the registry

~~~bash
npm run mso -- baseline-lineage-init \
  --registry evidence/baseline/asset-qa.json \
  --registry-id asset-qa-distribution-lineage \
  --surface asset.qa
~~~

The initial registry has no epochs and no runtime authority.

## 7. Seed Epoch 001

Use an already accepted limited-active policy and M1.0 drift policy:

~~~bash
npm run mso -- baseline-register-initial \
  --registry evidence/baseline/asset-qa.json \
  --checkpoint-registry evidence/lineage/asset-qa.json \
  --activation-policy evidence/canary/asset-qa-active.policy.json \
  --drift-policy evidence/drift/asset-qa.policy.json \
  --epoch-id epoch-001 \
  --distribution-summary "Initial accepted asset QA workload" \
  --source-evidence-ref evidence/drift/asset-qa.policy.json \
  --binding-evidence-ref activation:asset-qa-active
~~~

The initial epoch requires an empty baseline registry.

## 8. Register M1.2 rebaseline as Epoch 002

After M1.2 produces:

~~~text
rebaseline.acceptance.json
limited-active.policy.json
drift.policy.json
~~~

register the new epoch:

~~~bash
npm run mso -- baseline-register-rebaseline \
  --registry evidence/baseline/asset-qa.json \
  --checkpoint-registry evidence/lineage/asset-qa.json \
  --acceptance evidence/recovery/rebaseline.acceptance.json \
  --activation-policy evidence/recovery/limited-active.policy.json \
  --drift-policy evidence/recovery/drift.policy.json \
  --epoch-id epoch-002 \
  --binding-evidence-ref activation:asset-qa-epoch-002
~~~

The previous epoch becomes superseded.

It remains immutable historical evidence.

## 9. Rebaseline acceptance checks

A rebaseline epoch is accepted into lineage only when:

- M1.2 acceptance status is pass,
- action is eligible_for_limited_active,
- automaticActivation=false,
- oldBaselineReplaced=false,
- acceptance surface matches the registry,
- checkpoint id and fingerprint match,
- generated limited-active policy id matches,
- generated drift policy id matches,
- accepted metrics equal the new drift baseline,
- current checkpoint lineage still points at the same artifact.

## 10. Checkpoint change without Epoch change

If a new checkpoint generation is promoted while the world distribution remains the same, do not create another workload epoch.

Create another binding:

~~~bash
npm run mso -- baseline-bind-checkpoint \
  --registry evidence/baseline/asset-qa.json \
  --checkpoint-registry evidence/lineage/asset-qa.json \
  --activation-policy evidence/canary/asset-qa-v3-active.policy.json \
  --drift-policy evidence/drift/asset-qa-v3.policy.json \
  --evidence-ref activation:asset-qa-v3
~~~

The new checkpoint drift baseline must numerically match the current distribution epoch baseline.

Its drift policy id may differ.

That is expected.

## 11. Why drift policy ids are per binding

An epoch describes the world.

A drift policy also includes checkpoint/provider-specific monitoring configuration.

Therefore:

~~~text
Epoch 001
  checkpoint-v2 -> drift-v2-e1
  checkpoint-v3 -> drift-v3-e1
~~~

The epoch stores the source drift policy that established the epoch.

Each binding stores its own drift policy id.

## 12. Derived state

~~~bash
npm run mso -- baseline-show \
  --registry evidence/baseline/asset-qa.json
~~~

Derived state includes:

- currentEpochId,
- all epochs,
- all bindings,
- checkpointEpochMatrix,
- event count,
- event-chain head hash.

Example:

~~~json
{
  "checkpointEpochMatrix": {
    "candidate-v2": ["epoch-001", "epoch-002"],
    "candidate-v3": ["epoch-002"]
  }
}
~~~

## 13. Lifecycle

Epoch lifecycle is evidence lifecycle, not runtime lifecycle:

~~~text
current
  accepted workload baseline at registry head

superseded
  previously accepted workload baseline
~~~

Superseded does not mean wrong.

It means historical.

## 14. Hash-chain integrity

Every event stores:

~~~text
prevEventHash
eventHash
~~~

Changing old distribution text, metrics, bindings, or evidence references without rebuilding the chain is detected as tampering.

The chain protects the interpretation of past operational evidence.

## 15. Checkpoint lineage freshness

A binding validates the current checkpoint registry:

- decision surface matches,
- target checkpoint is the recorded head,
- lifecycle is promoted or restored,
- fingerprint matches the activation policy,
- drift policy matches activation identity.

The baseline registry records both:

~~~text
activationLineageHeadEventHash
recordedLineageHeadEventHash
~~~

This makes later audit events visible without confusing them with artifact changes.

## 16. Runtime authority boundary

The baseline registry always records:

~~~text
runtimeAuthorityManaged = false
~~~

Registering an epoch does not activate limited-active traffic.

Registering a binding does not switch checkpoints.

Those remain explicit operational actions.

## 17. Relationship to M1.0–M1.2

~~~text
M1.0
  detects drift

M1.1
  diagnoses recovery route

M1.2
  proves and accepts a new workload baseline

M1.3
  records that accepted baseline as a distribution epoch
  and maps checkpoint generations onto it
~~~

## 18. Non-goals

M1.3 does not:

- decide whether a workload shift is safe,
- skip M1.2 recovery canary,
- activate runtime authority,
- rollback checkpoints,
- overwrite historical baselines,
- require a new epoch every time the model changes,
- require a new checkpoint every time the world changes.

It gives System One memory of which model generation was trusted in which world.
