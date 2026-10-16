# MSO-DM-M0.6.1 Multi-Free Coding Agent Bake-off / DeepSeek × GLM Qualification

Status: **offline qualification harness**, no actual hosted model calls and no automatic model assignment.

This builds on MSO-DM-M0.6's verified-result / billing-proof gate. It is **not** a replacement for MADO's SystemOneProvider decision interface.

## Exact identities and temporary availability

OpenCode console documents two separate limited-time free routes on 2026-10-16:

- `opencode/deepseek-v4.1-flash-free` (model ID `deepseek-v4.1-flash-free`)
- `opencode/glm-5.3-flash-free` (model ID `glm-5.3-flash-free`)

Canonical official listing and pricing: https://opencode.ai/v2/docs/console/models/
The unqualified aliases `opencode/deepseek-v4.1-flash` and `opencode/glm-5.3-flash` are **paid models**. Do not silently replace the free routes with them. Refresh catalog and recheck the free window immediately before each live run. Report `pricing=unverified` until a human verifies the current free tariff, and `billedUsd=null` until an actual billing entry is verified. Temporary zero-priced input/output rates are **not** proof that a specific execution did not incur usage fees.

OpenCode describes zero-retention and no-model-training handling for these two free routes, but free availability and provider terms may change. Initial external experiments must remain explicitly approved public data in disposable, least-privilege sandboxes.

## Dry-run: zero external cost, zero routing authority

    npm install
    npm run typecheck && npm test
    npm run dm:multi-free-bakeoff -- --input fixtures/dm/multi-free.synthetic.json --out evidence/dm/multi-free.synthetic.json

The example covers two TypeScript/Godot cases and three agents per case, but ALL runs are synthetic, billing is null, and approvals are false. It must return `insufficient_evidence` even when every fake test passes.

A useful second check is `npm run dm:free-qualify`, which remains compatible with the original M0.6 input schema.

## Full public live trial protocol (manual, opt-in)

1. Pre-register at least four independently reviewable public tasks spanning TypeScript and Godot. Capture `snapshotRef`, `instructionRef`, `testPlanRef`, `budgetRef` for each. Use immutable digests where possible, never raw prompts or source in the evidence manifest. Define precise expected behavior **before** agent execution. Include failure-mode and runtime-state tests for Godot.
2. Check OpenCode's free model availability and price immediately before launch. Capture a dated operator-proof reference per candidate. Record evaluation timestamp in UTC and set a catalog-age policy (24h example). Check / update terms if the free offering expires.
3. For each pre-registered case, clone the same **read-only public fixture snapshot into three disposable workspaces**, and run Codex (fixed incumbent model and plan), DeepSeek, and GLM with exactly the same instruction/test plan/budget. Limit tool capabilities, network, elapsed time, and file writes. Do not give candidates repository secrets or direct CI/CD credentials.
4. For example, inside the isolated OpenCode workspaces (manual commands; **not executed by this test suite**):

       opencode models opencode --refresh
       opencode run -m opencode/deepseek-v4.1-flash-free "Solve the public fixture and execute its tests."
       opencode run -m opencode/glm-5.3-flash-free "Solve the same public fixture and execute its tests."

   These two invocations must take place in **separate clean copies** and have identical task instructions. Capture the exact incumbent Codex model/version separately; `codex-reference` in fixtures is a placeholder, not a measured model. Human operators should run agents with restricted tool permissions.
5. Run an independent harness from a clean checkout, record test evidence, then require human review of each artifact. Measure total elapsed time, not model-token generation time. Record status as `not_run` for missing independent checks, never invent PASS.
6. Verify invoice/usage history **per run**. Add `billedUsd` and `billingEvidenceRef`, or use null if no verifiable entry is present. Collect operator approval references for both workspace isolation and public-data permissions.
7. Assemble the exact `mso.multi-free-bakeoff-input.v0` manifest. Replace all synthetic provenance with live evidence only where it genuinely occurred. Evaluate with:

       npm run dm:multi-free-bakeoff -- --input path/to/approved-paired-live.json --out evidence/dm/multi-free.live.json

8. Review the report. `eligible_for_reviewed_shadow` only means operators can **consider** a subsequent shadow trial. It must not trigger automatic task routing, agent execution, PR merging, publishing, or workload expansion.

## Fairness and evidence contracts

- A case is included in the **live cohort only if Codex, DeepSeek and GLM all produced a live run for that exact approved-public case**. One missing candidate excludes that case from *everyone's* score; missing run pairs remain explicitly visible.
- Any recorded **live run on an unapproved/synthetic-only case blocks the whole bake-off**, even if enough other approved cases exist.
- Every run must match the case's snapshot/instruction/test-plan/budget references. Mismatch throws an error and cannot yield a ranking or promote a candidate.
- Existing M0.6 checks apply independently to each candidate **using the same complete live cohort**, including exact model identity, fresh catalog evidence, approved data/isolation, verified test + human review, minimum paired cases and task families, regression rate, p95 elapsed time, actual billing coverage and zero-spend threshold.
- Pairwise results are **descriptive**: firstWins, secondWins, bothPass, bothFail, and each candidate's p95 elapsed time. The report also includes per-task-family verified pass rate and latency for Codex, DeepSeek and GLM on matched live cases. They are not a validated statistical superiority claim or authority to rank or route providers.
- Multiple comparable observations and more extensive real workloads are necessary before drawing a significant conclusion; minLivePairs=4 is an early smoke threshold, not evidence of general quality.
- Current allowlist comprises only the two exact free model IDs. New model variants need explicit registration and fresh review; no guessing from model-name suffixes.
- Strict schemas forbid unknown prompt/code fields and duplicate run identities. Report holds references to evidence, not raw model completions or proprietary code.
- Every output declares `automaticProviderRanking=false`, `automaticRoutingDecision=false`, `automaticProviderPromotion=false`, `productionAuthorityChange=false`.

## Next

For M0.6.2, build an explicitly operator-authorized, sandboxed, ephemeral OpenCode execution probe with reproducible test snapshots and usage-proof collection. A separate approval gate should precede any real task routing. CI must remain offline and cost-free by default.
