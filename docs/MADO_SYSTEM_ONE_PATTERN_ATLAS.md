# MADO_SYSTEM_ONE_PATTERN_ATLAS.md

Version: v0.1
Status: Living catalog
Date: 2026-09-22

## 0. Purpose

The Pattern Atlas names reusable bounded judgments.

Applications should compose these patterns instead of inventing one new decision type per product.

## 1. Universal rules

1. Code owns control flow.
2. Choose from observed candidates when possible.
3. NONE, ABSTAIN, and ESCALATE are valid.
4. Probability is not truth.
5. Confidence is not authority.
6. Decision is not verification.
7. Preserve uncertainty.
8. Trace executed decisions.
9. Thresholds are provider and workload specific.
10. Pattern support must be backed by evidence.

## 2. ROUTE

Question:

> Which capability should handle this?

Use for skills, plugins, MCP servers, tools, adapters, or specialist agents.

Typical composition:

~~~
wide catalog
-> top-K
-> deep descriptions
-> absolute fit
-> capability / NONE
~~~

## 3. COMPUTE

Question:

> How much model or reasoning budget should this task receive?

Use for model tier, reasoning effort, service tier, or number of reads.

COMPUTE is not ROUTE.

ROUTE chooses a capability. COMPUTE chooses how much cognition to spend.

## 4. RANK

Question:

> Which candidates deserve priority?

Use when the candidate set is fixed and ordering matters.

RANK does not remove candidates by itself.

## 5. GATE

Question:

> May this proceed?

Use before consequential execution.

GATE provides decision evidence. Policy owns authority.

A high GATE score never grants permission by itself.

## 6. ACT

Question:

> Which bounded observed action should happen next?

Use for browser, desktop, game, or harness control.

ACT must not invent executable targets when the environment can provide an observed candidate set.

## 7. SCORE

Question:

> How much, how severe, how urgent, or how difficult?

Use for ordinal concepts.

A Score is not the same thing as probability of a proposition.

## 8. ABSTAIN

Question:

> Is the decision surface good enough to decide?

ABSTAIN is usually embedded in another pattern rather than used alone.

Escalation targets can include another read, a stronger provider, the planner, a verifier, or a human.

## 9. SIEVE

Question:

> What information survives into expensive context?

Use for tool output, search results, files, instructions, skills, and conversation chunks.

SIEVE is recall-first and should prefer reversible hiding to destructive deletion.

## 10. WALK

Question:

> Which direction should search explore next?

Use for repeated frontier traversal over large repositories, graphs, or hierarchies.

RANK orders a fixed set. WALK repeatedly chooses the next frontier.

## 11. VERIFY

Question:

> Does a claim match observed evidence?

VERIFY occurs after action or generation.

GATE asks whether execution may happen. VERIFY asks whether the claimed result actually happened.

## 12. Important distinctions

### ROUTE vs COMPUTE

Capability versus amount of reasoning.

### RANK vs SIEVE

Ordering versus context reduction.

### RANK vs WALK

Fixed candidate ordering versus repeated frontier traversal.

### GATE vs VERIFY

Permission evidence before execution versus evidence after execution.

### SCORE vs Noul

Ordinal quantity versus probability-like proposition judgment.

## 13. Pattern compositions

### Capability Router

~~~
SIEVE
-> ROUTE
-> ABSTAIN
~~~

### Safe Computer Use

~~~
ACT
-> ABSTAIN
-> GATE
-> execute
-> VERIFY
~~~

### Cheap Code Review

~~~
SIEVE
-> RANK
-> SCORE
-> ROUTE
-> VERIFY
~~~

### Smart Model Allocation

~~~
SCORE difficulty
-> COMPUTE
-> ABSTAIN upward when uncertain
~~~

### Large Repository Search

~~~
WALK
-> RANK frontier
-> SIEVE contents
-> VERIFY result
~~~

### Evidence Pipeline

~~~
SIEVE
-> SCORE
-> RANK
-> VERIFY
~~~

### Adaptive Structured Read

~~~
bounded read
-> uncertainty check
-> COMPUTE extra reads
-> ABSTAIN / escalate
~~~

### Document Classification and Splitting

~~~
Choice category per page
+
Noul boundary between pages
+
deterministic assembly
~~~

This is composition, not a new SEGMENT pattern.

## 14. API direction

Low-level API:

~~~
systemOne.decide(...)
~~~

Semantic wrappers may later expose:

~~~
mado.route()
mado.compute()
mado.rank()
mado.gate()
mado.act()
mado.score()
mado.sieve()
mado.walk()
mado.verify()
~~~

ABSTAIN normally travels inside each result.

## 15. Adoption priority

P0:
- ROUTE
- ABSTAIN
- VERIFY

P1:
- ACT
- SIEVE
- COMPUTE
- GATE

P2:
- WALK
- RANK
- SCORE

This is implementation priority, not importance ranking.

## 16. Candidate patterns not yet promoted

Potential future patterns:

- NEGOTIATE
- ALLOCATE
- MONITOR

A pattern is promoted only when multiple applications share the same bounded judgment and it cannot be cleanly composed from existing patterns.

## 17. Anti-patterns

Avoid:

- asking System One to generate prose,
- treating confidence as authorization,
- dropping uncertain data in SIEVE,
- omitting NONE,
- allowing ACT to invent targets,
- treating WALK scores as proof,
- copying thresholds between providers,
- measuring benchmark-only latency,
- creating a pattern for every application.

## 18. North Star

A good Pattern Atlas stays small while applications multiply.

The vocabulary should compress many System One projects into a stable set of reusable decisions.
