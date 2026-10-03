# MADO Decision Model Provider Matrix

Status: MSO-DM-M0.0  
Date: 2026-10-03

## Purpose

MADO System One now treats decision models as a provider class rather than a single-model bet.

The provider matrix separates four things that are easy to blur together:

1. upstream model capability,
2. adapter capability actually exposed by MADO,
3. probability and confidence semantics,
4. MADO workload calibration and promotion evidence.

Wire compatibility is not semantic compatibility. A provider can use the same System One request/response shape and still require independent calibration, thresholds, shadow evidence, and promotion gates.

## Current matrix

| Provider | Adapter | Transport | Upstream modality | MADO modality | Context | Max questions | Calibration |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| Laya | implemented | local `laya-ts` | text | text | provider-defined | provider-defined | unknown |
| Clef | implemented | Workers AI / System One | text + vision | text | 65,536 | 64 | unknown |
| Clef-flash | implemented | Workers AI / System One | text + vision | text | 65,536 | 64 | unknown |
| Jev | planned | System One API | text | none yet | not pinned here | not pinned here | unknown |

The machine-readable source is `src/providers/matrix.ts`.

## Clef intake boundary

Cloudflare documents Clef and Clef-flash as System One / Jev API compatible. They accept `choice`, `score`, and `noul` questions, with up to 64 questions per request and a 65,536-token context window. The hosted models also support images.

MSO-DM-M0.0 intentionally exposes only text.

That boundary is deliberate:

- model capability does not automatically become MADO runtime authority,
- image payload handling needs its own privacy, size, provenance, and replay contract,
- multimodal evals need representative fixtures before activation,
- thresholds from Jev, Laya, demos, or Cloudflare benchmarks are not imported.

A later media bridge can promote Clef's adapter modality from `text` to `text+vision` only after those contracts exist.

## Clef provider contract

`src/providers/clef.ts` adds:

- `ClefSystemOneProvider`,
- System One question translation,
- typed answer translation back into MADO `DecisionResponse`,
- score-offset restoration for non-zero MADO score ranges,
- direct-logit probability semantics,
- provider-defined confidence semantics,
- unknown MADO calibration status,
- an injectable `ClefRunner`,
- a Cloudflare Workers AI REST runner,
- a provider factory for `clef` and `clef-flash`.

The adapter accepts Cloudflare's Workers AI response envelope and keeps credentials outside evidence.

## Cloudflare transport

The REST runner uses:

```text
POST /client/v4/accounts/{account}/ai/run/@cf/cloudflare/clef
POST /client/v4/accounts/{account}/ai/run/@cf/cloudflare/clef-flash
```

Required environment variables for the CLI are:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_AUTH_TOKEN
```

No credential is written into a `DecisionResponse`.

## CLI bake-off

Once credentials are present, the existing eval and comparison spine can include either hosted model:

```bash
npm run mso -- eval fixtures/eval/smoke.jsonl --provider clef-flash

npm run mso -- compare fixtures/eval/smoke.jsonl \
  --providers replay,laya,clef-flash \
  --out evidence/compare/replay-laya-clef-flash.json
```

This is evidence generation, not promotion.

## Provider semantics

Clef is recorded as:

```text
inferenceFamily      = hybrid
probabilitySemantics = direct_logits
confidenceSemantics  = provider_defined
calibrationStatus    = unknown
```

Cloudflare describes Clef as a frozen Qwen backbone plus schema-specific routing/scoring and low-rank adapters. The decision step scores valid schema choices in parallel rather than generating free-form output token by token.

MADO therefore does not label the provider as a normal generative LLM or copy Laya's confidence semantics.

## Commercial snapshot

As of 2026-10-03, Cloudflare's Workers AI pricing page lists:

- Clef: USD 0.24 per million input tokens,
- Clef-flash: USD 0.09 per million input tokens.

These numbers are registry metadata only. They are not hard-wired into runtime cost accounting because provider pricing can change. Runtime cost is recorded only if the provider response supplies an explicit cost.

## Sources

- https://blog.cloudflare.com/clef-decision-models/
- https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/
- https://developers.cloudflare.com/workers-ai/models/clef/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://huggingface.co/Cloudflare/clef

## M0.1 bake-off bridge

MSO-DM-M0.1 is implemented in `src/eval/bakeoff.ts` and `docs/MADO_DECISION_MODEL_BAKEOFF_RUNBOOK.md`.

It reuses the existing comparison spine, adds correctness-alignment calibration with explicit confidence provenance, and emits policy-gated non-authoritative SHADOW plans. It does not introduce a second promotion lifecycle.

## Next gate

MSO-DM-M0.2 should let one incumbent feed multiple shadow providers inside one shared evidence session so Laya, Clef, Clef-flash, and future Jev adapters can observe identical live requests with one review queue.
