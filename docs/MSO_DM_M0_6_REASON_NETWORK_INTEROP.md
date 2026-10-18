# MSO-DM-M0.6 Reason Network Interop / Cross-Agent Collaboration Lab

## Scope and status

This milestone adds a **transport-neutral qualification contract**, not a claimed native Reason Network integration. The public MSO main branch currently does not contain the locally reported `free-agent-bootstrap` work; avoid changing its registry or delegation semantics before that work is synchronized.

Reason Network integration remains **experimental / OFF**. No installer is executed, no network connections are opened, and no external agent commands are automatically run.

## Architecture

MSO decision/policy gate → `qualify` → `dispatch` → optional reviewed `Transport` implementation → Reason Network adapter.

- Dry-run is the default integration posture and calls no transport even if one is supplied.
- Live mode requires explicit `Transport` injection. In its absence, fail closed.
- Validate agent IDs, target enabled state, allowlisted message kinds, UTF-8 payload size, expiry, and delegation capability.
- Timeout budget is handed to the adapter. The adapter must enforce actual cancellation and network deadlines; this contract alone cannot enforce them.
- Transport exceptions are reported as redacted error categories; never log payloads/tokens by default.
- Message ACK means delivery confirmation only, **not** task correctness or execution permission.

## Next compatibility checks

1. Verify actual Reason CLI/OSS command syntax, supported Windows builds, licensing, and authenticated handshake against an inspected pinned release.
2. Build a disposable Windows installation harness with checksum verification and no automatic shell execution.
3. Implement a reviewed adapter for the pinned API; maintain a mocked transport in CI.
4. Bridge the locally generated `free-agent-registry.json` only after its actual schema lands in GitHub.
5. Add correlation IDs, deduplication, retries with backoff, lease/lock enforcement per worktree, secret redaction, and role authorization independent of transport encryption.
6. Collect two-way live evidence on two isolated agents; do not grant execution authority from messages alone.
7. Gate promotion on successful Windows tests, real ACKs, negative tests, rollback, and human review.

## Verification

`npm run typecheck`

`npm test`

No additional dependencies are needed.
