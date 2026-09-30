# ADR-003: Event-first automation with polling fallback

Status: Accepted
Date: 2026-09-30

## Context

Many MADO loops currently need to notice external changes. Supported event sources can reduce unnecessary polling and shorten reaction time.

## Decision

New automation flows prefer normalized events when a trustworthy event source exists.

Polling remains an explicit fallback.

Events must be normalized before entering task execution and must carry enough identity for dedupe and replay safety.

No event may bypass Policy.

## Consequences

- MADO needs a provider-neutral EventProvider boundary.
- Idempotency becomes a first-class requirement.
- MCP Events is one adapter, not the event model itself.
- Event receipt and action execution are recorded separately.
