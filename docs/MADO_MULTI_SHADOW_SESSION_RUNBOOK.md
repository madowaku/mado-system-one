# MADO Multi-Shadow Session / Shared Evidence

Status: MSO-DM-M0.2  
Date: 2026-10-03

## Goal

M0.2 lets one authoritative decision request be observed by multiple Decision Model providers without re-running the incumbent for every candidate.

```text
request
  |
  +----> incumbent --------------------> authoritative response
  |
  +----> shadow: Laya -----------------+
  +----> shadow: Clef-flash -----------+--> one shared session
  +----> shadow: Clef -----------------+        |
                                                +--> one review queue row
                                                +--> candidate pair traces
```

The incumbent remains the only source of runtime authority.

## Why this exists

The original `ShadowBridge` is intentionally pairwise:

```text
incumbent x candidate
```

That remains useful for one candidate.

Once the Decision Model provider matrix grows, naively stacking pairwise bridges would run the incumbent repeatedly, duplicate request capture, create separate review rows for the same human decision, and make it harder to prove that candidates observed the same request.

M0.2 adds `MultiShadowSession` above the existing pairwise contract.

## Runtime contract

`MultiShadowSession`:

- calls the incumbent once,
- starts all shadows concurrently,
- returns as soon as the incumbent finishes,
- never waits for shadow completion before returning authority,
- never substitutes a successful shadow when the incumbent fails,
- records shadow failures as evidence,
- writes one shared session after all observers settle.

At least two shadow providers are required. For one candidate, use the existing `ShadowBridge`.

Provider IDs must be unique across incumbent and shadows.

## Shared evidence schema

A session is written as:

```text
mso.multi-shadow.v0
```

It records:

- session and trace identity,
- authoritative provider,
- all shadow provider IDs,
- one request snapshot,
- one incumbent snapshot,
- one snapshot per shadow,
- aggregate agreement / disagreement counts,
- providers needing review,
- one `mso.shadow.v0` pair trace per candidate.

The pair traces are deliberate compatibility fixtures.

They allow M0.2 to gain shared capture without replacing the existing Promotion Gate evidence contract.

## One review row

`PartitionedMultiShadowEvidenceSink` writes:

```text
sessions.jsonl
review.jsonl
```

Every live request produces at most one shared review row, even if several candidates disagree.

The review row identifies all candidates that need attention and preserves each candidate's reason:

```text
disagreement
shadow_provider_error
incumbent_provider_error
```

This keeps human review centered on one decision event instead of duplicating the same context across provider-specific queues.

## Promotion compatibility

The Promotion Gate still consumes candidate-specific `mso.shadow.v0` JSONL.

Extract one provider from shared sessions:

```bash
npm run mso -- multi-shadow-extract \
  --sessions evidence/multi-shadow/sessions.jsonl \
  --provider clef-flash \
  --out evidence/shadow/clef-flash.jsonl
```

The extractor materializes only that provider's pair traces, preserving unique live `traceId` values.

The existing flow then remains:

```text
shared multi-shadow sessions
        |
        v
candidate extraction
        |
        v
mso.shadow.v0 JSONL
        |
        v
Promotion Gate
```

No new promotion semantics are introduced.

## Capture and privacy

M0.2 preserves the existing capture modes:

- `none`
- `minimal`
- `full`

A shared request is captured once per session.

The same `redactRequest` hook is available for full capture. Redaction changes evidence only; providers still receive the original request.

## Failure behavior

### One shadow fails

The incumbent response is unaffected.

The shared session records:

```text
failedShadows += 1
review.needed = true
reason = shadow_provider_error
```

### Incumbent fails

A successful shadow is never promoted into authority as an emergency substitution.

The caller receives the incumbent failure. After observers settle, the session still records the event and marks every candidate pair with `incumbent_provider_error`.

### Evidence sink fails

Observer errors are routed to `onObserverError`. They do not change the already selected authoritative response.

## Example runtime wiring

```ts
const session = new MultiShadowSession({
  incumbent,
  shadows: [laya, clefFlash, clef],
  sink: new PartitionedMultiShadowEvidenceSink({
    sessionPath: "evidence/multi-shadow/sessions.jsonl",
    reviewQueuePath: "evidence/multi-shadow/review.jsonl",
  }),
  capture: "minimal",
});

const decision = await session.decide(request);
```

The returned `decision` is always the incumbent result.

## Relationship to M0.1

M0.1 decides which candidates are eligible to enter SHADOW.

M0.2 provides the runtime observation harness.

```text
M0.1 bake-off
   |
eligible_for_shadow
   |
   v
M0.2 shared session
   |
live disagreement evidence
   |
human review
   |
existing Promotion Gate
```

M0.2 does not automatically instantiate every provider in the provider matrix. Candidate selection remains explicit and evidence-driven.

## Invariants

Every shared session records:

```text
shadowInfluencedExecution = false
labelsKnown = false
```

Every embedded pair trace also records:

```text
shadowInfluencedExecution = false
labelsKnown = false
```

There is no voting, ensemble authority, majority decision, automatic fallback, or automatic activation.

## M0.3 handoff

MSO-DM-M0.3 implements the Provider Evidence Ledger.

Shared sessions can now be compacted into hash-chained provider history, and later human / verified reviews can be joined back to the original shadow questions without rewriting observation events.

See `MADO_PROVIDER_EVIDENCE_LEDGER_RUNBOOK.md`.

## Next milestone

MSO-DM-M0.4 should retrieve only the relevant pattern / task-family portions of provider history and materialize a bounded Provider Suitability Context Pack. The pack remains evidence-only and must not activate or rank providers on its own.
