# MDD26-M0.2 Event Spine

Version: v0.1
Status: Implemented fixture
Date: 2026-09-30

## Purpose

Introduce a provider-neutral, replay-safe event path into MADO System One.

The spine is:

```
raw event
  -> provider normalize
  -> ledger claim / dedupe
  -> Policy
  -> task plan
  -> Harness execution
  -> independent Verification
  -> Evidence
```

The event source does not own Policy, execution authority, or Verification.

## Contracts

### NormalizedEvent

Every event has:

- stable `eventId`,
- `source`,
- `type`,
- `subject`,
- occurrence time,
- payload,
- `dedupeKey`,
- risk / human-gate policy metadata.

`eventId` handles source-level retry identity.

`dedupeKey` can additionally collapse events that are different deliveries but represent the same MADO work item.

### Event ledger

M0.2 provides an in-memory ledger fixture.

A claim is rejected when either:

- the event ID was already observed, or
- the dedupe key was already claimed.

A duplicate is suppressed before Policy, planning, or Harness execution.

The in-memory ledger is intentionally not production durability. A future persistent implementation must preserve the same contract across restarts.

### Policy boundary

Policy runs after a successful claim and before task execution.

Outcomes:

- `allow`: execution may proceed,
- `confirm`: stop and require confirmation,
- `deny`: stop,
- `escalate`: stop and escalate.

Confidence is not part of this authorization contract.

### Verification boundary

A successful executor result is not enough.

The Verifier independently returns:

- `pass`,
- `fail`,
- `uncertain`.

Only `pass` yields Event Spine status `completed`.

## Manual provider

`ManualEventProvider` is the deterministic fixture ingress.

It lets tests and future adapters prove the event semantics without any webhook/network dependency.

## MCP Events adapter spike

`McpEventsAdapter` only normalizes the MCP event envelope in M0.2.

It records:

- protocol version `2026-07-28`,
- webhook delivery mode,
- cursor metadata,
- original MCP event ID.

M0.2 does not implement callback verification, signing, outbound webhook delivery, or persistent subscription storage.

The OpenAI MCP Events documentation currently requires:

- MCP 2.0 protocol version `2026-07-28`,
- persistent subscription storage,
- outbound HTTPS access to callback URLs,
- webhook callback verification,
- stable event IDs preserved across retries,
- idempotent subscription identity using canonical arguments,
- one event per request,
- out-of-order tolerant consumers and idempotent writes.

Reference:

https://developers.openai.com/plugins/build/mcp-events

The helper `mcpSubscriptionIdentity` implements the deterministic canonical-argument identity rule as a local contract fixture. It does not create a real ChatGPT subscription.

## Replay-safety rule

M0.2 is conservative.

Once an event or dedupe key has been claimed, automatic replay is suppressed even when downstream execution or verification fails.

This avoids accidental duplicate side effects.

A future retry API must be explicit and evidence-backed rather than silently clearing the ledger.

## Golden fixture

Tests prove:

1. manual event -> task -> verify -> evidence succeeds,
2. identical retry is suppressed,
3. different event ID with the same dedupe key is suppressed,
4. Policy confirmation prevents Harness execution,
5. executor DONE plus verifier FAIL is not completion,
6. MCP event identity/protocol metadata survives normalization,
7. MCP subscription identity is stable across argument key ordering.

## Non-goals

M0.2 does not yet provide:

- durable database-backed ledger,
- network webhook receiver,
- Standard Webhooks signature verification,
- callback SSRF protections,
- event batching,
- actual OpenAI MCP subscription lifecycle,
- polling provider,
- automatic retry after failure.

Those should be added only behind the stable EventProvider / ledger / Policy / Verification boundaries.

## Next

MDD26-M0.3: Agents Harness Spike.
