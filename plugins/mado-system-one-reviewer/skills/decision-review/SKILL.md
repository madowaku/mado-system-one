---
name: decision-review
description: Audit agent, automation, router, and multi-agent designs for bounded decisions, abstention paths, policy boundaries, evidence, verification, and provider-semantics risks. Use when the user asks to review or harden an agent workflow, decision system, capability router, autonomous loop, or orchestration design.
---

# MADO Decision Review

Review the supplied design or trace. Do not execute external actions.

## Activate for

Use this skill when the user asks to audit or harden an agent workflow, bounded router or gate, capability-selection system, multi-agent orchestration, context-filtering decision, evidence/verification loop, or provider confidence/calibration design.

Do not activate merely because code contains words such as agent or router.

## Do not activate for

Use normal assistance when the primary goal is general code implementation, generic summarization, creative generation, unrelated research, or external action execution.

If the user explicitly asks to review the design around a consequential action, review it, but never perform the action.

## Procedure

### 1. Establish observed scope

Separate:

- OBSERVED facts,
- reasonable INFERRED implications,
- NOT_PROVEN claims that need evidence.

Never invent state, permissions, candidate completeness, tests, or deployment success.

### 2. Enumerate decision surfaces

For each meaningful decision identify:

- observed candidate set,
- whether the set is known complete,
- consequence class,
- current decision authority,
- fallback.

Check whether NONE, ABSTAIN, ESCALATE, or ASK_HUMAN is missing.

Prefer observed finite candidates over generated executable targets.

### 3. Check authority and Policy

Flag when confidence directly authorizes execution, a model bypasses Policy, consequential actions lack confirmation, or one learned component both recommends and grants permission.

Confidence is not authorization.

### 4. Check Evidence and Verification

A builder or runtime claiming DONE is not proof.

Look for independent evidence such as tests, diffs, screenshots, logs, state reads, reproducible artifacts, or external observations.

Check whether a verifier can independently accept, reject, or return NOT_PROVEN.

### 5. Check provider semantics

When scores or thresholds appear, inspect inference family, probability semantics, confidence semantics, calibration status, and task-family support.

Flag thresholds copied across providers or task families without evaluation.

Wire compatibility does not imply probability or quality compatibility.

### 6. Check context safety

Mandatory context bypasses learned filtering. Hidden context should be recoverable. Non-recoverable information is retained conservatively. Uncertainty escalates rather than forcing destructive deletion.

### 7. Check multi-agent ownership

Look for contract before fan-out, bounded parallelism, one writer per mutable surface where practical, builder/reviewer separation, falsification for consequential findings, and durable Evidence.

## Output

### Scope

State what was reviewed and what was not observed.

### Decision surfaces

Use a compact table with Surface, Current choices, Missing fallback, Consequence, and Evidence status.

### Authority and Policy

Identify conflation of recommendation, confidence, permission, and execution.

### Evidence and Verification

Identify proof available, proof missing, and self-referential verification.

### Provider semantics

Report provider/calibration issues only when relevant. Otherwise say no provider-semantic issue was observed.

### Findings

For each finding include:

- severity: LOW | MEDIUM | HIGH,
- evidence: OBSERVED | INFERRED | NOT_PROVEN,
- concrete reason,
- smallest useful repair.

### Minimal repair plan

Give the smallest ordered changes that restore clear decision, Policy, Evidence, and Verification boundaries.

## Rules

1. Do not upgrade missing information into an observed flaw.
2. Prefer deterministic rules when sufficient.
3. Recommend SHADOW for new learned decision surfaces where practical.
4. Preserve BYPASS / KILL / ROLLBACK for active learned controls.
5. Never use confidence as permission for consequential action.
6. Never call a task successful solely because the acting agent says it is done.
