# MADO Provider Evidence Ledger / Longitudinal Decision Memory

Status: MSO-DM-M0.3  
Date: 2026-10-03

## Goal

M0.3 turns live multi-shadow evidence into durable provider memory.

The ledger answers questions such as:

- how often has this provider been observed on this decision surface?
- where does it fail?
- how fast is it over time?
- which patterns or task families produce disagreement?
- which disagreements were later reviewed?
- when reviewed, how often was the shadow accepted?
- what cost and confidence evidence exists?

It does **not** answer "which provider should automatically run next" by itself.

```text
M0.2 multi-shadow sessions
          |
          v
  compact observations
          |
          +------> review records
          |             |
          v             v
   Provider Evidence Ledger
          |
          v
 longitudinal snapshot
          |
   human / later router context
```

## Storage boundary

The ledger is intentionally compact.

It does not copy raw prompt/state content from live sessions. It stores provider evidence:

- session / trace identity,
- provider and role,
- pattern,
- task family when available,
- status and error,
- latency,
- provider-reported estimated cost,
- agreement / disagreement counts,
- question IDs and types,
- confidence observations,
- review references and labels.

This keeps the long-lived decision memory focused on operational evidence rather than becoming a second raw conversation archive.

## Registry contract

The file schema is:

```text
mso.provider-evidence-ledger.v0
```

The registry is scoped to one `decisionSurface` and records:

```text
runtimeAuthorityManaged = false
```

Events are append-only and SHA-256 hash chained:

```text
sessions_ingested
      |
      v
sessions_ingested
      |
      v
reviews_ingested
```

Editing historical event data breaks chain verification.

Duplicate session IDs and duplicate review keys are rejected.

A review must match an already observed shadow question:

```text
traceId + questionId + shadowProviderId
```

Orphan labels are rejected rather than silently polluting provider history.

## Initialize a ledger

```bash
npm run mso -- provider-ledger-init \
  --ledger evidence/provider-ledger/asset-qa.json \
  --ledger-id asset-qa-provider-memory \
  --surface asset.qa
```

Creation is exclusive. An existing ledger is not overwritten.

## Ingest shared sessions

```bash
npm run mso -- provider-ledger-ingest-sessions \
  --ledger evidence/provider-ledger/asset-qa.json \
  --sessions evidence/multi-shadow/sessions.jsonl \
  --source-ref multi-shadow:asset-qa:2026-10-03
```

If the M0.2 session used full capture and request metadata contains `taskFamily`, that value is preserved.

For minimal capture, a batch fallback can be supplied:

```bash
npm run mso -- provider-ledger-ingest-sessions \
  --ledger evidence/provider-ledger/asset-qa.json \
  --sessions evidence/multi-shadow/sessions.jsonl \
  --source-ref multi-shadow:asset-qa:2026-10-03 \
  --task-family asset.qa
```

The ledger stores one incumbent observation per session and one shadow observation per candidate.

## Ingest reviewed outcomes

The existing Promotion review format is reused:

```text
mso.review.v0
```

Ingest:

```bash
npm run mso -- provider-ledger-ingest-reviews \
  --ledger evidence/provider-ledger/asset-qa.json \
  --reviews evidence/reviews/asset-qa.jsonl \
  --source-ref human-review:asset-qa:2026-10-03
```

For longitudinal reviewed accuracy:

- `shadow_correct` counts as reviewed-correct,
- `both_acceptable` counts as reviewed-correct,
- `incumbent_correct` counts as reviewed-incorrect for the shadow,
- `neither` counts as reviewed-incorrect for the shadow.

The original review label and source are still retained, so later analysis can distinguish human, verified outcome, and deterministic invariant evidence.

## Derived memory

Show current derived state:

```bash
npm run mso -- provider-ledger-show \
  --ledger evidence/provider-ledger/asset-qa.json
```

Inspect one provider:

```bash
npm run mso -- provider-ledger-show \
  --ledger evidence/provider-ledger/asset-qa.json \
  --provider clef-flash
```

Write a portable derived snapshot:

```bash
npm run mso -- provider-ledger-show \
  --ledger evidence/provider-ledger/asset-qa.json \
  --out evidence/provider-ledger/asset-qa.snapshot.json
```

The snapshot derives, per provider:

- observation count,
- incumbent vs shadow count,
- success/error rate,
- p50/p95 wall latency,
- cost samples / total / average,
- comparable questions,
- agreement/disagreement rate,
- review-needed observations,
- confidence sample count / mean,
- reviewed questions / reviewed accuracy,
- slices by pattern,
- slices by task family,
- disagreement clusters,
- ingestion-event timeline.

## Disagreement clusters

Question-level comparison evidence is compacted into longitudinal clusters such as:

```text
gate::verdict::choice
route::owner::choice
score::quality::score
```

Each provider cluster records:

- comparable observations,
- disagreements,
- disagreement rate,
- reviewed questions,
- shadow-correct,
- incumbent-correct,
- both-acceptable,
- neither.

This is descriptive memory. A high disagreement rate is not automatically "bad". It may reveal a provider that catches incumbent mistakes, a changed workload, or a broken provider.

## Timeline semantics

Each `sessions_ingested` event becomes a provider evidence window.

This makes it possible to compare:

```text
batch 001 -> latency / error / disagreement
batch 002 -> latency / error / disagreement
batch 003 -> latency / error / disagreement
```

Reviews can arrive later. Derived snapshots join later review labels back onto the historical observations without rewriting the original observation events.

## Concurrency and durability

File writes use:

- exclusive writer lock,
- atomic temp-file replacement,
- registry verification before and after mutation.

The design follows the existing checkpoint and baseline lineage durability style but remains a separate evidence axis.

Checkpoint lineage answers:

> which model generation is this?

Baseline lineage answers:

> which workload world was accepted?

Provider Evidence Ledger answers:

> how has this provider actually behaved over time?

## Authority boundary

Every derived state records:

```text
runtimeAuthorityManaged = false
automaticRoutingDecision = false
```

The ledger may become context for a later routing decision, but it never changes routing itself.

There is no universal provider score, leaderboard, automatic winner, or implicit promotion.

## Example lifecycle

```text
M0.1 labeled bake-off
       |
eligible_for_shadow
       |
       v
M0.2 live multi-shadow
       |
       v
M0.3 Provider Evidence Ledger
       |
       +--> latency history
       +--> error history
       +--> cost history
       +--> disagreement clusters
       +--> reviewed outcomes
       +--> pattern/task-family slices
       |
       v
durable longitudinal decision memory
```

## M0.4 handoff

MSO-DM-M0.4 implements bounded Provider Evidence Retrieval.

A caller can now request one pattern / task-family context and materialize an evidence-only `mso.provider-suitability-context.v0` pack. The pack pins the source ledger head hash, preserves no raw request state, and refuses implicit provider truncation.

See `MADO_PROVIDER_EVIDENCE_RETRIEVAL_RUNBOOK.md`.

## Next milestone

MSO-DM-M0.5 can consume this pack inside an explicit router policy and produce an explainable provider selection. Selection must remain policy-scoped, reversible, and separate from the evidence pack itself.
