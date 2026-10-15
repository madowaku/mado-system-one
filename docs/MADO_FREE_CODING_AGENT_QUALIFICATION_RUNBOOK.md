# MSO-DM-M0.6 Free DeepSeek Qualification / Zero-Cost Coding Agent Lab

Status: evidence-only, non-authoritative, no hosted model invoked by CI.

## Separation of concerns

This lab measures whole coding-agent runs (implementation, tests, human review, latency and actual billing). It is NOT a SystemOneProvider typed-decision adapter. Existing MSO-DM-M0.0 to M0.4 and Laya promotion/canary policies are unchanged. Eligibility here means **shadow experiment only**, not routing permission or permission to merge/publish code.

Official model discovery: https://opencode.ai/zen/v1/models
OpenCode CLI: https://opencode.ai/docs/cli/
Zen pricing/privacy: https://opencode.ai/docs/zen/
Official DeepSeek model: https://www.deepseek.com/en/news/deepseek-v4-1-flash/

As of October 15, 2026 the public catalog lists the exact identifier deepseek-v4.1-flash-free in addition to the priced deepseek-v4.1-flash. The catalog is **not** a signed tariff or a guarantee that free access continues. A name containing "free" is not billing evidence. Default to unverified if pricing is unclear.

## Fast, completely offline dry-run

    npm install
    npm run dm:free-qualify -- --input fixtures/dm/free-deepseek.synthetic.json --out evidence/dm/free-deepseek.synthetic.result.json

The checked-in fixture is deliberately synthetic, with unverified pricing and no operator approval. Expect decision=insufficient_evidence, **never** eligible_for_shadow. The generated artifact contains no prompts, code, proprietary repository content, API keys, or raw model completions.

## Preparing a real paired bake-off

1. Confirm availability using OpenCode's `opencode models` list and the Zen catalog. Select `opencode/deepseek-v4.1-flash-free` exactly, not `opencode/deepseek-v4.1-flash`. Check price and terms separately and record an auditable pricing snapshot reference plus UTC checkedAt timestamp.
2. Prepare at least four PUBLIC or explicitly approved tasks, across at least two task families. Suggested groups: TypeScript refactor/tests, Godot logic/state verification, error-handling patch, documentation with automated checks. Pre-register expected tests and independent human review rubric. Never use private production repositories, credentials or unpublished assets in the initial free-tier trial.
3. Run both agents on IDENTICAL task snapshots in separate disposable workspaces, under the same time/tool budget. Do not give either agent write access to secrets or production resources. Restrict tools and review commands before execution. Example **manual** OpenCode invocation inside such a workspace:

       opencode run --model opencode/deepseek-v4.1-flash-free --format json "Solve the public fixture, then run the supplied tests."

   This writes or executes code through an agent, so do not automate it on trusted machines or privileged repos without sandboxing. Run the incumbent separately with equivalent constraints and keep exact snapshots.
4. Independently run the fixture-specific automated tests and complete human review. Collect sanitized references to the artifact, test log and review approval for each run. Record elapsedMs for the entire run, not only model generation time.
5. Check the **actual billing ledger** for each free-tier request and record billedUsd plus billingEvidenceRef. If no invoice evidence is available, use billedUsd=null and allow the gate to block. Compute is never declared zero-cost solely from API names, nominal token prices or the model catalog.
6. Copy the schema in fixtures/dm/free-deepseek.synthetic.json into a private, non-secret local input. Set cases exposure=approved_public, runs provenance=live, source references to real sanitized evidence, catalogProof.pricing=free only after operator price verification, and set both operatorReview flags true only after written approval.
7. Evaluate (pure offline; no model call or credential needed):

       npm run dm:free-qualify -- --input path/to/live-paired.json --out evidence/dm/free-deepseek.live.json

Store the report as a PR/check artifact, not as production routing configuration.

## Record shape and safeguards

- Each case needs id, taskFamily, exposure and artifactRef. Paired runs are keyed by caseId + providerId; missing pairs are visible, duplicate pairs error out. Unknown fields are rejected to keep raw prompts/code out of the evidence input.
- Each run records provenance=synthetic|live, testStatus, reviewStatus, evidence references for passes, artifactRef, elapsedMs, billedUsd (number or null), and billingEvidenceRef for bill verification.
- A successful run requires BOTH tests and independent human review with references. Unreviewed model output is not accepted as a success.
- Only paired LIVE runs on approved_public tasks contribute to qualification. Synthetic cases may test the harness but never satisfy minimum evidence.
- Default sample policy: minLivePairs=4, minLiveTaskFamilies=2, minVerifiedPassRate=0.8, maxRegressionRate=0.1, maxP95ElapsedMs=120000, maxTotalBilledUsd=0. Policy bounds are provisional, NOT empirically validated.
- The exact free ID, catalog availability and pricing attestation, data handling approval, task coverage, quality, regressions, speed, full cost evidence and real billed spend all gate eligibility.
- A passing result is eligible_for_shadow only. The evaluator **never** selects a live provider, merges a PR, or gives an agent decision/production authority. Its evidence declares automaticRoutingDecision=false, automaticProviderPromotion=false and productionAuthorityChange=false.
- Reports are reproducible, deterministic for a fixed input, and intentionally contain only sanitized evidence pointers. Operator-provided proof references are assertions and must be externally audited. This lab does not cryptographically verify invoices or guarantee a vendor's future tariff.

## Next qualification increment

M0.6.1 could add opt-in, ephemeral-workspace OpenCode subprocess execution with explicit permissions, independent state-to-test verification, signed billing snapshots and a CI-supported real paired task manifest. Do not add automatic routing until repeatable live evidence and a separate reviewed routing policy exist.
