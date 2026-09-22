# MADO_SYSTEM_ONE_CONTEXT_PLANE_SPEC.md

Version: v0.1
Status: Experimental
Date: 2026-09-22

## 0. Purpose

The Context Plane controls what information reaches expensive reasoning.

It does not replace the planner. It compiles task-specific context from a larger information space.

~~~
available information
  -> Context Plane
  -> task-specific context
  -> Astra / Codex / subagent
~~~

Core question:

> What does this reasoning step need to see, at what fidelity, right now?

## 1. Why a Context Plane exists

Long-running agents accumulate conversation, tool outputs, file reads, search results, instructions, skill descriptions, tool schemas, traces, and observations.

A single permanent context has three problems:

1. irrelevant material consumes attention and tokens,
2. generic summarization may remove task-specific detail,
3. different subtasks need different views of the same state.

Context should therefore be treated as a compiled artifact.

## 2. Relationship to SIEVE

SIEVE is the first Context Plane primitive.

~~~
Context Plane
  -> SIEVE
     -> retain
     -> hide reversibly
     -> escalate uncertainty
~~~

Future primitives may choose fidelity rather than binary visibility.

## 3. ContextChunk contract

A ContextChunk contains:

- id
- kind
- content
- optional summary
- optional sourceRef
- optional restorationRef
- optional mandatory flag
- optional sensitivity
- optional metadata

Kinds include conversation, tool_output, document, instruction, skill, code, observation, and other.

## 4. Mandatory context

Mandatory context bypasses learned filtering.

Examples include safety policy, execution constraints, user-required output constraints, organizational controls, and invariants needed to interpret state.

~~~
mandatory = true
-> RETAIN
~~~

System One confidence cannot remove mandatory context.

## 5. Reversible hiding

The Context Plane distinguishes hide from delete.

A low-relevance chunk may be hidden only when the system can recover it.

Typical restoration references:

- repo:path
- trace:id
- artifact:id
- document:range
- conversation:turn
- tool-output:id

If no restoration reference exists, v0.1 retains the chunk conservatively.

## 6. Uncertainty band

v0.1 uses two thresholds.

~~~
0 --- hide --- uncertain --- retain --- 1
~~~

Rules:

- p <= hideThreshold: reversible hide if possible
- hideThreshold < p < retainThreshold: ESCALATE
- p >= retainThreshold: RETAIN

There is deliberately no forced binary decision in the middle.

Thresholds are provider- and workload-specific.

## 7. v0.1 algorithm

~~~
input task + chunks
  -> separate mandatory chunks
  -> mandatory chunks: retain
  -> Noul relevance for remaining chunks
  -> high relevance: retain
  -> low relevance + restorable: hide
  -> low relevance + non-restorable: retain
  -> uncertain: escalate
  -> compiled context plan
~~~

The first implementation returns a plan. It does not physically delete source material.

## 8. Future fidelity control

A later Context Plane may replace binary visibility with a Score-like fidelity decision:

- 0: do not show
- 1: short summary
- 2: detailed summary
- 3: full content

The model chooses fidelity. Code performs loading and summarization.

## 9. Conditional AGENTS.md

Instructions can be compiled dynamically.

Example:

- core instructions: always
- frontend style guide: only for frontend work
- security gotchas: only when touching sensitive paths
- Blender instructions: only for Blender work
- deploy runbook: only near deployment

Mandatory policy remains outside learned filtering.

## 10. Conditional Skills

Skill discovery follows progressive disclosure.

~~~
short skill catalog
  -> SIEVE / ROUTE
  -> candidate skills
  -> load full SKILL.md only when relevant
~~~

The Context Plane decides what descriptions survive. The Capability Plane decides what capability fits.

## 11. Conditional tool schemas

A harness may expose hundreds of tools while only a few are relevant.

Preferred flow:

~~~
short capability summaries
  -> ROUTE
  -> top-K tools
  -> load full schema
  -> planner chooses or calls tool
~~~

This reduces permanent tool-schema context without hiding what capabilities exist.

## 12. Tool-output reduction

Tool output is a prime SIEVE target.

Examples include long grep output, compiler logs, browser extraction, test logs, repository listings, and telemetry.

Blocks can be hidden behind restoration keys. A downstream agent should be able to request restoration when new evidence makes a chunk relevant.

## 13. State Plane boundary

Context is a view of state.

State itself should not disappear when context is filtered.

~~~
State Plane
  complete explicit state
  -> Context Plane
  task-specific view
  -> Reasoner
~~~

This distinction enables multiple subagents to receive different context views over the same underlying state.

## 14. Read versus write

Context compilation is read-only.

It may decide what to show, but it does not mutate world state.

This makes it suitable for background processing, parallel relevance scoring, prefetch planning, and review preparation.

Writes remain in Harness plus Policy.

## 15. Security and sensitivity

Sensitivity metadata constrains eligible providers.

Example policy:

- public: approved cloud or local
- internal: approved provider set
- private: local preferred
- secret: never transmit as model context

A relevance score never overrides data-governance policy.

## 16. Calibration

A Context Sieve threshold is meaningful only relative to provider semantics.

The system records provider, model, inference family, probability semantics, confidence semantics, calibration status, and threshold profile.

Do not copy a threshold from one provider to another without evaluation.

## 17. Evaluation

Primary metrics:

- retained_recall
- false_drop_rate
- uncertain_rate
- context_reduction_ratio
- tokens_avoided
- restoration_rate
- downstream_task_success
- latency
- cost

The most dangerous failure is a false drop that removes information required for task success.

Context Plane evaluation should therefore be recall-first.

## 18. Replay

Context decisions should be replayable.

~~~
historical task
+ original chunks
+ known downstream outcome
  -> new provider / thresholds
  -> counterfactual context plan
  -> compare task success
~~~

This supports safe threshold tuning and provider bake-offs.

## 19. Pattern suitability

Different provider families may suit Context Plane tasks differently.

Evaluation hypotheses:

- encoder_scoring may be strong for high-throughput relevance scoring
- generative_logits may be useful for flexible changing schemas
- specialist_classifier may be useful for stable high-frequency chunk families
- hosted_proprietary may be useful as a general fallback

These are hypotheses to test, not architectural assumptions.

## 20. Interaction with COMPUTE

Context and model routing must be optimized together.

A cheaper model is not necessarily a cheaper workflow if it repeatedly reprocesses a huge context.

Preferred optimization:

~~~
SIEVE context
+ COMPUTE model and reasoning budget
-> total workflow cost / quality decision
~~~

## 21. Interaction with subagents

A subagent should receive task + explicit relevant state + a task-specific context view rather than automatically inheriting the entire parent conversation.

The parent preserves full state and evidence references.

## 22. Evidence contract

Every context decision should be traceable to:

- chunk id
- disposition
- relevance value if present
- provider semantics
- reason code
- restoration reference

This makes context loss inspectable.

## 23. v0.1 implementation contract

The current fixture implements:

- mandatory -> retain
- high relevance -> retain
- low relevance + restorationRef -> hide
- low relevance + no restorationRef -> retain
- uncertain -> escalate

It intentionally does not yet implement summaries, batching strategies, token budgets, automatic restoration, provider routing, calibration fitting, or sensitivity routing.

## 24. Milestones

- C0.0 ContextChunk contracts: complete
- C0.1 Reversible ContextSieve fixture: complete
- C0.2 Context trace serialization
- C0.3 Replay fixture
- C0.4 Eval pack with false-drop metric
- C0.5 Conditional AGENTS.md spike
- C0.6 Skill/schema progressive loading
- C0.7 Fidelity Score experiment
- C0.8 Provider x SIEVE bake-off

## 25. North Star

The Context Plane is successful when a reasoning model receives all information required for success, as little irrelevant information as practical, and a reliable path to recover what was hidden.

Context reduction is not deletion. It is task-aware attention management.
