# MSO-DM-M0.6-RHO.P1 Open Pstack Intake / Evidence-Driven Engineering Gate

The early proposal called this M0.6.2, but that identifier is already used by the OpenCode dogfood PR #31. This independent extension is therefore **RHO.P1**.

This is a **stacked, non-activating extension** of MSO-DM-M0.6-RHO (#34). It reads evidence only. The existing `src/recursive-harness/lab.ts` remains the sole paired Codex / Free Agent evaluator. This module adds a version-pinned, manually reviewed Open Pstack candidate and an extra cost/latency/quality budget gate.

## What was inspected (2026-10-18)

- Project: [ericlitman/open-pstack](https://github.com/ericlitman/open-pstack), MIT.
- Release: 1.15.0; pinned commit: `9368993ea3d96b491833d53c0964b389e868162c`.
- `poteto-mode` SKILL.md blob: `dcab879a0cdb30b4885536bb9a3b90161808d765`.
- `reflect` SKILL.md blob: `a1d550b75af79b1ba57f56fe522953bdae612012`.
- `correct` SKILL.md blob: `c45e06f48a0982ae19f92c6e83a8cd05988097a3`.

These are Git blob IDs for the reviewed upstream snapshot, not fetched or cryptographically verified by this tool at runtime. A later upstream version fails the pinned-intake check until its diffs are reviewed and pins deliberately updated. No upstream code, skill file, runner, agent registry or model executable is vendored here.

**Security finding:** Upstream `plugins/pstack/hooks/hooks.json` defines a SessionStart command hook (including a Windows command). The real plugin also has provider runners capable of launching external models and skills that propose persistent instruction edits. Running it directly is a materially different security boundary, so this milestone **never installs or executes it**. No hooks, network, external commands, global configuration changes or autonomous skill invocation are allowed inside this intake gate.

## Running the zero-cost, offline smoke

From the repository root:

```bash
npm install --no-audit --no-fund
npm run typecheck
npm test
npm run pstack:gate -- fixtures/open-pstack/paired.synthetic.json /tmp/open-pstack-gate.json
```

The command writes to a **new** output path only (exclusive create) and does not overwrite an existing report. Change the path for repeat executions. The included fixture is explicitly synthetic and has a pending audit and no operator approval. It must produce `insufficient_evidence`, never a pass or performance claim.

## A/B evidence contract

Input is a single JSON file with schema `mso.open-pstack-trial.v0`:

1. `intake`: exact source commit, three allowlisted SKILL.md Git blob IDs, all execution capabilities denied, declared budget limits and a review status. `pending` is quarantined; `approved` requires a human review evidence SHA-256 digest. Such a digest is a **claim**, not a verified signature or trusted attestation.
2. `trial`: the same `Trial` contract as RHO: baseline and candidate probes for **both Codex and Free Agent**, identical fixture/policy/test plan/budget/seed per pair, independent verification, regression count, sandbox/network/side-effect claims, evidence digest and provenance. The candidate digest must equal `fingerprintPstackIntake(intake)`. It binds the measured candidate to this static configuration.
3. A report with the original RHO assessment, the extra quality/budget verdict, data digests and explicit no-activation flags. There is no provider routing change.

The gate rejects unsafe controls, an unreviewed pin, inconsistent comparison parameters, regressions, increased cost or latency beyond declared cumulative budgets, and insufficient verified success gain. Observed evidence that satisfies all criteria can reach only `review_required`. Synthetic evidence, missing pairs, an unapproved audit or missing operator approval remain `insufficient_evidence`.

`operatorApproved` and `audit.status=approved` **never** authorize activation, even together. They only indicate that the evidence packet can be reviewed. Release qualification, independent trusted attestations, sandbox enforcement, kill switch and rollback are separate gates outside this module.

## How to try a real supervised comparison later

Keep the original workflow unchanged as baseline. Separately, use a disposable, secret-free environment for the advisory candidate with no shared writable repo mount or inherited credentials. After reviewing the pinned skill texts for prompt injection and the command surface, run the **same tasks** in both cohorts. Verify the user-visible behavior independently; record measured costs/timings and hashed evidence references. Fill a new copy of the input JSON with `provenance: "observed"` *only* after real observations. A claim about `sandboxed` or `networkRestricted` is not enforcement. If live launch or installation is ever needed, make it a separate PR with a genuine OS/process isolation adapter and security review.

Do not treat these demo results as Codex, DeepSeek, GLM, Grok or Claude performance data. This work performs no model calls, so it has zero API token cost.

## Compatibility and limitations

- No changes to System One provider contracts, runtime policy, promotion gate, activation or the RHO evaluator.
- No `~/.codex/config.toml`, `AGENTS.md`, or plugin marketplace mutation.
- Gate reports are local evidence; not a trusted execution receipt. A fabricated observed probe or approved audit cannot be detected without an external attestor.
- Cost and latency comparisons here are total deltas across matched pairs, not normalized statistical confidence intervals. Do not interpret one small trial as a production readiness finding.
- Pinned SKILL.md files are *not* a blanket audit of nested playbooks, references or dynamically fetched content. The approved scope remains **advisory design patterns only**.
- Upstream license is MIT, but these original skills are referenced by commit/blob rather than copied. Preserve authors' attribution if future PRs vendor upstream content.
