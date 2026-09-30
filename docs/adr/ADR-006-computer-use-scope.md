# ADR-006: Computer-use capabilities are environment-specific

Status: Accepted
Date: 2026-09-30

## Context

The current Agents API computer-use documentation describes an OpenAI-hosted browser workflow. MADO also operates across Android, Blender, Unity and desktop environments.

## Decision

Computer-use capabilities are named and validated by environment.

The first Agents API computer-use fixture is browser-only.

Browser support must not be generalized into claims of native Android, Blender, Unity or arbitrary desktop support.

## Consequences

- Native automation retains dedicated adapters.
- Capability discovery can distinguish environments precisely.
- Promotion requires environment-specific fixtures and evidence.
