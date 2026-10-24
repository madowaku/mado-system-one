# MSO-DM-M0.7 ECC Harness Intelligence Lab

Status: **SHADOW / offline experimental**. Human review required. No live agent benchmark was executed by this feature.

## Decision: adopt selected concepts, not the ECC runtime

Reviewed upstream: [affaan-m/ECC](https://github.com/affaan-m/ECC) (MIT), particularly:

| ECC concept | Local analogue | M0.7 choice |
|---|---|---|
| Continuous Learning v2: atomic instincts, project scope, confidence, evidence | MADO LOOP skill feedback and planned Growth Contracts | Candidate-only project-scoped instinct intake; no transcript hooks or automatic skill promotion |
| Agent Eval: repeatable tasks, worktree isolation, pass/cost/time metrics | MADO LOOP Evals/OVP, System One eval + provider ledger | Pure offline three-lane receipt comparison; no agent dispatch; receipt must claim independent isolated checks |
| Agent Harness Construction: narrow tools, recovery, context budgets | System One Policy / Evidence / Verifier and Context Plane | Review Skill for narrow scoped checks and explicit HOLD; do not reimplement tool execution |
| Skill Host Compatibility | MADO LOOP opt-in skill + Cockpit UI librarian family | One new opt-in portable review Skill; no global settings or ~/.claude hooks |

Existing responsibilities stay unchanged:

- `mado-system-one`: pure evaluation, comparison and evidence gates, not an executor or promotion authority.
- `mado-loop`: opt-in `$mado-loop`, existing OVP isolation, P0–P5 proof, Evals and Provider Router remain the owners of actual worker execution.
- `madowaku-cockpit`: read-only MCP; **no new write/shell/model control route**.
- ECC upstream is not installed or invoked, and no ECC hooks, background observation or telemetry are enabled.

## Run the isolated offline experiment

Prerequisites: Node.js 22+, TypeScript dependencies already used by this repository.

```bash
npm install --no-audit --no-fund
npm run typecheck
npm test
npm run build
node dist/src/harness/ecc-lab-cli.js fixtures/harness/ecc-shadow-demo.json --out evidence/harness/ecc-shadow-demo.json
```

The fixture contains three synthetic receipts: `codex`, `claude-code`, `free`. All of them have green *fixture* checks, but the gate MUST report `HOLD`, not a winner or measured model performance. This negative proof is the purpose of the demo. The CLI reads and evaluates JSON only, and writes solely to a caller-selected output path. It runs no agent, installation, shell, or network operation.

### Input: `mso.ecc-harness-input.v0`

- `tasks[]`: stable `id`, `projectId`, pinned `revision`, `sensitivity`, nonempty `requiredChecks`.
- `receipts[]`: `taskId`, `lane`, `attempt`, `origin` (`synthetic` / `external-receipt`), `isolated`, matching project/revision, `checks` with independent/deterministic judges and evidence refs.
- `instincts[]`: atomic candidate with project scope, confidence and supporting references. Global candidates are blocked.
- `skills[]`: untrusted candidate Skill source text, MIT provenance and portable path.

No prompts, session transcripts, repository contents, API keys or raw model output are accepted or required by this contract. Evidence refs are intended as **non-secret identifiers**, not secret-bearing content.

## Three-lane A/B protocol for real-world follow-up

Real execution is **not** included in this PR and cannot be simulated into existence. Use the existing MADO LOOP OVP and Evals when actual model access, consent and suitable platforms are available:

1. Pin a public synthetic task and a base commit. Use a separate isolated worktree per run and attempt.
2. Execute each of Codex, Claude Code and an explicitly configured free-model worker with the same input contract. This is an optional manual evaluation, not an implicit free-model network request.
3. Run the same deterministic test and independent review checks outside the candidate's control. Record check status and evidence reference; absent evidence is `UNKNOWN`.
4. Record `external-receipt` with matching pinned revision and isolated=true. The free-model lane requires public-only payload **and explicit consent**. A real receipt still needs external proof/reference inspection before acceptance.
5. Run the same offline CLI; compare successful runs, failures, unknowns, missing tasks, and reported duration/cost/tokens. Only reported metrics may be compared; missing metrics stay absent, not zero.
6. Human verifier inspects the underlying receipts, diff and P0–P5 proof. `READY_FOR_HUMAN_REVIEW` is **not** a promotion approval.

The report intentionally contains no composite winner ranking; correctness and proof come before token/cost savings.

## Quality gates

| Scenario | Expected outcome |
|---|---|
| All three lanes have synthetic (not executed) fixture receipts | HOLD |
| A required task/lane/check or independent evidence is missing | HOLD |
| Self-reported checks rather than independent/deterministic receipts | HOLD |
| External isolated receipts with all required check references | READY_FOR_HUMAN_REVIEW |
| Free external receipt without consent, private/secret task, mismatched revision/project, failed check | REJECT |
| Global instincts, undocumented evidence, unsafe candidate Skill | REJECT |
| Invalid input, duplicate task/lane/attempt, negative observed cost | Reject parsing |
| Unexpected execution, global hook injection, automatic promotion | Not implemented / forbidden |

An external receipt can be forged. The evaluator validates shape and invariants, **not** cryptographic evidence, worktree identity or actual agent execution. Such checks belong to the independent OVP verifier. The status NEVER grants authority.

## Skills adaptation

`skills/ecc-harness-review/SKILL.md` is a MADO-owned derivative review checklist with ECC attribution, not an automatic copy of ECC's large global skill/hook surface. The static Skill checker is a **minimum lint** and does not establish that untrusted prose is secure. Human review is mandatory.

## Safety and rollback

- Runtime controls, existing APIs, prompts and executable provider adapters unchanged.
- No edits to `mado-loop` or `madowaku-cockpit` and no writes to their users' home directories.
- Revert this isolated feature branch or remove `src/harness`, its fixture/test/Skill/runbook and the export to roll back.
- No automatic installation, login, model pricing/availability assumption, CI network evaluation or rollback authority.

## Exit criteria

- Typecheck and existing tests pass on hosted CI.
- New tests prove replay cannot masquerade as a real A/B win.
- Security and privacy negative cases pass; previously allowed provider/gate behavior remains unchanged.
- PR remains **HOLD for merge** until CI passes and a human confirms the integration and review workflow.
