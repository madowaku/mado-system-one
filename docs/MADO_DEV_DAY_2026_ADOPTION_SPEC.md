# MADO_DEV_DAY_2026_ADOPTION_SPEC.md

Version: v0.1
Status: Adoption baseline
Date: 2026-09-30
Milestone: MDD26-M0.0

## 0. Purpose

Translate OpenAI DevDay 2026 announcements into bounded adoption decisions for MADO.

This document is not a feature wishlist. It defines:

- what MADO adopts now,
- what MADO experiments with behind adapters,
- what MADO only watches,
- what MADO intentionally ignores for now,
- which repository owns each experiment,
- which existing MADO invariant remains authoritative.

Core rule:

> MADO stays portable at the core and uses provider capabilities as replaceable acceleration layers.

## 1. Existing MADO responsibilities remain authoritative

DevDay capabilities do not replace the stable responsibility split in AGENTS.md.

```
System One   = route / compute / rank / gate / act / score / abstain / sieve / walk / verify
Context      = compile what the reasoner should see
Planner      = reason / plan / generate
Policy       = allow / confirm / deny
Harness      = execute
Evidence     = observe / record
Verifier     = prove / reject
```

Provider capabilities must enter through explicit adapters or capability records.

No provider feature may silently absorb Policy or independent Verification.

## 2. Adoption lanes

### ADOPT_NOW

Use immediately as architecture or repository hygiene, while preserving provider-neutral contracts.

- plugin packaging and submission discipline
- MCP Events compatible event spine
- GPT-6.1 Sol evaluation as a default high-capability candidate
- Codex Cloud reproducibility practices
- Codex CLI multi-agent operational practices

### EXPERIMENT

Run bounded fixtures before promotion.

- Plugin interactive UI
- Agents API
- Agents API hosted-browser computer use
- Decisions API
- Codex Security Cloud
- Sites + Plugins

### WATCH

Do not make core architecture depend on these yet.

- Dots
- ChatGPT Space
- Pages
- Team Tasks
- Ultrafast
- Shareable Profiles
- Sign in with ChatGPT

### IGNORE_FOR_NOW

Not a current MADO bottleneck.

- Bedrock Managed Agents
- Private Intelligence
- collaborative slides
- ChatGPT in team chat
- Meetings plugin
- Pro-tier-specific optimization
- OpenAI Marketplace

The machine-readable source of truth is `docs/devday-2026/adoption-matrix.yaml`.

## 3. Adoption principles

### P1. Provider-neutral core

Core contracts describe MADO semantics, not vendor products.

Provider-specific behavior belongs behind adapters or provider profiles.

### P2. Evidence outranks self-report

A runtime reporting DONE is not proof.

Mutation workflows must emit task-appropriate evidence such as:

- diff,
- tests,
- screenshots,
- logs,
- artifacts,
- structured decisions,
- provenance.

Verifier outcomes remain independent from builder claims.

### P3. Event-first where trustworthy

Prefer:

```
event
  -> normalize
  -> policy
  -> bounded task
  -> execute
  -> verify
  -> evidence
```

over repeated polling when a supported event source exists.

Polling remains a fallback.

### P4. Bounded decisions stay bounded

Finite surfaces such as:

```
PASS | RETRY | ESCALATE | ASK_HUMAN
```

must be explicit contracts.

A Decisions API implementation may satisfy the contract, but does not define the contract.

### P5. Model choice is policy

Literal model IDs must not be scattered through domain logic.

Task family, consequence, uncertainty, cost and fallback policy choose the model tier.

Initial hypothesis to evaluate:

```
bounded low-cost decision
  -> Sol-class normal difficult work
  -> Astra-class escalation
  -> human when policy or uncertainty requires
```

This is not a promotion decision until measured.

### P6. Confidence is not authorization

Existing Policy rules remain outside learned decision authority.

Human confirmation remains near consequential execution.

### P7. UI is progressive enhancement

Plugin UI may improve inspection, confirmation and evidence review.

The underlying workflow should remain usable without UI where practical.

### P8. New provider surfaces begin in SHADOW

Where practical, new provider-backed decisions begin in SHADOW as defined in MADO_SYSTEM_ONE_OPERATIONS.md.

Promotion requires representative traces, known fallback behavior and evidence-backed evaluation.

## 4. Required architecture seams

MDD26-M0.0 does not implement these interfaces. It establishes the direction that later milestones must preserve.

### 4.1 EventProvider

Conceptual responsibility:

```ts
interface EventProvider {
  subscribe(spec: unknown): Promise<unknown>;
  unsubscribe(subscriptionId: string): Promise<void>;
  normalize(rawEvent: unknown): Promise<NormalizedEvent>;
}
```

Candidate providers:

- ManualEventProvider
- PollingEventProvider
- MCPEventsProvider

The normalized event requires stable identity and dedupe semantics before it can trigger writes.

### 4.2 DecisionProvider

Conceptual responsibility:

```ts
interface DecisionProvider {
  decide(
    contract: DecisionContract,
    evidence: EvidenceRef[],
    policy: DecisionPolicy
  ): Promise<BoundedDecision>;
}
```

Candidate implementations:

- deterministic rules
- existing SystemOneProvider-backed choice
- structured LLM decision
- OpenAI Decisions adapter

Provider selection does not change the bounded decision contract.

### 4.3 Runtime adapter boundary

Managed agent runtimes are Harness implementations or Harness helpers.

They do not own Policy or Verification.

A runtime adapter must expose enough trace/evidence to map the run into MADO Evidence Plane records.

### 4.4 Model policy

Model selection is configuration and operational policy.

A task declares requirements such as:

- decision pattern,
- consequence class,
- context class,
- latency target,
- cost target,
- required modalities,
- provider eligibility.

The policy resolves a provider/model profile.

## 5. Computer-use scope

The first Agents API computer-use experiment is browser-only.

MADO must not infer support for native Android, Blender, Unity or arbitrary desktop control from hosted-browser support.

Native execution remains behind dedicated adapters such as:

- ADB or device harnesses,
- Blender MCP,
- Unity-specific adapters,
- explicit OS-level computer-use adapters.

Capability names must state their actual environment.

Good:

`openai.agents.computer_use.browser`

Bad:

`openai.computer_use.everything`

## 6. Repository mapping

### mado-system-one

P0 owner for:

- adoption registry,
- event spine contracts,
- provider-neutral decision seams,
- model policy,
- Evidence normalization,
- lifecycle and SHADOW rules.

### mado-vibe-shipping

P1 experiment target for:

- plugin-first intent intake,
- bounded Human Question Gate work,
- lower-friction product surfaces,
- model-routing evaluation.

### mado-mobile-qa-loop

P1 consumer for:

- build/test events,
- evidence contracts,
- decision gates,
- model routing.

Native Android execution remains a dedicated adapter problem.

### mado-game-service-factory

P1 consumer for:

- reproducible Codex environments,
- event-triggered evidence processing,
- developer-facing plugin distribution.

### mado-game-experience-loop

P1 consumer for:

- bounded friction classification,
- Evidence Viewer experiments,
- session-ingest events.

### mado-app-growth-loop

P2 consumer for:

- scheduled/event-driven evidence ingest,
- bounded classification and routing,
- plugin distribution.

### blender-visual-director

P2 consumer for:

- model policy,
- event/evidence normalization.

Blender MCP remains the specialized execution path unless a documented replacement proves superior.

## 7. Milestones

### MDD26-M0.0 - Adoption Baseline

Scope:

- this specification,
- ADR-001 through ADR-007,
- adoption-matrix.yaml,
- README registration.

No runtime behavior change.

Done when:

- every normalized DevDay announcement has a lane,
- every adopted/experimental feature has an owner,
- architecture decisions are explicit,
- no production API wiring was added.

### MDD26-M0.1 - Plugin Release Contract

Goal:

Make one MADO capability mechanically ready for the public plugin pipeline.

Expected artifacts:

- plugin manifest,
- skill/MCP package,
- listing metadata,
- positive fixtures,
- negative fixtures,
- support/privacy/release checklist,
- package validation.

### MDD26-M0.2 - Event Spine

Goal:

Introduce normalized, idempotent events into mado-system-one.

Required behaviors:

- stable event identity,
- dedupe key,
- subscription registry,
- replay safety,
- manual fixture source,
- polling fallback,
- MCP Events adapter spike,
- event -> task -> verify -> evidence fixture.

### MDD26-M0.3 - Agents Harness Spike

Goal:

Compare managed Agents API orchestration with the existing MADO/Codex path.

First fixture:

- read-only repository readiness audit,
- 2 to 3 independent subagents,
- independent evidence verification.

Promotion depends on measured complexity, quality, cost and recovery.

### MDD26-M0.4 - Browser Computer-Use Fixture

Goal:

Test only the documented browser environment first.

Required evidence:

- action trace,
- screenshots,
- expected final state,
- independent verifier result,
- approval-boundary exercise.

### MDD26-M0.5 - Decision Provider Bakeoff

Goal:

Compare bounded-decision implementations on a fixed dataset.

Primary guard metric:

- high-consequence false PASS rate.

Average accuracy must not hide unsafe false allows.

### MDD26-M0.6 - Sol Model Router

Goal:

Benchmark GPT-6.1 Sol on real MADO fixture families before making it a default tier.

Measure:

- verifier success,
- retry-adjusted cost,
- latency,
- human escalation,
- task-family quality.

### MDD26-M0.7 - Evidence Viewer Plugin UI

Goal:

Render a MADO Evidence Bundle as a useful ChatGPT-native inspection surface.

Minimum surface:

- run status,
- screenshots,
- diff/log evidence,
- findings,
- verifier result,
- allowed approve/retry/escalate controls.

### MDD26-M0.8 - Distribution Loop

Goal:

Treat plugin publication and review feedback as an evidence loop.

```
build
 -> fixture tests
 -> submission
 -> review feedback
 -> repair
 -> publish
 -> usage/support evidence
 -> improve
```

## 8. Success criteria

Architecture:

- no provider-specific model IDs in domain business logic,
- external runtimes map to Evidence records,
- event handlers are idempotent before writes,
- destructive actions remain policy-gated.

Operations:

- new learned decision surfaces can run in SHADOW,
- BYPASS / KILL / ROLLBACK remain possible,
- provider and model provenance are recorded.

Product:

- at least one MADO capability becomes understandable and installable without reading its repository,
- one Evidence Bundle can be rendered through Plugin UI,
- public distribution feedback enters a reproducible loop.

## 9. Risk register

### Platform churn

Mitigation: adapters, capability registry, contract tests.

### Vendor lock-in

Mitigation: provider-neutral contracts and portable Evidence.

### Multi-agent cost explosion

Mitigation: bounded concurrency and retry-adjusted cost evidence.

### Event duplication

Mitigation: event IDs, dedupe keys, idempotency store and action ledger.

### Autonomous false success

Mitigation: independent verification and concrete evidence.

### Computer-use overreach

Mitigation: environment-specific capability names and fixtures.

### Plugin review friction

Mitigation: make submission requirements CI-visible before release day.

### Decision false PASS

Mitigation: asymmetric evaluation that weights dangerous false allows more heavily than conservative escalation.

## 10. Definition of done for MDD26 adoption

DevDay adoption is complete when:

- one MADO capability meets current plugin submission standards,
- mado-system-one has a provider-neutral event interface,
- one supported event adapter completes event -> task -> verify -> evidence,
- bounded decisions use explicit contracts,
- GPT-6.1 Sol has a real MADO benchmark,
- model selection is policy-driven,
- Agents API has a measured bakeoff,
- browser computer use has an evidence-backed fixture,
- native/mobile/game automation scope is not overstated,
- one Evidence Bundle renders through Plugin UI,
- consequential actions retain human policy boundaries.

## 11. End state

The goal is not:

```
MADO = collection of DevDay demos
```

The goal is:

```
                 MADO CORE
                    |
       +------------+------------+
       |            |            |
     State       Decisions     Evidence
       |            |            |
       +------- Policy/Harness ---+
                    |
          provider/runtime adapters
                    |
       +------------+------------+
       |            |            |
    Plugins      Agents       Codex
       |            |            |
       +------------+------------+
                    |
          domain capability loops
                    |
                Verifier
                    |
                  Human
```

DevDay is successfully adopted when MADO becomes smaller at the commodity infrastructure layer and stronger at the reusable contract, evidence and product layers.
