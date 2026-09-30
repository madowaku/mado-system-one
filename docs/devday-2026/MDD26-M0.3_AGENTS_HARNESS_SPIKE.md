# MDD26-M0.3 Agents Harness Spike

Version: v0.1
Status: Implemented / live gate
Date: 2026-09-30

## Purpose

Evaluate OpenAI's managed Agents API as a replaceable MADO Harness implementation without moving Policy, Evidence semantics, or independent Verification into the provider.

The spike is deliberately read-only.

```
selected repo snapshot
  -> Agents API session
  -> root coordinator
     -> architecture-boundary subagent
     -> evidence-release subagent
  -> managed session/items/subagents
  -> MADO evidence refs
  -> independent MADO Verification
```

The Agents API is not promoted merely because the turn completes.

## Official API assumptions captured by the spike

As of 2026-09-30, the official Agents API documentation describes:

- a managed Codex harness,
- persistent sessions,
- automatic orchestration/context compaction/recovery,
- optional execution environments,
- multi-agent delegation enabled with `agent.multi_agent.enabled`,
- bounded concurrent subagents through `max_concurrent_subagents`,
- session streaming,
- saved session items,
- saved subagent records/items,
- best-effort usage reporting.

The raw HTTP transport uses:

- `POST /v1/agents/sessions`,
- `OpenAI-Beta: agents=v1`,
- Bearer API authentication.

Live credentials are not stored in the repository.

## Read-only experiment boundary

M0.3 uses:

```json
{
  "environment": { "type": "none" }
}
```

No function tools, MCP tools, shell, apply-patch, filesystem environment, or external mutation tools are configured.

The agent receives only an allowlisted text snapshot assembled by the local runner.

The ultra-thrift snapshot allowlist is intentionally tiny:

- AGENTS.md,
- package.json,
- src/index.ts,
- test/agents-harness.test.ts,
- this M0.3 spike document.

The default snapshot budget is 12,000 characters total and 3,000 characters per file.

It does not recursively expose the repository and does not read `.env` files.

This isolates the value of managed orchestration from the value or risk of managed execution.

## Bounded multi-agent task

The ultra-thrift live fixture delegates exactly two independent review roles:

1. architecture-boundary-reviewer
2. evidence-release-reviewer

The root waits for both specialists and synthesizes a final response capped by instruction at 250 words. Each specialist is capped by instruction at 120 words.

The live fixture is locked to `gpt-6-luna`, `reasoning.effort: none`, `text.verbosity: low`, `service_tier: default`, and at most two concurrent subagents.

Missing proof remains `NOT_PROVEN`.

## Runtime versus Verification

The official Agents API distinguishes turn completion from tool success. MADO goes one step further:

```
Agents turn completed
        !=
MADO verified
```

`toManagedHarnessEvidence()` always maps the managed run to:

```
verificationStatus: not_run
```

Independent Verification must separately judge the audit result.

This preserves the MADO invariant that a runtime cannot prove itself correct.

## Evidence mapping

The adapter records durable-style references such as:

```
agents://session/<session-id>
agents://session/<session-id>/item/<item-id>
agents://session/<session-id>/subagent/<subagent-id>
agents://session/<session-id>/subagent/<subagent-id>/item/<item-id>
```

These are MADO evidence identifiers, not public URLs.

The adapter retrieves after streaming:

- session state,
- root session items,
- subagent list,
- each subagent's saved items.

This also provides the first recovery evidence surface.

## Stream recovery

Official guidance notes that streams do not replay missed events. After a disconnect, applications should retrieve the session and saved work.

M0.3 therefore treats streaming as observation, not the only durable record.

If streaming fails after a session ID is observed, the harness still attempts to retrieve:

- the session,
- root items,
- subagents,
- subagent items.

Recovery errors remain explicit evidence.

M0.3 does not yet implement cursor-based pagination beyond the first 100 retrieved items per list endpoint.

## Usage and cost

Agents can perform multiple model calls across the root and subagents.

The adapter captures usage from terminal turn events when available.

Usage status is:

- `known`: input and output token fields were observed,
- `partial`: some usage fields were observed,
- `unknown`: no usable usage fields were observed.

Unknown usage is never converted to zero.

The generic bake-off contract still permits unknown cost, but the ultra-thrift runner records a dated cost estimate for the fixed Luna experiment.

Pricing snapshot used by the runner on 2026-09-30:

- input: $0.10 / 1M tokens,
- cached input: $0.01 / 1M tokens,
- output: $0.50 / 1M tokens.

The default soft budget is $0.05.

This is not an API-side hard spend cap. Agents usage is best-effort, pricing can change, and the OpenAI billing/usage dashboard remains authoritative.

The design target is substantially below the soft budget. For example, 30k input plus 4k output tokens at the snapshot rates is about $0.005 before any applicable data-sharing incentive.

## Bake-off record

`HarnessBakeoffRecord` supports side-by-side comparison without inventing a winner.

Dimensions:

- runtime completion,
- independent MADO verification,
- token usage,
- dollar cost,
- evidence reference count,
- recovery availability.

A dimension is marked non-comparable when one side lacks evidence.

## Deterministic fixture

CI does not call the live API.

Fixture tests prove:

1. repository audit request uses `environment.type=none`,
2. multi-agent mode is enabled and bounded,
3. no tools are configured,
4. session/root/subagent evidence is collected,
5. terminal usage is captured when present,
6. runtime completion remains unverified,
7. missing cost stays null,
8. bake-off comparison does not invent unavailable metrics,
9. SSE parsing handles streamed JSON frames,
10. raw HTTP transport sends the Agents beta header.

## Live runner

Prerequisites:

- an OpenAI API key with the required Agents/Responses permissions,
- a positive API account balance.

The thrift fixture chooses GPT-6 Luna itself:

```bash
OPENAI_API_KEY=... npm run agents:spike:live
```

An attempt to override `MADO_AGENTS_MODEL` with a non-Luna model is rejected by this fixture.

Optional:

```bash
MADO_AGENTS_EVIDENCE_OUT=./tmp/mdd26-m0.3-live.json
```

The API key stays in the application process and is not included in the repository snapshot or agent environment.

## Complimentary-token note

The fixture does not assume complimentary API usage.

OpenAI currently offers some eligible organizations daily complimentary tokens for shared API inputs/outputs after opting into data sharing. Eligibility must be visible in the organization's Data Controls page, and a positive account balance is still required. Tool use is excluded from that offer, so M0.3 should be budgeted as if it may be billed.

## Live exit criteria

M0.3 remains a live gate until all of the following are evidenced:

- one authenticated read-only repository audit reaches a terminal turn,
- expected bounded subagent delegation is visible in saved session data,
- root and subagent items map into MADO Evidence,
- independent MADO Verification judges the audit output,
- actual token usage is captured or explicitly remains unknown,
- current-price cost can be compared with an existing MADO/Codex baseline,
- stream recovery is exercised or marked NOT_PROVEN.

## Promotion rule

The result is not:

> Agents API is better because the fixture passed.

The decision must be based on measured MADO workload evidence.

Possible outcomes remain:

- ADOPT as a normal Harness adapter,
- ACTIVE_LIMITED for selected read-only workloads,
- keep EXPERIMENTAL,
- reject for the evaluated task family.

## Next

Only after the live gate should the DevDay track advance to MDD26-M0.4 Browser Computer-Use Fixture.
