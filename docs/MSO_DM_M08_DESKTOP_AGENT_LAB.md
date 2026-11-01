# MSO-DM-M0.8 Desktop Agent Intelligence Lab

Status: EXPERIMENTAL / OFF by default. Scope: local Windows desktop observation and tightly bounded UI actuation. No production authority.

## Goal

Evaluate Vercel Labs [agent-desktop](https://github.com/vercel-labs/agent-desktop) as a **separate, opt-in local harness** for Codex/Claude Code, supporting accessibility-tree based desktop UI testing and evidence-first replay. First target: Notepad. Second target (only after promotion): Godot editor smoke workflow. This is NOT an expansion of madowaku-cockpit's read-only MCP bridge.

## Contract boundaries

- madowaku-cockpit remains read-only: do not add shell, desktop input, write, auth, clipboard, or broad filesystem access to its MCP.
- mado-system-one decides `allow | confirm | deny`. A dedicated local harness performs permitted steps. The evidence plane stores sanitized summaries.
- `agent-desktop` is a tool, not an autonomous policy authority. It reads OS accessibility trees; game viewports may be largely opaque.
- Default mode: `OFF`. `SHADOW` observes but **never actuates**. `ACTIVE_LIMITED` is possible only after human approval and passing gates.
- Keep BYPASS, KILL, ROLLBACK available; stop on ambiguous windows, stale refs, unknown dialog, focus mismatch, unexpected process, or missing evidence.

## Upstream commands (verify against locally installed version)

On Windows PowerShell:

```powershell
npm install -g agent-desktop
agent-desktop version
agent-desktop status
agent-desktop skills get desktop
agent-desktop skills get platform
agent-desktop list-apps
agent-desktop snapshot --app Notepad -i
```

The CLI's native reference contract uses a **snapshot-scoped** `@snapshot:element` ref; never reuse a ref after mutation. Under PowerShell quote refs (for example `'@s123:e4'`). Use `agent-desktop <command> --help` to verify syntax rather than hardcoding undocumented flags. A sample actuation is deliberately excluded from this runbook: the operator must first inspect and approve the exact action. Upstream [README](https://github.com/vercel-labs/agent-desktop) and [JSON contract](https://github.com/vercel-labs/agent-desktop/blob/main/docs/json-output.md).

## Action policy

| Action | SHADOW | ACTIVE_LIMITED |
|---|---|---|
| `version/status/list-apps/snapshot/find/is` | Allow (redacted evidence) | Allow |
| click/type/press/set-value in allowlisted disposable Notepad document | Deny | Confirm for each action during M0.8 |
| Godot editor UI actions | Deny | Deny until separately promoted |
| Clipboard read/write, screenshot, trace | Deny | Confirm only when sanitized private evidence store is ready |
| file delete, terminal/shell, application install, credentials, browser login, deployment, external network send | Deny | Deny |
| unrecognized application, window, dialog, element or accessibility ref | Deny | Deny |

Note: the local CLI may offer more capabilities than this lab's policy. Enforce restrictions in the **calling harness**, not via claims that the binary itself has sandbox protections. Execute from an ordinary non-admin user; the policy does not replace OS security.

## Test protocol

1. Run `scripts/desktop-agent-lab/preflight.ps1`. It only checks prerequisites and prints safe observation commands. No auto-install.
2. Manually open Notepad with an empty disposable document. Verify app/window explicitly.
3. SHADOW: obtain version/status and a bounded interactive snapshot. Record success/failure, OS, CLI version, sanitized element counts, timing, ambiguous target rate, and any refusal conditions. Keep raw tree/screenshot **local and private**, never commit or upload it.
4. Before any ACTIVE_LIMITED change, have a human approve the exact intended UI action and inspect the current window and snapshot ref. After each action take a fresh snapshot and compare expected state. No blind coordinate fallback.
5. Inject failure cases: stale ref, two matching windows, unexpectedly opened dialog, missing target, app focus drift, consent declined. Verify fail-closed and no unapproved side effects.
6. Only after passing Notepad, draft a **separate** Godot-specific experiment. Use Godot MCP for structured engine operations and accessibility UI only where it is measurable. Keep game-view image validation in game-test-player.
7. Report pass/fail and evidence location to reviewer. Never self-promote to production.

## Promotion gates

- All denied operations in the policy fixture return DENY.
- No UI mutation during SHADOW, including retries and failure handling.
- All tested stale/ambiguous refs cause halt and fresh observation, not guessed clicks.
- Every permitted action is user-approved, independently re-observed, and traceable to a specific snapshot/window.
- No secrets in public outputs; private artifact retention and deletion policy is documented.
- 0 high-impact unauthorized actions; no rate-based exception.
- Manual rollback/kill test passes; reviewer explicitly signs off.

## Evidence schema (sanitized only)

```json
{
  "experiment": "MSO-DM-M0.8",
  "mode": "SHADOW",
  "target": "Notepad",
  "platform": "windows",
  "cliVersion": "record-at-runtime",
  "windowIdentityVerified": false,
  "snapshotComplete": false,
  "refCount": 0,
  "actionRequested": "snapshot",
  "decision": "allow",
  "actuated": false,
  "verified": false,
  "failureCode": null,
  "reviewedByHuman": false
}
```

Do not include raw content of accessibility trees, typed text, clipboard, screenshots, tokens, filesystem paths with usernames, or private window titles in committed evidence.

## Codex handoff

```text
ROLE: Codex
MODE: local_review_then_bounded_execution
TASK: MSO-DM-M0.8 Windows Desktop Agent Lab
GOAL: Evaluate observation and fail-closed behavior of agent-desktop.
STATE: OFF by default; madowaku-cockpit MCP remains read-only.
TARGET: disposable Notepad document; local non-admin Windows session.
DO: run preflight; inspect upstream skills; run SHADOW observation; record sanitized results;
    request approval for every proposed ACTIVE_LIMITED action; snapshot after each action.
KEEP: separate harness, local-only private raw evidence, BYPASS/KILL/ROLLBACK, explicit allowlist.
NO: autonomous install, credentials, hidden remote control, browser logins, shell passthrough,
    writes through cockpit MCP, Godot edits in M0.8, guessed coordinates, raw screenshot uploads.
OUT: evidence summary, failure matrix, limits, recommendation for next gate.
CHECK: policy tests, ref invalidation, ambiguity halt, privacy review, operator consent.
RISK: UI tree incompleteness, permissions, ref staleness, sensitive desktop information.
NEXT: review evidence before considering Godot-specific M0.9.
```
