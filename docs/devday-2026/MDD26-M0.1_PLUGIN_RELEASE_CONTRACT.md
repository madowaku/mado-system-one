# MDD26-M0.1 Plugin Release Contract

Version: v0.1
Status: Implemented
Date: 2026-09-30

## Goal

Make one MADO capability mechanically ready for the public Plugin submission flow without requiring a live MCP deployment.

The first product slice is `mado-system-one-reviewer`, a skills-only plugin that audits agent and automation designs for:

- bounded decision surfaces,
- missing NONE / ABSTAIN / ESCALATE outcomes,
- confidence used as authority,
- Policy-boundary leaks,
- weak Evidence,
- missing independent Verification,
- provider-semantics and calibration mistakes,
- unsafe multi-agent ownership assumptions.

It reviews. It does not execute external actions.

## Why skills-only first

M0.1 isolates the release contract from remote-runtime complexity.

The package intentionally has no:

- MCP server,
- OAuth,
- domain verification,
- tool annotations,
- custom UI,
- remote demo credentials.

Those belong to later milestones.

## Package contract

```
plugins/mado-system-one-reviewer/
├─ plugin.json
├─ skills/
│  └─ decision-review/
│     └─ SKILL.md
└─ review/
   ├─ submission.json
   ├─ positive.json
   ├─ negative.json
   └─ PUBLISHER_CHECKLIST.md
```

The root manifest uses the portable Agent Plugins schema. Skills remain self-contained and usable without private repository context.

## Listing contract

Local validation enforces the current directory-facing limits used by this fixture:

- plugin name: valid package characters, at most 64,
- semantic version,
- display name: at most 30,
- short description: at most 30,
- long description: at most 4,000,
- developer name: at most 80,
- supported category,
- at most 20 capabilities,
- at most 3 starter prompts,
- starter prompts: unique, one line, at most 128, no MCP @mention.

The OpenAI portal remains authoritative if these rules change.

## Review fixture contract

M0.1 contains exactly five positive and three negative fixtures.

Positive cases must include:

- realistic user prompt,
- expected activation,
- expected behavior,
- expected result shape,
- reproducible fixture data.

Negative cases must include:

- prompt or scenario,
- expected non-activation or safe fallback,
- reason the plugin should not perform the requested action.

The cases cover distinct failure modes rather than wording variants.

## Skill contract

The skill must:

1. distinguish observed facts, inference, and missing evidence,
2. preserve NOT_PROVEN when evidence is insufficient,
3. never treat confidence as authorization,
4. never treat DONE as verification,
5. recommend NONE / ABSTAIN / ESCALATE when appropriate,
6. keep Policy outside learned decision authority,
7. flag threshold reuse without provider/task-family evaluation,
8. avoid executing external actions.

## Output contract

A normal audit returns:

1. Scope
2. Decision surfaces
3. Authority and Policy
4. Evidence and Verification
5. Provider semantics
6. Findings
7. Minimal repair plan

Finding evidence state:

- OBSERVED
- INFERRED
- NOT_PROVEN

Severity is a review aid, not execution authority.

## Human gates

Repository automation must not pretend these are complete.

Before public submission, a human confirms:

- Apps Management write access,
- verified developer or business identity,
- publisher name matches the verified identity,
- production-ready logo,
- intended countries/regions,
- portal skill safety/security scan,
- final policy attestations.

For the current skills-only ZIP path, public website/support/privacy/terms URLs are optional under the documented submission rules. If supplied, they must be real public HTTPS URLs and accurately match the publisher.

## Validation

```bash
npm run plugin:validate
```

CI runs the same contract validator.

The validator does not replace identity verification, portal security scanning, policy attestations, or OpenAI review.

## Definition of done

M0.1 means:

> package shape, listing metadata, skill scope, review fixtures, and human gates are explicit and automatically checked.

It does not mean approved or published.

## Next

MDD26-M0.2: Event Spine.
