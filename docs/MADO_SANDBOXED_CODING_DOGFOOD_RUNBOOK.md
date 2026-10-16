# MSO-DM-M0.6.2 Real Multi-Free Agent Dogfood / Sandboxed Execution & Billing Proof

Status: **implementation + offline CI qualification**. Hosted OpenCode calls require an operator-provisioned environment and explicit manual execution; CI never spends money.

## Objective and boundaries

MSO-DM-M0.6 and M0.6.1 provide candidate evaluation across DeepSeek and GLM with Codex as the incumbent reference. M0.6.2 enables reproducible single-case OpenCode execution and captures sanitized evidence for those evaluations. This milestone does **not** automatically contact providers, verify invoices directly from a billing API, run Codex itself, or activate runtime routing.

OpenCode CLI `opencode --pure run --model <provider/model> --format json` is documented in https://opencode.ai/docs/cli/. The inline `OPENCODE_CONFIG_CONTENT` permissions override and `--pure` plugin suppression are documented. OpenCode tools default to broad permission unless explicitly restricted, therefore our agent config denies shell commands, external directories, web browsing and task/subagent delegation. Only fixture-local read/list/grep/edit is allowed. See https://opencode.ai/docs/permissions/ and https://opencode.ai/docs/config/.

## Offline first: no credentials or outbound calls

    npm install
    npm run dm:dogfood -- hash --repo-root . --fixture fixtures/dogfood/ts-clamp
    npm run dm:dogfood -- probe \
      --manifest fixtures/dm/dogfood-ts-clamp.dry-run.json \
      --repo-root . \
      --out /tmp/mso-dogfood-plan.json

The manifest intentionally has a dummy SHA-pinned container image and false network/billing approvals. It is safe for a **dry-run** and **not ready for real execution**. The fixture digest protects against accidentally uploading changed or non-reviewed content.

Public fixture challenges:

- `fixtures/dogfood/ts-clamp/`: Node built-in, independently verifiable with `node test.mjs`.
- `fixtures/dogfood/godot-combo/`: Godot 4.x state/math regression, independently verifiable with `godot --headless --path . --script test_score.gd`.

Both start with intentionally failing implementations; an agent should repair implementation files and **not modify the test files**. CI does NOT execute either agent.

## Operator-run real OpenCode execution (explicit opt-in)

Preconditions:

1. Create **disposable public-only** test workspaces. This harness only copies paths under `fixtures/dogfood/` and rejects symlinks, sensitive named files, private keys, Docker configuration, and unknown paths. It does not safely handle private production repositories or customer data.
2. Install Docker locally. Install or build a *reviewed* OpenCode container with the required CLI available, and pin its **actual immutable digest** in the manifest. Offline `docker image inspect` can provide a local repo digest. `--pull=never` prevents downloading an unknown image during the probe.
3. Create a dedicated Docker network named `mso-free-egress-<approved-label>` with **separately provisioned firewall/egress rules** allowing only the approved model gateway. A Docker network name by itself does not enforce destination filtering; without external egress controls, do not enable live execution. External network use is essential to contact OpenCode.
4. Provision a **short-lived, least-privilege OpenCode Zen credential** in a dedicated local directory containing `auth.json`, following OpenCode's normal `opencode auth login` format. Do not mount the user's normal HOME, .git config, ssh keys, Docker socket, or any production secrets. Set directory mode 0700 and file mode 0600. Set provider spending limits, disable auto-reload when possible, check that the exact `*-free` routes are still available, and do not assume the free period is ongoing.
5. Pre-register the evaluation: immutable fixture digest, unchanged task instructions, test-plan and time/tool budgets for all models. Replace dummy image digest, network name, and approval references. Record explicit operator approval for `publicFixture`, `externalTransmission`, `spendingRisk` and `networkEgressControlled`. The CLI additionally requires three explicit acknowledgement flags.

Then execute **one case and one model**:

    npm run dm:dogfood -- probe \
      --manifest path/to/approved-job.json \
      --repo-root . \
      --out /tmp/dogfood-deepseek-run.json \
      --execute --ack-public --ack-network --ack-spending \
      --auth-dir /absolute/dedicated-zen-auth \
      --artifacts-root /absolute/public-dogfood-artifacts

Repeat for GLM with its exact `opencode/glm-5.3-flash-free` model ID in a separate clean job. Codex baseline remains a separately operator-managed comparable run, recorded in the M0.6.1 manifest (not deceptively claimed as an OpenCode free model). NEVER run two agents on the same mutated working copy.

The execution tool:

- Copies the reviewed fixture into a **new temporary directory**, verifies the content digest, and refuses shell interpolation by launching Docker as an argument array.
- Pins the container image, drops Linux capabilities, enables no-new-privileges, uses read-only container root, no Docker socket, hard memory/CPU/pid/time limits, and mounts only the ephemeral workspace and dedicated OpenCode credential store. The credential store is **not** copied into the artifact.
- Applies restrictive OpenCode permission configuration and disables plugins/Claude Code imports. No runtime tool whitelist is a complete security boundary: Docker restrictions, dedicated credentials, and network egress controls are also mandatory.
- Hashes stdout/stderr without saving the raw agent transcript, records total elapsed time, output digest and changed artifact digest, and exports only the public workspace artifact to the operator-specified directory.
- Marks independent test/review status `not_run`, billedUsd `null`, billingEvidenceRef `null` regardless of the agent exit code. A successful CLI exit alone never proves correct implementation.
- Attempts a forced Docker stop/cleanup even after the execution ends; the artifact directory must not pre-exist.

## Independent verification and actual billing proof

After each agent run, use a separate trusted test runner on the exported artifact and have an independent reviewer inspect the changes and test evidence. Check that tests were not tampered with. The reviewed evidence can use the `mso.coding-independent-verification.v0` schema.

Capture per-run actual charges in OpenCode's usage/billing ledger. `opencode stats` or raw JSON response cost is only a usage estimate and **not** accepted as actual charges. The `mso.coding-billing-attestation.v0` schema requires one matched run ID, exact model ID, USD amount, invoice/ledger line reference, external source reference, operator verification and individual-run attribution. This represents an **operator attestation**, not direct API verification or a cryptographically signed invoice. If the provider does not expose per-run billed amounts, leave billing evidence absent and accept a blocked/insufficient zero-cost qualification.

    npm run dm:dogfood -- reconcile \
      --run /tmp/dogfood-deepseek-run.json \
      --case path/to/registered-case.json \
      --verification path/to/independent-test-and-review.json \
      --billing path/to/operator-confirmed-billing.json \
      --out /tmp/dogfood-deepseek-proof.json

`--verification` and `--billing` may be omitted. In that case status remains unverified. Never create a fabricated zero-dollar invoice row. The case JSON must have the previously registered `snapshotRef` in the form `sha256:<fixtureSha256>`, along with `instructionRef`, `testPlanRef`, `budgetRef`, `id`, `taskFamily`, `exposure`, `artifactRef`.

The proof output includes a `qualificationRun` object compatible with M0.6.1's `runs` records. Construct the full three-way bake-off manifest only after preparing all separate run proofs. Even a complete evidence package requires human consideration; neither this step nor M0.6.1 allows automatic routing.

## Explicit non-goals / known limits

- **No actual hosted DeepSeek, GLM or Codex calls from repository CI**. Real runs need the operator's own isolated Docker/credential/network environment.
- No guarantee that `*-free` offerings persist or that invoice data can be attributed per invocation.
- The manual attestation is not proof of actual billing in the absence of inspection of the underlying provider ledger.
- Network isolation depends on separately configured firewall rules; just creating `mso-free-egress-*` is not sufficient.
- Docker is a useful containment layer, not a guarantee against malicious model-supplied code or runtime escapes. Do not test private workspaces here.
- Independent evaluator must inspect binary changes, test integrity, execution conditions and regressions before considering provider suitability.
- No trust is transferred to a provider merely because a model response reports completion.

## Next gate

M0.6.3 can automate **independent** Node/Godot test execution in a network-disabled verifier container with a known trusted test snapshot, then construct the complete paired manifest from observed evidence, remaining under explicit human approval.
