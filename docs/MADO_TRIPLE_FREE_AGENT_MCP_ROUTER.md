# MSO-DM-M0.6.2c Codex Free-Agent Delegation / Triple-Model MCP Router

Status: MCP stdio implementation + offline unit tests. External models have **not** been invoked by CI.

## Architecture
Codex CLI -> MCP stdio `delegate_free_agent` -> exact role mapping -> M0.6.2 public-fixture preflight -> optional one-shot human authorization -> existing sandboxed OpenCode Docker executor -> hashed execution evidence. The existing independent review and actual provider billing reconciliation remain separate, mandatory quality gates.

- `implement` -> `opencode/deepseek-v4.1-flash-free`
- `review` -> `opencode/glm-5.3-flash-free`
- `long_context` -> `opencode/beam-free`, **30-day retention**, approved PUBLIC fixtures ONLY.

These roles are hypotheses, not observed model-quality claims. All three model IDs and their pricing must be checked in OpenCode immediately before any live use; an expired free rate is **not** permission to fall back to paid aliases. The registry contains no arbitrary model keys.

## Configure Codex CLI (read-only planning first)

1. Clone this branch / merge the stacked PRs. `npm install && npm run build`.
2. Create an **operator-owned local** JSON registry (not in git), for example:

       {
         "public:implement": {
           "schemaVersion": "mso.coding-dogfood-job.v0",
           "runId": "trial-public-001",
           "caseId": "ts-clamp",
           "taskFamily": "typescript",
           "providerId": "opencode/deepseek-v4.1-flash-free",
           "fixtureDir": "fixtures/dogfood/ts-clamp",
           "promptFile": "TASK.md",
           "expectedFixtureSha256": "<actual digest, WITHOUT sha256: prefix>",
           "image": "ghcr.io/your-reviewed-opencode-image@sha256:<ACTUAL-64-CHAR-DIGEST>",
           "egressNetwork": "mso-free-egress-operator",
           "limits": {"timeoutSeconds": 120, "memoryMb": 1024, "cpus": 1},
           "approval": {
           "publicFixture": true, "externalTransmission": false,
           "spendingRisk": false, "networkEgressControlled": false,
           "approvalRef": "operator:public-fixture-reviewed"
           }
         }
       }

   Calculate fixture hashes with `npm run dm:dogfood -- hash --repo-root . --fixture fixtures/dogfood/ts-clamp`. Repeat entries for `public:review` and `public:long_context`, each with a **different runId**, exact provider ID and public task. Do not give the server access to private repositories or extra files.

3. Configure Codex MCP with a local launcher script or `codex mcp add`. Example shell syntax on the machine that runs Codex:

       codex mcp add mso-free-agents \
         --env MSO_DELEGATION_REPO_ROOT=/absolute/path/mado-system-one \
         --env MSO_DELEGATION_REGISTRY=/absolute/path/private-operator-registry.json \
         -- node /absolute/path/mado-system-one/dist/src/coding/free-agent-mcp.js

4. In Codex: ask it to call `list_free_agent_roles` then `delegate_free_agent` with:

       {"role":"implement","taskRef":"public:implement","privacy":"approved_public","mode":"dry_run"}

   Returns JSON MCP content, never model raw prompts or code. Dry-run is the default even if Codex omits mode. This is a real MCP protocol endpoint, not just a prose instruction. The server's stdin/stdout are reserved for JSON-RPC; progress/errors go to stderr.

## Live operator-only arming

Without `MSO_DELEGATION_AUTHORIZATION`, even a model-requested `mode=execute` is rejected. To allow **exactly one** live invocation, the operator must:

- Check provider's current free pricing and the specific model ID, invoice implications and retention policy.
- Review and approve only the public fixture digest, immutable Docker image, separate network egress filtering, key exposure and spending boundary. Set all four job approval flags to true; *the flags are assertions, not physical controls*.
- Prepare the isolated per-run short-lived OpenCode credential store (chmod 0700 directory, 0600 auth.json), and actual independently enforced egress restrictions. No Docker socket or host secrets in the workspace.
- Create a private, absolute-path 0600 JSON authorization file with `schemaVersion: "mso.delegation-authorization.v0"`, `taskRef`, `providerId`, `fixtureSha256` (no prefix), `expiresAt` (UTC ISO), `authDir`, `artifactsRoot`, `operatorRef`, and `allowOneLiveExecution: true`. Use a near-term expiry. Do not commit it.
- Restart the MCP server using `MSO_DELEGATION_AUTHORIZATION=/absolute/path/private-approval.json`. The server accepts only one live attempt per lifetime and never has a tool to amend approval.
- Explicitly ask Codex for `mode=execute` on that exact registered task. The router consumes the authorization **before** invoking the executor. For any other task/model/digest it refuses. A successful Docker process still returns `testStatus=not_run`, `reviewStatus=not_run` and `billedUsd=null`.

**Important limitations:** restarting the process rereads the authorization file, so remove/rename it after use, limit its lifetime, and do not treat the in-memory one-shot rule as a durable replay-proof grant. Review the container image and network enforcement externally. For expensive or private work, keep MCP read-only and use the operator-managed CLI path instead.

## Privacy/cost controls
- Beam has a distinct 30-day provider data-retention condition. All model calls require approved public fixtures, including DeepSeek and GLM.
- Invoices and vendor ledger rows are **not** verified through MCP. Use `npm run dm:dogfood -- reconcile` with independent test and actual billing records before claiming cost savings or code quality.
- The MCP cannot directly accept a raw prompt, arbitrary workspace path, model alias or new registration through its tools.
- Neither headless Codex nor its agent can promote a model to active routing or merge code solely based on an MCP result.
