# MADO_MULTI_AGENT_FORGE_SPEC.md

Version: v0.1
Status: Draft / implementation target
Date: 2026-09-25

## 0. Purpose

MADO Multi-Agent Forge is the orchestration protocol for turning an open-ended production intent into a verified artifact through bounded multi-agent work.

Forge is not a new general planner and not a chat-room of agents. It composes existing MADO responsibilities:

- System One: choose, rank, gate, allocate, abstain
- Context Plane: compile role-specific evidence and instructions
- Planner: reason, propose, generate
- Harness: execute bounded work
- Evidence Plane: record observations, claims, changes, tests, screenshots, traces
- Verifier: reproduce, falsify, prove
- Policy: allow, confirm, deny consequential actions
- Human: provide intent, taste, friction reports, and authority

Core principle:

> Parallelism earns speed only after contracts, ownership, and verification boundaries exist.

Forge is domain-general. It should support software, games, documents, visual production, research, and other artifact workflows.

## 1. North Star

Intent
→ independent possibilities
→ evidence-backed selection
→ executable specification
→ contract freeze
→ owned parallel work
→ independent review
→ experience evaluation
→ falsification
→ human signal
→ verified artifact

A builder saying "done" never makes the artifact DONE.

## 2. Non-goals

Forge v0.1 does not attempt to:

- let arbitrary agents edit arbitrary files concurrently,
- treat majority vote as truth,
- replace deterministic tests with model opinions,
- remove humans from consequential publication or deployment,
- maximize agent count,
- use self-confidence as acceptance evidence,
- turn every task into a multi-agent workflow.

Small tasks should stay small.

## 3. Core invariants

1. Contract before fan-out.
2. Single writer per mutable surface.
3. Builder is not verifier.
4. Important claims require evidence references.
5. NOT_PROVEN is a valid verifier result.
6. Medium/high findings receive falsification where practical.
7. Human friction can reopen model-approved decisions.
8. Policy remains outside Forge.
9. Context is compiled per role.
10. Evidence survives the run and supports replay.

## 4. Seven Forge primitives

### 4.1 Divergence Pool

Generate N materially different candidate directions.

Each candidate records:

- thesis / approach,
- assumptions,
- expected strengths,
- expected failure modes,
- implementation implications,
- probes or evidence already gathered,
- unresolved questions.

Diversity must be structural, not wording variation. A typical v0.1 fan-out is 3 to 7 candidates.

### 4.2 Independent Jury

Evaluate the same candidate set from deliberately different lenses.

Typical lenses:

- user value / experience,
- engineering feasibility,
- operational cost and reliability,
- target-audience fit,
- safety / policy fit,
- maintainability.

Jurors should evaluate independently before seeing each other's conclusions where practical.

Jury output preserves:

- per-criterion observations,
- rejected assumptions,
- reusable strengths from losing candidates,
- uncertainty,
- synthesis guidance.

The purpose is not merely to pick a winner.

### 4.3 Contract Freeze

Before large parallel implementation, create a contract baseline.

Examples:

- types and interfaces,
- file/module map,
- schemas and APIs,
- artifact layout,
- naming rules,
- asset dimensions,
- acceptance criteria,
- test entry points,
- evidence requirements.

Typed stubs or placeholder artifacts may be used so the whole project is structurally valid before fan-out.

Freeze does not mean immutable forever. Contract changes become explicit decisions rather than accidental drift.

### 4.4 Ownership Scheduler

Assign one writer to each mutable surface.

An ownership lease records at least:

- surfaceId,
- ownerAgentId,
- allowedWrites,
- forbiddenWrites,
- dependencies,
- expiration phase.

If a builder needs a change outside its lease, it emits a cross-owner request rather than mutating that surface.

Software surfaces are usually files/directories. Visual work may use frames, pages, layers, or assets. Documents may use sections.

### 4.5 Builder / Reviewer Split

Every substantial owned surface has separate build and review roles.

Flow:

builder
→ build report
→ independent reviewer
→ reproduce / inspect / test
→ accept | request_fix | escalate

Reviewer checks include:

- contract deviation,
- edge cases,
- untested claims,
- missing user-visible states,
- performance regressions,
- visual or interaction failures,
- nondeterminism,
- accessibility or fragility.

### 4.6 Falsification Gate

A review finding is itself a claim.

For findings above a configured consequence threshold:

finding
→ skeptical verifier
→ attempt to reproduce
→ attempt to refute
→ REAL | NOT_PROVEN | DUPLICATE | MISCLASSIFIED

The verifier defaults to NOT_PROVEN when evidence is insufficient.

Confirmed findings carry:

- reproduction evidence,
- severity,
- affected surface,
- suggested invariant,
- expected regression test.

### 4.7 Human Override Signal

Human observations are a separate evidence channel.

Examples:

- this is too hard,
- I cannot tell where to click,
- this feels slow,
- the output looks cheap,
- I do not trust this result,
- it technically works but feels wrong.

A human signal may reopen an accepted decision.

Forge records:

- previous decision,
- human observation,
- affected assumption,
- reopened surfaces,
- new verification required.

Human feedback is authoritative as an observation of experience, not automatically as a diagnosis of root cause.

## 5. State machine

INTAKE
→ DIVERGE
→ JUDGE
→ SYNTHESIZE
→ SPECIFY
→ CONTRACT_FREEZE
→ BUILD
→ REVIEW
→ INTEGRATE
→ EXPERIENCE_EVAL
→ FIND
→ FALSIFY
→ FIX
→ VERIFY
→ HUMAN_CHECK
→ RELEASE_GATE
→ DONE

Allowed loops:

- JUDGE → DIVERGE
- REVIEW → BUILD
- INTEGRATE → CONTRACT_FREEZE
- EXPERIENCE_EVAL → FIX
- FALSIFY → FIX
- VERIFY → FIX
- HUMAN_CHECK → SPECIFY or FIX
- RELEASE_GATE → FIX

ABSTAIN and ESCALATE remain valid at every learned decision membrane.

## 6. Role model

Forge v0.1 defines roles, not model identities.

### Orchestrator
Owns workflow state, role assignment, dependencies, evidence collection, lease enforcement, and gates. It should not casually become the main implementer.

### Explorer
Produces one materially distinct candidate.

### Juror
Evaluates candidates under one lens.

### Synthesizer
Combines selected strengths without erasing rejected-risk evidence.

### Spec Author
Turns direction into implementable decisions and acceptance criteria.

### Contract Builder
Creates stubs, schemas, interfaces, fixtures, and ownership map.

### Builder
Mutates only owned surfaces.

### Reviewer
Independently inspects a builder's work.

### Experience Agent
Interacts with the artifact under constrained, user-like behavior.

### Finding Hunter
Searches for concrete failure scenarios.

### Skeptical Verifier
Tries to disprove findings.

### Fixer
Repairs confirmed findings and adds regression evidence.

### Release Verifier
Runs final deterministic and experiential gates.

## 7. Role-specific context

The Context Plane should compile different views.

Builder context:
- owned contract,
- owned surfaces,
- adjacent interfaces,
- acceptance criteria,
- relevant decisions,
- minimal global constraints.

Reviewer context:
- contract,
- artifact,
- builder report,
- tests / screenshots,
- relevant global invariants.

Reviewer should not rely on the builder narrative as truth.

Skeptical Verifier context:
- exact finding claim,
- reproduction steps,
- artifact version,
- relevant code/surface,
- minimal prior discussion.

Avoid anchoring the verifier with consensus summaries.

Human-check context:
- what changed,
- what is uncertain,
- what requires taste or authority,
- how to reproduce.

## 8. Evidence Bundle

Each Forge run gets a durable evidence namespace.

Suggested layout:

evidence/<run-id>/
- intent.json
- context/
- decisions/
  - candidate-set.json
  - jury.json
  - synthesis.json
- contracts/
  - ownership.json
  - acceptance.json
- agents/<agent-id>/report.json
- observations/
  - tests/
  - screenshots/
  - traces/
  - metrics/
- findings/<finding-id>.json
- falsification/<finding-id>.json
- fixes/
- verification/final.json
- human/signals.jsonl
- release/gate.json

A compact event stream should also exist for replay.

## 9. Minimum typed records

ForgeCandidate:
- id
- thesis
- assumptions[]
- evidenceRefs[]
- risks[]

ForgeDecision:
- decisionId
- phase
- candidates[]
- selected[]
- rejected[]
- rationaleRefs[]
- providerTraceRefs[]

BuildReport:
- agentId
- ownedSurfaces[]
- changedSurfaces[]
- acceptanceResults[]
- evidenceRefs[]
- crossOwnerRequests[]
- unresolved[]

Finding:
- findingId
- claim
- severity: low | medium | high
- reproduction[]
- evidenceRefs[]
- status: candidate | confirmed | not_proven | fixed | verified

HumanSignal:
- signalId
- observation
- artifactVersion
- affectedDecisionIds[]
- severity: note | friction | blocker

## 10. System One integration

Forge reuses existing patterns rather than inventing one monolithic FORGE decision.

- ROUTE: select role/provider/tool for bounded work.
- COMPUTE: choose number of explorers, jurors, or review depth.
- RANK: prioritize findings or candidate directions.
- GATE: decide whether evidence is sufficient to advance.
- ACT: choose one observed next action.
- SCORE: severity, risk, usability friction.
- ABSTAIN: insufficient evidence.
- SIEVE: compile role-specific context.
- WALK: choose the next search/reproduction direction.
- VERIFY: compare claims with observed evidence.

System One does not gain authority to mutate external state through these decisions.

## 11. Harness integration

Harness remains responsible for execution.

Forge asks Harness to:

- enforce ownership leases where technically possible,
- isolate ports, temp directories, build outputs, and caches,
- support read-only reviewer/verifier modes,
- record commands and exit status,
- capture artifacts and screenshots,
- preserve artifact version identity for observations,
- expose cancellation and bounded retry,
- detect attempts to broaden mutation scope.

## 12. Experience evaluation

Functional correctness does not prove usability.

Functional evaluation includes:

- deterministic tests,
- schema validation,
- type checks,
- invariant checks,
- performance budgets.

Experiential evaluation includes:

- screenshot inspection,
- interaction traces,
- constrained user-like bots,
- task completion rate,
- friction events,
- visual regressions,
- latency / retry feel,
- accessibility behavior.

For game-like systems, Experience Agents should support:

input constraints
+ timing constraints
+ noise model
+ retry budget
+ outcome metrics

For non-game artifacts, the same concept becomes realistic user-task simulation.

## 13. Release gate

A release candidate needs evidence in four separate layers:

1. Contract validity
2. Functional correctness
3. Experiential quality
4. Operational safety

Release gate records include:

- artifact/version identity,
- acceptance status,
- unresolved confirmed findings,
- deterministic test summary,
- experiential eval summary,
- human blocker status,
- policy-required confirmations,
- rollback reference.

DONE is a verified state, not an agent message.

## 14. Cost and parallelism

More agents are not inherently better.

Forge budgets:

- max concurrent agents,
- max total role invocations,
- max frontier-model calls,
- wall-clock budget,
- token/cost budget,
- expensive tool budget,
- verifier budget.

System One may reduce fan-out when candidate diversity collapses or evidence is already decisive.

> Spend parallelism on independent uncertainty, not duplicated labor.

## 15. Failure handling

Conflicting builders:
Prevent through ownership leases. If conflict occurs, stop and reconcile explicitly.

Contract drift:
Re-enter CONTRACT_FREEZE and invalidate affected reviews.

Reviewer hallucination:
Send medium/high findings through Falsification Gate.

Builder stall:
Retry only bounded idempotent work. Otherwise reassign the lease and preserve partial artifacts.

Flaky tests:
Mark evidence unstable. One green run is not proof.

Context contamination:
Recompile role context and replay when anchoring or irrelevant history is suspected.

Late human rejection:
Preserve prior release evidence, reopen affected assumptions, and do not rewrite history as if the prior gate never passed.

## 16. Security and authority

Forge does not weaken the existing MADO authority boundary.

Deployment, publication, deletion, paid API activation, secrets handling, permission changes, and account changes remain Policy-controlled and may require human confirmation.

Reviewers and skeptical verifiers should be read-only by default.

## 17. Relationship to MADO Game Experience Loop

Forge and MGEL are complementary.

Forge = how a multi-agent production team organizes work.
MGEL = how a game or interactive artifact is observed as an experience.

MGEL can act as Forge's EXPERIENCE_EVAL provider:

Forge BUILD
→ game artifact
→ MGEL fixture-run
→ friction + events + evidence
→ Forge EXPERIENCE_EVAL
→ finding / fix / verify

Game-specific player modeling stays out of the generic Forge core.

## 18. Relationship to Harness

MADO Harness remains the execution substrate.

Forge supplies:

- phase,
- role,
- lease,
- dependency,
- acceptance surface,
- evidence requirements.

Harness supplies:

- process execution,
- tool calls,
- workspace isolation,
- mutation enforcement,
- observation capture,
- cancellation,
- replay hooks.

## 19. Minimal viable implementation

### MAF-M0.0 Schema fixture

Implement pure data contracts for:

- run state,
- candidate,
- jury result,
- ownership lease,
- build report,
- finding,
- falsification result,
- human signal,
- release gate.

Acceptance:

- fixture round-trip,
- invalid transitions rejected,
- ownership overlap detected.

### MAF-M0.1 Deterministic workflow runner

Implement the state machine with fake role adapters.

Acceptance:

- happy-path reaches DONE,
- review failure loops to BUILD,
- confirmed finding loops through FIX,
- human blocker prevents release completion.

### MAF-M0.2 Ownership Harness bridge

Connect leases to a sandboxed file fixture.

Acceptance:

- owner can mutate owned file,
- cross-owner write is blocked or detected,
- cross-owner request is emitted,
- parallel temp outputs do not collide.

### MAF-M0.3 Builder / Reviewer fixture

Use two adapters over a tiny code artifact.

Acceptance:

- builder can falsely claim success,
- reviewer finds a seeded defect,
- DONE is impossible before independent verification.

### MAF-M0.4 Falsification Gate fixture

Seed one real finding and one plausible-but-false finding.

Acceptance:

- verifier confirms the real finding,
- false finding becomes NOT_PROVEN,
- only confirmed finding reaches fixer.

### MAF-M0.5 MGEL bridge

Run a tiny interactive fixture through MGEL and ingest friction evidence.

Acceptance:

- experiential failure can reopen an otherwise functionally passing artifact.

### MAF-M0.6 Human Override fixture

Inject a human friction signal after VERIFY.

Acceptance:

- affected decision reopens,
- prior evidence remains immutable,
- new fix requires fresh verification.

### MAF-M0.7 Live agent adapter

Connect one supported agent runtime behind role adapters. Start in SHADOW / experimental mode.

## 20. Initial directory target

Suggested implementation shape:

src/forge/
- contracts.ts
- state-machine.ts
- ownership.ts
- evidence.ts
- roles.ts
- policy.ts

test/forge/
- schema.test.ts
- state-machine.test.ts
- ownership.test.ts
- falsification.test.ts

fixtures/forge/
- m0-happy/
- m0-review-failure/
- m0-false-finding/

Do not introduce runtime-specific agent code into the contracts layer.

## 21. Metrics

Quality:
- verified_completion_rate
- reviewer_catch_rate
- confirmed_finding_rate
- falsification_rejection_rate
- regression_escape_rate
- human_reopen_rate

Efficiency:
- wall_clock_saved_by_parallelism
- duplicated_work_rate
- blocked_cross_owner_writes
- agent_invocations_per_verified_artifact
- frontier_calls_per_verified_artifact

Experience:
- experiential_failure_after_functional_pass
- friction_events
- task_completion_rate
- human_blocker_rate

Reliability:
- stale_evidence_rate
- flaky_evidence_rate
- orphaned_lease_count
- contract_reopen_count

## 22. Design test

Forge is working when the system can explain:

- why work was parallelized,
- what each agent was allowed to change,
- which claims were independently checked,
- which findings survived attempts to refute them,
- what the human experienced,
- what evidence justified release.

## 23. v0.1 North Star

The goal is not an AI swarm.

The goal is a small, inspectable production organization encoded as software.

Explore independently.
Decide explicitly.
Freeze interfaces.
Parallelize safely.
Distrust self-report.
Falsify important claims.
Observe real experience.
Let humans reopen the loop.
Ship only with evidence.
