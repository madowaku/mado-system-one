# MADO Provider Evidence Retrieval / Suitability Context Pack

Status: MSO-DM-M0.4  
Date: 2026-10-03

## Goal

M0.4 retrieves the smallest useful slice of Provider Evidence Ledger history for an incoming decision context.

The input is descriptive:

```text
decision surface
pattern
task family
explicit provider set (optional)
```

The output is:

```text
mso.provider-suitability-context.v0
```

It is an evidence pack, not a router decision.

## Why retrieval is separate from routing

M0.3 can accumulate years of provider history. Passing the entire ledger into every decision would be expensive, noisy, and privacy-unfriendly.

M0.4 creates a bounded retrieval plane:

```text
Provider Evidence Ledger
        |
        v
context query
        |
        +--> exact pattern + task family
        +--> pattern history
        +--> task-family history
        +--> overall history
        |
        v
Suitability Context Pack
        |
        X  no automatic selection
```

The pack describes available evidence. A later policy may consume it.

## Context layers

Each requested provider receives four descriptive scopes.

### exactContext

Evidence matching:

```text
pattern == query.pattern
AND
taskFamily == query.taskFamily
```

If no task family is requested, exact context is the pattern context.

### patternContext

All evidence for the requested System One pattern.

### taskFamilyContext

All evidence for the requested task family, regardless of pattern.

This field is omitted when the query has no task family.

### overallContext

All observations for the provider on the ledger's decision surface.

The layers are kept separate rather than blended into a hidden suitability score.

## Evidence status

A provider is described as one of:

```text
no_matching_evidence
observed_unreviewed
observed_reviewed
```

This status applies to the exact context only.

A provider can therefore have strong overall history but still return:

```text
exactContext.observations = 0
evidenceStatus = no_matching_evidence
matchScope = pattern_only
```

MADO does not infer that evidence from another workload automatically transfers.

## Match scope

The pack also records the best factual scope that exists:

```text
pattern_and_task_family
pattern_only
task_family_only
overall_only
no_evidence
```

This is descriptive provenance, not a quality grade.

## Bounded retrieval

Default limits are:

```text
maxProviders                      = 8
maxRecentWindowsPerProvider       = 3
maxDisagreementClustersPerProvider = 5
```

A caller may lower or raise them explicitly.

If the ledger contains more providers than `maxProviders`, MADO does **not** silently take the first N or create a ranking.

Instead it fails and requires an explicit provider set:

```text
--providers laya,clef-flash,clef
```

Provider order inside the pack is always:

```text
lexicographic
```

The pack records:

```text
automaticProviderRanking = false
```

## Recent windows

Recent windows are filtered to the exact requested context and then bounded.

Each window preserves:

- source event ID,
- event timestamp,
- source reference,
- metrics for that provider in that context.

This lets downstream reasoning see whether current evidence differs from older aggregate history without receiving the full ledger.

## Disagreement clusters

Clusters are also built only from the exact context.

They retain:

- pattern,
- question ID,
- question type,
- comparable observations,
- disagreements,
- disagreement rate,
- reviewed outcomes.

The bounded cluster list is ordered by observed disagreement frequency inside one provider. This is only intra-provider evidence compression. It does not rank providers against one another.

## Source references

Every provider entry includes the source references that contributed to its exact context:

```text
multi-shadow:asset-qa:batch-001
human-review:asset-qa:001
```

This keeps the compact pack inspectable and traceable back to durable evidence.

## Ledger-head pinning

Every context pack records:

```text
ledgerHeadEventHash
```

This tells a future router exactly which ledger state produced the evidence.

If the ledger advances after pack generation, the old pack remains a valid historical artifact but can be detected as stale by comparing head hashes.

M0.4 itself does not reject historical packs. Freshness policy belongs to the consumer.

## Privacy boundary

The Provider Evidence Ledger already excludes raw request state.

M0.4 further materializes only metrics, question-level cluster identifiers, source refs, and bounded timeline evidence.

Raw prompt or state content is not copied into the context pack.

## CLI

Generate a pack:

```bash
npm run mso -- provider-context \
  --ledger evidence/provider-ledger/asset-qa.json \
  --pattern gate \
  --task-family asset.qa \
  --providers laya,clef-flash,clef \
  --out evidence/provider-context/asset-qa-gate.json
```

Optional bounds:

```bash
  --max-providers 4 \
  --max-windows 2 \
  --max-clusters 3
```

If `--providers` is omitted and the ledger fits under the provider bound, all observed providers are included in lexicographic order.

An explicitly requested provider that has never been observed is retained with:

```text
matchScope = no_evidence
evidenceStatus = no_matching_evidence
```

This is useful for comparing known evidence with a new candidate without pretending evidence exists.

## Authority invariants

Every pack records:

```text
evidenceOnly = true
providerOrder = lexicographic
automaticProviderRanking = false
automaticRoutingDecision = false
runtimeAuthorityManaged = false
requiresPolicyDecision = true
```

The parser rejects packs that violate these invariants.

There is no:

- provider score,
- winner field,
- recommended provider,
- automatic fallback,
- automatic activation,
- runtime authority mutation.

## Example shape

```json
{
  "schemaVersion": "mso.provider-suitability-context.v0",
  "decisionSurface": "asset.qa",
  "query": {
    "pattern": "gate",
    "taskFamily": "asset.qa",
    "providerIds": ["clef-flash", "laya"]
  },
  "providers": [
    {
      "providerId": "clef-flash",
      "evidenceStatus": "observed_reviewed",
      "matchScope": "pattern_and_task_family",
      "exactContext": {
        "scope": "exact",
        "metrics": {}
      }
    }
  ],
  "evidenceOnly": true,
  "automaticProviderRanking": false,
  "automaticRoutingDecision": false
}
```

The metrics object is omitted here for brevity in the documentation. Runtime artifacts contain the full metric contract.

## Relationship to M0.0 through M0.3

```text
M0.0 provider intake
   |
M0.1 offline calibration / SHADOW entry
   |
M0.2 shared live observation
   |
M0.3 longitudinal provider memory
   |
M0.4 bounded evidence retrieval
   |
   X no selection yet
```

This keeps memory, retrieval, and authority as separate concerns.

## Next milestone

MSO-DM-M0.5 can introduce an **Evidence-Aware Router Policy / Explainable Provider Selection**.

That policy should consume a pinned M0.4 context pack and an explicit workload policy, then emit:

```text
selected provider
alternatives considered
evidence references
policy checks
selection explanation
fallback contract
```

Selection should be reversible and policy-scoped. M0.4 remains evidence-only.
