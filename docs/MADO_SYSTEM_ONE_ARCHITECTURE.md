# MADO_SYSTEM_ONE_ARCHITECTURE.md

Version: v0.3
Status: Draft / implementation-aligned
Date: 2026-09-22

## 0. North Star

MADO System One is the bounded-decision and context-control layer around deeper reasoning agents.

It is not another general planner.

~~~
System One   = bounded judgment + context selection
Astra/Codex  = reason / plan / generate
Policy       = allow / confirm / deny
Harness      = execute
Evidence     = observe / record
Verifier     = prove / reject
~~~

The v0.3 expansion is simple:

> Do not only decide what the agent should do. Decide what the agent should see.

## 1. Five operational planes

### 1.1 Decision Plane

Fast bounded judgments over explicit choices.

- ROUTE: who or what capability should handle this?
- COMPUTE: how much reasoning should be spent?
- RANK: what deserves priority?
- GATE: may this proceed?
- ACT: which observed action should happen next?
- SCORE: how much?
- ABSTAIN: is the decision surface good enough?
- WALK: which search direction should be explored?
- VERIFY: does the claim match observed evidence?

### 1.2 Context Plane

Query-aware compilation of context before expensive reasoning.

~~~
raw context
  -> preserve mandatory context
  -> SIEVE relevance
  -> retain / reversible hide / escalate
  -> compiled context
~~~

Future versions may choose among hide, short summary, long summary, and full text.

### 1.3 Capability Plane

Progressive disclosure for tools, skills, plugins, MCP servers, adapters, and harnesses.

~~~
wide short catalog
  -> ROUTE / RANK
  -> top-K
  -> load deep descriptions or schemas
  -> absolute fit gate
~~~

A model should not need every full tool schema in permanent context.

### 1.4 State Plane

Explicit, inspectable state shared across decision surfaces.

State includes current observations, freshness markers, read/write classification, candidate sets, task identity, evidence references, and operational mode.

State is not equivalent to conversation history.

### 1.5 Evidence Plane

The system records what was observed, decided, executed, and verified.

~~~
Observation
  -> Decision Trace
  -> Policy outcome
  -> Execution
  -> Verification
  -> Replay / calibration / specialization
~~~

## 2. Core invariants

1. Code owns control flow.
2. Models choose from observed finite candidates where possible.
3. NONE, ABSTAIN, and ESCALATE are valid outcomes.
4. Probability is not truth.
5. Confidence is not authority.
6. Decision is not verification.
7. Wire compatibility is not probability compatibility.
8. Probability compatibility is not quality compatibility.
9. Thresholds are provider x task-family artifacts, not universal constants.
10. Context hiding must be reversible or conservative.
11. Mandatory policy context is never silently filtered.
12. Provider quality is evaluated per decision pattern, not assumed globally.

## 3. Provider abstraction

All decision engines sit behind SystemOneProvider.

The stable interface lets MADO workflows remain unchanged while providers vary.

### 3.1 Provider families

v0.3 recognizes multiple implementation families.

- hosted_proprietary: hosted System One services such as TypeSafe Jev
- generative_logits: autoregressive next-token or score based providers
- diffusion_structured_read: bounded structured reads from diffusion-style runtimes
- encoder_scoring: BERT or NLI style candidate scoring
- specialist_classifier: tiny task-specific models
- hybrid: deterministic and learned scoring combined

No family is presumed universally superior.

## 4. Provider semantics are first-class

A provider profile includes:

- inference_family
- specialization
- probability_semantics
- confidence_semantics
- calibration_status
- pattern_support

### 4.1 Probability semantics

Supported descriptors:

- direct_logits
- sampled_agreement
- generated_probability
- heuristic
- provider_defined
- unknown

### 4.2 Confidence semantics

Supported descriptors:

- selected_probability
- normalized_entropy
- margin
- provider_defined
- unknown

The same numeric value can mean different things under different semantics.

### 4.3 Calibration status

Supported states:

- uncalibrated
- partially_calibrated
- calibrated
- unknown

An API-compatible local provider must not inherit thresholds from another provider simply because both return a number between zero and one.

## 5. Provider x Pattern suitability

Provider bake-offs are pattern-specific.

A provider can be strong for SIEVE or RANK while remaining unvalidated for GATE or ACT.

MADO records support as:

- validated
- supported
- experimental
- unsupported
- unknown

with evidence references where available.

Implementing Choice does not imply being safe and useful for every Choice-shaped task.

## 6. Typed decision primitives

### Choice

Choose from a finite set.

Use for capability routing, candidate selection, next action, model tier, and category selection.

### Noul

Probability-like judgment over a proposition.

Use for relevance, boundary detection, fit, permission evidence, and completion evidence.

A Noul result is not a Boolean authorization.

### Score

Ordinal or scalar bounded judgment.

Use for urgency, difficulty, severity, context detail level, and review priority.

## 7. Pattern composition

MADO prefers composing small decisions over inventing a new giant decision type.

A document splitter is a useful example:

~~~
for each page:
  Choice(category)

for each possible boundary:
  Noul(starts_new_document)

then:
  deterministic assembly
~~~

The important architecture lesson is that same category does not imply same document.

Independent typed decisions can represent different semantic dimensions, and code combines them deterministically.

Do not create a new Pattern Atlas entry merely because an application is new.

## 8. Context Plane

The Context Plane answers:

> What information should the expensive reasoning model see for this task?

Inputs can include conversation history, tool output, search results, file contents, AGENTS.md sections, skill descriptions, tool schemas, observations, and prior traces.

### 8.1 v0.3 sieve rule

~~~
mandatory?
  yes -> retain

relevance >= retain threshold
  -> retain

relevance <= hide threshold
  + restoration reference exists
  -> hide reversibly

relevance <= hide threshold
  + no restoration reference
  -> retain conservatively

between thresholds
  -> escalate
~~~

### 8.2 Reversible hiding

Hide is not delete.

Hidden material retains a restoration reference so a downstream agent or verifier can recover it.

## 9. Dynamic instructions and capabilities

The same Context Plane can compile instructions.

Examples:

- frontend task -> load style guide
- editing a sensitive directory -> load its gotchas
- writing task -> load writing examples
- GitHub task -> load GitHub deep schema
- unrelated task -> keep only a short GitHub catalog description

This extends progressive disclosure from Skills to the whole harness.

## 10. Decision membrane

System One often sits immediately before expensive, repeated, or consequential operations.

~~~
planner intent
  -> decision membrane
  -> tool / model / subagent / mutation
~~~

Typical membranes include browser research, subagent spawning, retry loops, large context loads, model escalation, and consequential actions.

## 11. Authority boundary

Learned confidence never creates execution authority.

~~~
decision
  -> Policy
  -> allow / confirm / deny
  -> Harness
~~~

High-impact operations remain subject to explicit policy and, where appropriate, human confirmation.

## 12. Verification boundary

A provider may choose DONE. That does not prove completion.

Verification should use observed world state or deterministic invariants where possible.

## 13. Operational lifecycle

Each new provider or decision surface should normally move through:

~~~
OFF
-> SHADOW
-> CALIBRATING
-> ACTIVE_LIMITED
-> ACTIVE
-> ACTIVE_WITH_ESCALATION
-> SPECIALIZING
-> LOCALIZED
~~~

BYPASS, KILL, and ROLLBACK remain available in active operation.

## 14. Specialization lifecycle

Repeated stable decisions can migrate downward:

~~~
general provider
  -> decision traces
  -> verified labels
  -> specialist training
  -> shadow bake-off
  -> tiny local specialist
  -> uncertain: general System One
  -> still uncertain: Astra / Human
~~~

Logs are candidate training data, not labels by default.

## 15. Evaluation model

MADO evaluates four separate layers.

1. Contract validity: is the response structurally valid?
2. Semantic quality: was the decision correct or useful on the task?
3. Calibration: do probability and confidence values behave as claimed?
4. Operational safety: did policy, fallback, and verification prevent unacceptable outcomes?

Passing one layer does not imply passing the next.

## 16. Current implementation status

- M0.0 Core contracts: complete
- M0.1 Capability Router fixture: complete
- v0.3 Provider semantics hardening: implemented on feature branch
- v0.3 Context Sieve fixture: implemented on feature branch
- M0.2 TypeSafe Jev provider: next
- M0.3 Replay provider
- M0.4 Policy gate
- M0.5 Typed Action Loop fixture
- M0.6 Pattern-aware provider bake-off
- M0.7 Context Sieve eval pack
- M0.8 Structured Read provider
- M0.9 Multimodal typed decision

## 17. Architecture ADRs

### ADR-01: Probability semantics are part of the contract

A probability-like value is uninterpretable without its origin and calibration context.

### ADR-02: Provider family is observable

MADO records whether a decision came from logits, encoder scoring, structured reads, a specialist classifier, or an opaque hosted provider.

### ADR-03: Suitability is pattern-specific

A provider does not earn a global good-System-One label.

### ADR-04: Context is compiled dynamically

Persistent context is not assumed to be correct context for every turn.

### ADR-05: Hiding is reversible

Context reduction optimizes attention without destroying evidence.

### ADR-06: Small decisions compose

Applications should reuse ROUTE, Choice, Noul, Score, SIEVE, and other primitives rather than create one pattern per product.

## 18. v0.3 North Star

MADO System One is:

bounded decision architecture
+ provider semantic contracts
+ query-aware context compilation
+ progressive capability disclosure
+ explicit state
+ evidence-driven operations

The system becomes more capable not by asking one model to do everything, but by placing small, inspectable judgments at the right boundaries.
