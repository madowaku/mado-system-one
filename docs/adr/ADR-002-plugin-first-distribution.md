# ADR-002: Plugin-first distribution for suitable MADO capabilities

Status: Accepted
Date: 2026-09-30

## Context

MADO capabilities increasingly consist of reusable skills, tools, MCP services and evidence workflows. Plugins provide a ChatGPT/Codex-native distribution surface for suitable capabilities.

## Decision

For capabilities that naturally live inside ChatGPT or Codex, Plugin packaging is the preferred first distribution experiment.

This does not prohibit standalone web, mobile or desktop products.

Plugin submission artifacts, positive fixtures and negative fixtures are treated as release assets rather than release-day paperwork.

## Consequences

- Distribution requirements influence packaging early.
- A reusable capability can ship before a full custom frontend exists.
- Product validation can happen closer to existing ChatGPT/Codex workflows.
- Standalone products remain available when the product needs its own surface or runtime.
