# mado-system-one

MADO System One is the bounded-decision layer for MADO.

```text
System One   = route / compute / rank / gate / act / score / abstain / sieve / walk / verify
Astra/Codex  = reason / plan / generate
Policy       = allow / confirm / deny
Harness      = execute
Evidence     = observe / record
Verifier     = prove
```

## Core documents

- `docs/MADO_SYSTEM_ONE_ARCHITECTURE.md` — stable architecture, provider contracts, probability semantics
- `docs/MADO_SYSTEM_ONE_PATTERN_ATLAS.md` — reusable decision patterns
- `docs/MADO_SYSTEM_ONE_OPERATIONS.md` — shadow rollout, calibration, activation, rollback, specialization

## Operational lifecycle

```text
OFF
 ↓
SHADOW
 ↓
CALIBRATING
 ↓
ACTIVE_LIMITED
 ↓
ACTIVE
 ↓
ACTIVE_WITH_ESCALATION
 ↓
SPECIALIZING
 ↓
LOCALIZED
```

Every active deployment retains BYPASS / KILL / ROLLBACK. High-impact irreversible actions remain outside learned decision authority.

## Roadmap

- **M0.0** Core contracts
- **M0.1** Capability Router fixture
- **M0.2** TypeSafe Jev provider
- **M0.3** Replay provider
- **M0.4** Policy gate
- **M0.5** Typed Action Loop smoke fixture
- **M0.6** Provider bake-off
- **M0.7** Semantic Sieve fixture
- **M0.8** Structured Read experimental provider
- **M0.9** Multimodal typed-decision spike

## Guiding rule

> Choose observed candidates. Do not invent executable targets.  
> Confidence is not authority. Decision is not verification.

## Status

Early architecture + implementation bootstrap. Interfaces and thresholds remain experimental until validated on MADO workloads.
