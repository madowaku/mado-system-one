import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentsRepoAuditHarness,
  OpenAIAgentsHttpTransport,
  buildReadOnlyRepoAuditSession,
  compareHarnessBakeoffRecords,
  parseAgentsSse,
  toHarnessBakeoffRecord,
  toManagedHarnessEvidence,
  type AgentsApiRawEvent,
  type AgentsApiSessionRequest,
  type AgentsApiTransport,
} from "../src/index.js";

class FixtureTransport implements AgentsApiTransport {
  lastRequest?: AgentsApiSessionRequest;

  async *streamSession(
    request: AgentsApiSessionRequest,
  ): AsyncIterable<AgentsApiRawEvent> {
    this.lastRequest = request;
    yield {
      type: "agent.session.created",
      session: { id: "sess-fixture" },
      event_id: "ev-created",
    };
    yield {
      type: "agent.session.turn.output_text.done",
      session_id: "sess-fixture",
      event_id: "ev-text",
      text: "Root synthesis",
    };
    yield {
      type: "agent.session.turn.completed",
      session_id: "sess-fixture",
      event_id: "ev-done",
      turn: {
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 20 },
          output_tokens: 50,
          total_tokens: 150,
        },
      },
    };
  }

  async retrieveSession(): Promise<Readonly<Record<string, unknown>>> {
    return { id: "sess-fixture", status: "idle" };
  }

  async listSessionItems(): Promise<
    readonly Readonly<Record<string, unknown>>[]
  > {
    return [
      {
        id: "root-item-1",
        role: "assistant",
        content: [{ type: "output_text", text: "Root synthesis" }],
      },
    ];
  }

  async listSessionSubagents(): Promise<
    readonly Readonly<Record<string, unknown>>[]
  > {
    return [
      { id: "sub-architecture" },
      { id: "sub-evidence-release" },
    ];
  }

  async listSubagentItems(
    _sessionId: string,
    subagentId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    return [{ id: `${subagentId}-item-1`, role: "assistant", content: [] }];
  }
}

test("repo audit request is read-only and enables bounded multi-agent", () => {
  const request = buildReadOnlyRepoAuditSession({
    model: "fixture-model",
    snapshot: "README content",
    snapshotId: "sha256:abc",
  });

  assert.equal(request.environment.type, "none");
  assert.equal(request.agent.multi_agent.enabled, true);
  assert.equal(request.agent.multi_agent.max_concurrent_subagents, 2);
  assert.equal(request.agent.reasoning.effort, "none");
  assert.equal(request.agent.text.verbosity, "low");
  assert.equal(request.agent.service_tier, "default");
  assert.match(request.agent.instructions, /exactly two bounded specialist/);
  assert.match(request.agent.instructions, /NOT_PROVEN/);
  assert.match(request.input, /<repository_snapshot>/);
  assert.equal("tools" in request.agent, false);
});

test("managed harness collects session, subagent, usage, and recovery evidence", async () => {
  const transport = new FixtureTransport();
  const harness = new AgentsRepoAuditHarness(transport);

  const run = await harness.run({
    model: "fixture-model",
    snapshot: "repo snapshot",
    snapshotId: "sha256:fixture",
  });

  assert.equal(run.terminalStatus, "completed");
  assert.equal(run.sessionId, "sess-fixture");
  assert.equal(run.subagentIds.length, 2);
  assert.equal(run.usage.status, "known");
  assert.equal(run.usage.totalTokens, 150);
  assert.equal(run.usage.cachedInputTokens, 20);
  assert.equal(run.recovery.sessionRetrieved, true);
  assert.equal(run.recovery.rootItemsRetrieved, true);
  assert.equal(run.recovery.subagentItemsRetrieved, true);
  assert.ok(run.evidenceRefs.includes("agents://session/sess-fixture"));
  assert.equal(transport.lastRequest?.environment.type, "none");
});

test("runtime completion never becomes MADO verification", async () => {
  const run = await new AgentsRepoAuditHarness(new FixtureTransport()).run({
    model: "fixture-model",
    snapshot: "repo snapshot",
    snapshotId: "sha256:fixture",
  });

  const evidence = toManagedHarnessEvidence(run);

  assert.equal(evidence.runtimeStatus, "completed");
  assert.equal(evidence.verificationStatus, "not_run");
  assert.match(evidence.detail, /independent Verification has not run/);
});

test("unknown dollar cost stays unknown instead of becoming zero", async () => {
  const run = await new AgentsRepoAuditHarness(new FixtureTransport()).run({
    model: "fixture-model",
    snapshot: "repo snapshot",
    snapshotId: "sha256:fixture",
  });
  const record = toHarnessBakeoffRecord(run);

  assert.equal(record.estimatedCostUsd, null);
  assert.equal(record.totalTokens, 150);
});

test("bakeoff comparison does not invent unavailable comparisons", async () => {
  const run = await new AgentsRepoAuditHarness(new FixtureTransport()).run({
    model: "fixture-model",
    snapshot: "repo snapshot",
    snapshotId: "sha256:fixture",
  });

  const managed = toHarnessBakeoffRecord(run, {
    runtime: "agents-api",
  });
  const baseline = {
    ...managed,
    runtime: "existing-mado-codex",
    totalTokens: null,
    estimatedCostUsd: null,
    madoVerified: null,
  };

  const comparison = compareHarnessBakeoffRecords(managed, baseline);

  assert.equal(comparison.comparable.completion, true);
  assert.equal(comparison.comparable.verification, false);
  assert.equal(comparison.comparable.tokenUsage, false);
  assert.equal(comparison.comparable.dollarCost, false);
});

test("SSE parser handles multiple JSON frames and DONE", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"agent.session.created","session":{"id":"s1"}}\n\n' +
            'data: {"type":"agent.session.turn.completed","session_id":"s1"}\n\n' +
            "data: [DONE]\n\n",
        ),
      );
      controller.close();
    },
  });

  const events: AgentsApiRawEvent[] = [];
  for await (const event of parseAgentsSse(body)) events.push(event);

  assert.equal(events.length, 2);
  assert.equal(events[0]?.type, "agent.session.created");
  assert.equal(events[1]?.type, "agent.session.turn.completed");
});

test("HTTP transport sends Agents beta header and read-only request body", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const encoder = new TextEncoder();

  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"type":"agent.session.turn.completed","session_id":"s-http"}\n\n',
            ),
          );
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  };

  const transport = new OpenAIAgentsHttpTransport({
    apiKey: "test-key",
    baseUrl: "https://api.example/v1",
    fetchFn,
  });

  const request = buildReadOnlyRepoAuditSession({
    model: "fixture-model",
    snapshot: "snapshot",
    snapshotId: "sha256:http",
  });

  const events: AgentsApiRawEvent[] = [];
  for await (const event of transport.streamSession(request)) {
    events.push(event);
  }

  assert.equal(events.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.example/v1/agents/sessions");
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers["OpenAI-Beta"], "agents=v1");
  const body = JSON.parse(String(calls[0]?.init?.body)) as {
    environment: { type: string };
  };
  assert.equal(body.environment.type, "none");
});
