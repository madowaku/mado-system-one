# MADO Cross-Provider Calibration / Shadow Bake-off

Status: MSO-DM-M0.1  
Date: 2026-10-03

## Goal

M0.1 turns a multi-provider comparison into a reviewed entry gate for live SHADOW.

It does not choose a universal "best model" and it does not change runtime authority. Instead it answers a narrower question:

> Does this provider have enough labeled evidence, reliability, calibration coverage, and operational headroom to justify collecting non-authoritative live shadow evidence on this decision surface?

The existing lifecycle remains authoritative:

```text
labeled fixture
    |
    v
cross-provider bake-off
    |
    +--> blocked
    |
    +--> insufficient evidence
    |
    +--> eligible_for_shadow
              |
              v
       existing ShadowBridge
              |
       human disagreement review
              |
       existing Promotion Gate
```

## Calibration contract

MADO keeps probability semantics and confidence semantics visible. M0.1 therefore does not blindly compare every provider's `confidence` field.

For correctness-alignment calibration it uses:

| Question type | Calibration confidence |
| --- | --- |
| choice | probability assigned to the selected option |
| noul | probability assigned to the predicted yes/no side |
| score | provider-reported confidence only |

Every calibration summary records a `sourceCounts` map so an ECE or Brier number cannot lose its provenance.

The output includes:

- confidence coverage,
- accuracy on covered questions,
- mean confidence,
- Brier score,
- 10-bin ECE,
- signed confidence-minus-accuracy gap,
- reliability bins,
- slices by pattern,
- slices by task family,
- slices by question type.

For `provider_defined` confidence, these metrics are evidence about correctness alignment on the named dataset. They are not proof that two providers' internal confidence quantities have identical meaning.

## Shadow entry policy

The gate is policy-driven. There are no universal thresholds.

`fixtures/dm/shadow-bakeoff.example-policy.json` demonstrates:

```json
{
  "schemaVersion": "mso.dm-shadow-policy.v0",
  "policyId": "smoke-shadow-entry-example",
  "minQuestions": 4,
  "minAccuracy": 0.75,
  "maxProviderErrorRate": 0.1,
  "minCalibrationCoverage": 0.75,
  "maxEce10": 0.25,
  "maxBrier": 0.2,
  "minComparableQuestionsWithIncumbent": 4,
  "maxReviewLoadRate": 0.5
}
```

Evidence sufficiency checks are distinct from quality checks.

A provider can therefore be:

- `reference_incumbent`
- `eligible_for_shadow`
- `blocked`
- `insufficient_evidence`

Missing calibration coverage is not silently treated as good calibration.

## Disagreement is review load, not correctness

A candidate that disagrees with the incumbent can be valuable. That is the point of SHADOW.

M0.1 records incumbent pair statistics:

- comparable questions,
- agreements,
- disagreements,
- agreement rate,
- estimated review-load rate,
- mean answer delta where meaningful,
- mean confidence delta where available.

`maxReviewLoadRate` is optional and represents an operational review-capacity constraint, not a claim that disagreement itself is bad.

## CLI

Offline smoke:

```bash
npm run mso -- dm-bakeoff fixtures/eval/smoke.jsonl \
  --providers replay,laya,clef-flash \
  --incumbent replay \
  --policy fixtures/dm/shadow-bakeoff.example-policy.json \
  --out evidence/dm/smoke-bakeoff.json
```

For Clef or Clef-flash, the M0.0 credential contract still applies:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_AUTH_TOKEN
```

The command writes one `mso.dm-bakeoff.v0` artifact containing the underlying `mso.compare.v0` evidence, provider calibration summaries, per-check results, and explicit non-authoritative shadow plans for passing candidates.

## Safety invariants

Every M0.1 artifact records:

```text
automaticSelection = false
runtimeAuthorityChange = false
requiresHumanReview = true
shadowInfluencedExecution = false
automaticActivation = false
```

A passing bake-off is only permission to gather live SHADOW evidence.

It is not:

- production activation,
- threshold transfer,
- calibration certification,
- provider-wide approval,
- a Promotion Gate pass.

## Recommended bake-off shape

Run the same fixture across at least:

```text
incumbent / replay baseline
Laya
Clef-flash
Clef
```

Then inspect by decision pattern rather than aggregate score alone.

A provider may be appropriate for ROUTE and poor for GATE. MADO keeps those differences visible in calibration slices and leaves later authority to the existing pattern-scoped Promotion Gate.

## Next milestone

MSO-DM-M0.2 should make live multi-shadow collection practical:

```text
one incumbent
   |
   +--> shadow A
   +--> shadow B
   +--> shadow C
             |
       shared evidence session
             |
       disagreement triage
```

That would let Clef, Clef-flash, Laya, and future Jev providers observe the same live request without serially rebuilding separate ShadowBridge sessions.
