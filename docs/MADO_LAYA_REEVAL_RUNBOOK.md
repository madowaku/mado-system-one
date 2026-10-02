# MADO Laya Candidate Re-eval Runbook

Version: v0.1
Status: Candidate re-evaluation baseline
Date: 2026-10-02

## Purpose

MSO-LAYA-M0.7 closes the first learning loop:

~~~text
reviewed disagreement
-> fine-tune candidate pack
-> candidate checkpoint
-> ONNX materialization
-> held-out re-evaluation
-> regression slices
-> Promotion Gate
~~~

A fine-tuned checkpoint is a new candidate. It does not inherit trust, calibration, or promotion state from its base checkpoint.

## 1. Rebuild the M0.6 pack

M0.7 needs the evaluation contract embedded by the current M0.6 compiler.

Regenerate the pack if its `validation.jsonl` predates M0.7.

The validation rows now preserve, under `_mado.evaluation`:

- original MADO pattern,
- original typed questions,
- reviewed expected answers.

That metadata exists only for re-evaluation. Laya training still consumes the normal `state / questions / gold` fields.

## 2. Fine-tune

Train only on `train.jsonl`.

Keep `validation.jsonl` untouched.

The current Laya trainer owns its separate calibration slice inside training data.

## 3. Materialize an ONNX candidate

The Python fine-tune script saves a PyTorch checkpoint. The MADO TypeScript Laya adapter evaluates ONNX checkpoints.

Use Laya's exporter:

~~~bash
python laya-ts/scripts/export_onnx.py \
  --model-dir <candidate-pytorch-checkpoint> \
  --out-dir <candidate-onnx-checkpoint>
~~~

The exporter writes the artifacts expected by `laya-ts`, including:

- `encoder.onnx`
- `head.onnx`
- `rl_agent_config.json`
- tokenizer data

Do not bypass export verification for normal candidate evaluation.

The base checkpoint used for the comparison must also be available in the same ONNX-compatible form.

## 4. Re-evaluate

~~~bash
npm run mso -- candidate-reeval \
  --validation evidence/finetune/<pack>/validation.jsonl \
  --base-checkpoint <base-onnx-checkpoint> \
  --candidate-checkpoint <candidate-onnx-checkpoint> \
  --model english \
  --out-dir evidence/reeval/<candidate>
~~~

Optional controls include:

~~~text
--lang <code>
--device <cpu|cuda|dml>
--base-id <provider-id>
--candidate-id <provider-id>
--base-ref <human checkpoint ref>
--candidate-ref <human checkpoint ref>
--incumbent-eval <same-holdout eval.json>
--dataset <dataset-id>
~~~

## 5. Checkpoint identity

M0.7 fingerprints every local checkpoint from its required artifacts.

The evidence stores per-artifact SHA-256 plus a combined checkpoint fingerprint.

Model names such as `english` are routing names, not checkpoint identities.

Two checkpoints with the same routing name must still produce different fingerprints when their artifacts differ.

## 6. Output bundle

~~~text
summary.json
validation.eval.jsonl
base.eval.json
candidate.eval.json
incumbent.eval.json       # only when supplied
regressions.jsonl
~~~

`candidate.eval.json` is valid labeled offline evidence for M0.5 Promotion Gate.

`validation.eval.jsonl` is the reconstructed MADO fixture, making the holdout reusable by future providers.

## 7. What is measured

The summary includes:

- base and candidate accuracy,
- case accuracy,
- provider errors,
- p50 and p95 harness latency,
- cost,
- candidate-vs-base deltas,
- optional candidate-vs-incumbent deltas,
- question transitions,
- regression and improvement counts,
- confidence coverage,
- mean confidence,
- Brier score,
- 10-bin ECE.

Regression slices are emitted for:

- task family,
- question type,
- language,
- tags,
- overall workload.

A candidate can improve overall accuracy and still contain unacceptable regressions in a critical slice. M0.7 reports both.

## 8. Regression semantics

Question transitions are classified as:

- improved,
- regressed,
- stable correct,
- stable wrong,
- candidate provider error,
- base provider error,
- both provider error.

`regressions.jsonl` contains cases where the base was correct and the candidate became wrong or unavailable.

This is intentionally stricter than reporting aggregate accuracy alone.

## 9. Promotion re-entry

After reviewing M0.7 evidence, run Promotion Gate using the candidate eval:

~~~bash
npm run mso -- promotion-check \
  --policy <candidate-specific-policy.json> \
  --eval evidence/reeval/<candidate>/candidate.eval.json \
  ...
~~~

The policy's `candidateProviderId` must match the re-evaluated candidate provider id.

A candidate checkpoint begins a new evidence chain. Prior promotion eligibility is not inherited.

## 10. Non-goals

M0.7 does not:

- train the checkpoint,
- choose acceptable regression thresholds globally,
- auto-approve a candidate,
- auto-switch runtime authority,
- treat improved average accuracy as proof that every slice improved.

Re-evaluation measures the new candidate. Promotion remains a separate gate.
