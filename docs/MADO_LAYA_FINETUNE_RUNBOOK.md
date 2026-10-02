# MADO Laya Fine-tune Candidate Runbook

Version: v0.1
Status: Candidate-pack baseline
Date: 2026-10-02

## Purpose

This runbook covers the boundary between reviewed MADO disagreement evidence and a Laya fine-tuning candidate dataset.

It does not train or publish a model automatically.

The safe loop is:

~~~text
reviewed disagreement
-> approved hard label
-> soft-target enrichment
-> candidate pack
-> train split
-> trainer-owned calibration slice
-> untouched validation split
-> new checkpoint
-> re-evaluate
-> promotion gate
~~~

## Source contract

The source queue is the JSONL emitted by MSO-LAYA-M0.3 Disagreement Lab.

Only records already marked `fineTuneCandidate: true` can enter the training-ready lane in M0.6.

Every included record also needs a separate annotation with:

- a reviewed hard label,
- `labelSource` from human, verified outcome, or deterministic invariant,
- `reviewedAt`,
- a soft target,
- a `sourceRef` identifying where that soft target came from.

A hard label without a soft target is retained as `missing_soft_target`. It is not silently converted into a one-hot distribution.

## Why soft targets are required

Laya's RLCD fine-tuning recipe trains against gold probability distributions.

MADO therefore treats the reviewed hard label and the training distribution as different evidence objects.

The hard label answers:

> What outcome did review establish?

The soft target answers:

> What probability distribution should the training objective imitate?

The soft target argmax must agree with the reviewed label before a record is training-ready.

## Build a candidate pack

~~~bash
npm run mso -- finetune-pack   --queue evidence/disagreements/<lab>.jsonl   --annotations evidence/finetune/annotations.jsonl   --out-dir evidence/finetune/<pack>
~~~

Optional deterministic split controls:

~~~bash
  --validation-fraction 0.2   --split-seed mso-laya-2026-10
~~~

The split is grouped by `caseId`, so questions from the same state cannot leak across train and validation.

Within that constraint, cases are stratified by task family.

## Pack contents

~~~text
manifest.json
train.jsonl
validation.jsonl
held.jsonl
~~~

`train.jsonl` and `validation.jsonl` use Laya's case shape:

~~~json
{
  "state": "...",
  "questions": {
    "verdict": {
      "type": "choice",
      "instructions": "...",
      "criteria": {
        "accept": "...",
        "reject": "..."
      }
    }
  },
  "gold": {
    "verdict": {
      "label": "accept",
      "probabilities": {
        "accept": 0.82,
        "reject": 0.18
      }
    }
  }
}
~~~

The additional `_mado` field carries provenance and is ignored by the current Laya trainer.

## Held lane

A record can be held for:

- source not marked as a fine-tune candidate,
- missing annotation,
- explicit annotation exclusion,
- missing reviewed label,
- missing review provenance,
- missing soft target,
- missing soft-target provenance,
- target type mismatch,
- target argmax contradicting the reviewed label.

Held records are not training failures. They are unfinished evidence.

## Training boundary

MADO produces the candidate pack but does not invoke GPU training automatically.

With a current Laya checkout, the single-device recipe accepts the generated training JSONL:

~~~bash
python research/scripts/finetune_single_device.py   --data <pack>/train.jsonl   --model-dir <base-checkpoint>   --output-dir <candidate-checkpoint>
~~~

The current Laya trainer takes its calibration slice from the training input and fits per-type temperatures after training.

Do not pass `validation.jsonl` to that trainer.

Keep it untouched for post-training evaluation.

## Validation and re-entry

After training:

1. load the candidate checkpoint through the Laya provider,
2. evaluate it on held-out validation evidence,
3. compare it with the incumbent/base checkpoint,
4. inspect new disagreements,
5. run Promotion Gate again.

A new checkpoint does not inherit the old checkpoint's promotion status.

## Non-goals

M0.6 does not:

- synthesize one-hot targets from hard labels,
- use unreviewed disagreements as training truth,
- mix validation cases back into training,
- publish a checkpoint,
- change runtime authority,
- auto-promote the result.

Fine-tuning creates a new candidate, not a trusted provider.
