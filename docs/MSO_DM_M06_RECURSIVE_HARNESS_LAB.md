# MSO-DM-M0.6-RHO Recursive Harness Optimization Lab

Identifier collision: existing M0.6 PR #29 is Free DeepSeek Qualification. RHO is an independent non-overwriting slice, based on main.

## Upstream
Google Research Harness²: https://github.com/google-research/harness2 (Apache-2.0), examined 2026-10-18. Adopt conceptual task-level paired probes and cross-task evidence recording; do not vendor code or claim algorithm/benchmark equivalence.

Upstream credential-free demo (manual, isolated): Linux, Python 3.12, uv, `uv pip install -e '.[render]'`, `harness2-demo --output runs/demo --k 2`. Use an ephemeral disposable container or VM with no secrets, restricted network and no writable repository mounts. Do **not** run upstream Codex executor on host: its documented sandbox is disabled and executor web access unrestricted.

## Safe evidence-only integration
This lab does NOT invoke Codex, Free Agents, shell scripts, APIs or arbitrary plugins. Provide an operator-authored JSON Trial with baseline/candidate evidence for both executors on each task, sharing fixture, policy, verifier plan, budgets and seed. Evidence is stored as digests, not source code or raw transcripts.

Synthetic or incomplete probes cannot qualify. Unsafe execution, regressions and changed comparison constraints reject. Even fully observed paired evidence returns `review_required`, never a permission to activate. Policy and independent verification remain external. Digest-only evidence references are not signature verification.

## Offline demo
`npm run typecheck && npm test`

`npm run build`
`printf '[]\n' > /tmp/rho-ledger.json`
`node dist/src/recursive-harness/cli.js fixtures/recursive-harness/synthetic.json /tmp/rho-outcome.json /tmp/rho-ledger.json`

Expected synthetic fixture decision: `insufficient_evidence`. The CLI exclusively creates an output and appends hash-linked history, but history-file replacement is not crash-atomic. Use disposable paths. Never pass operational configs as output paths.

Future live adapter requires separate sandboxed runs, network lockdown, human review, trusted attestations, shadow deployment and external BYPASS/KILL/ROLLBACK gate. No automatic routing or promotion.
