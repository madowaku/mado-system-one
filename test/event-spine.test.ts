import assert from "node:assert/strict";
import test from "node:test";

import {
  EventSpine,
  ManualEventProvider,
  McpEventsAdapter,
  OPENAI_MCP_EVENTS_PROTOCOL_VERSION,
  PollingEventProvider,
  mcpSubscriptionIdentity,
  type EventPolicyEvaluator,
  type EventTaskExecutor,
  type EventTaskPlanner,
  type EventVerifier,
} from "../src/index.js";

const clock = () => "2026-09-30T04:00:00.000Z";

const allowPolicy: EventPolicyEvaluator = {
  async evaluate() {
    return "allow";
  },
};

const planner: EventTaskPlanner = {
  async plan(event) {
    return {
      taskId: `task-${event.eventId}`,
      eventId: event.eventId,
      description: `Analyze ${event.type} for ${event.subject}`,
      readOnly: true,
    };
  },
};

test("manual event completes task -> verify -> evidence and suppresses retry", async () => {
  const provider = new ManualEventProvider();
  let executionCalls = 0;

  const executor: EventTaskExecutor = {
    async execute(task) {
      executionCalls += 1;
      return {
        taskId: task.taskId,
        status: "completed",
        summary: "analysis produced",
        evidenceRefs: ["evidence://analysis/1"],
      };
    },
  };

  const verifier: EventVerifier = {
    async verify() {
      return {
        status: "pass",
        evidenceRefs: ["evidence://verify/1"],
        detail: "Independent fixture check passed.",
      };
    },
  };

  const spine = new EventSpine({
    policy: allowPolicy,
    planner,
    executor,
    verifier,
    clock,
  });

  const event = await provider.normalize({
    eventId: "evt-001",
    type: "issue.created",
    subject: "issue-42",
    occurredAt: "2026-09-30T03:59:00.000Z",
    payload: { title: "Bug report" },
    dedupeKey: "github:issue-42:analysis-v1",
  });

  const first = await spine.process(event);
  const retry = await spine.process(event);

  assert.equal(first.status, "completed");
  assert.equal(first.evidence.verificationStatus, "pass");
  assert.deepEqual(first.evidence.evidenceRefs, [
    "evidence://analysis/1",
    "evidence://verify/1",
  ]);
  assert.equal(retry.status, "duplicate");
  assert.equal(retry.evidence.policyOutcome, "not_evaluated");
  assert.equal(executionCalls, 1);
  assert.equal(spine.ledger().entries().length, 1);
});

test("semantic dedupe key suppresses a different event id before execution", async () => {
  const provider = new ManualEventProvider();
  let executionCalls = 0;

  const executor: EventTaskExecutor = {
    async execute(task) {
      executionCalls += 1;
      return {
        taskId: task.taskId,
        status: "completed",
        summary: "ok",
        evidenceRefs: [],
      };
    },
  };

  const verifier: EventVerifier = {
    async verify() {
      return { status: "pass", evidenceRefs: [], detail: "ok" };
    },
  };

  const spine = new EventSpine({ policy: allowPolicy, planner, executor, verifier, clock });

  const first = await provider.normalize({
    eventId: "evt-100",
    type: "build.ready",
    subject: "build-7",
    occurredAt: "2026-09-30T03:00:00Z",
    payload: {},
    dedupeKey: "build-7:qa-v1",
  });
  const duplicateMeaning = await provider.normalize({
    eventId: "evt-101",
    type: "build.ready",
    subject: "build-7",
    occurredAt: "2026-09-30T03:01:00Z",
    payload: {},
    dedupeKey: "build-7:qa-v1",
  });

  assert.equal((await spine.process(first)).status, "completed");
  assert.equal((await spine.process(duplicateMeaning)).status, "duplicate");
  assert.equal(executionCalls, 1);
});

test("Policy confirmation blocks Harness execution", async () => {
  const provider = new ManualEventProvider();
  let executionCalls = 0;

  const policy: EventPolicyEvaluator = {
    async evaluate(event) {
      return event.policy.requiresHuman ? "confirm" : "allow";
    },
  };

  const executor: EventTaskExecutor = {
    async execute(task) {
      executionCalls += 1;
      return { taskId: task.taskId, status: "completed", summary: "should not run", evidenceRefs: [] };
    },
  };

  const verifier: EventVerifier = {
    async verify() {
      return { status: "pass", evidenceRefs: [], detail: "unused" };
    },
  };

  const spine = new EventSpine({ policy, planner, executor, verifier, clock });
  const event = await provider.normalize({
    eventId: "evt-confirm",
    type: "release.publish_requested",
    subject: "release-9",
    occurredAt: "2026-09-30T03:10:00Z",
    payload: {},
    dedupeKey: "release-9:publish",
    policy: { risk: "external_side_effect", requiresHuman: true },
  });

  const result = await spine.process(event);

  assert.equal(result.status, "confirmation_required");
  assert.equal(result.evidence.executionStatus, "not_run");
  assert.equal(executionCalls, 0);
});

test("Verifier failure prevents a successful Event Spine result", async () => {
  const provider = new ManualEventProvider();

  const executor: EventTaskExecutor = {
    async execute(task) {
      return {
        taskId: task.taskId,
        status: "completed",
        summary: "builder says done",
        evidenceRefs: ["evidence://builder/claim"],
      };
    },
  };

  const verifier: EventVerifier = {
    async verify() {
      return {
        status: "fail",
        evidenceRefs: ["evidence://verifier/failure"],
        detail: "Expected artifact was not observed.",
      };
    },
  };

  const spine = new EventSpine({ policy: allowPolicy, planner, executor, verifier, clock });
  const event = await provider.normalize({
    eventId: "evt-verify-fail",
    type: "artifact.changed",
    subject: "artifact-1",
    occurredAt: "2026-09-30T03:20:00Z",
    payload: {},
  });

  const result = await spine.process(event);

  assert.equal(result.status, "verification_failed");
  assert.equal(result.evidence.executionStatus, "completed");
  assert.equal(result.evidence.verificationStatus, "fail");
  assert.equal(spine.ledger().get(event.eventId)?.status, "failed");
});

test("MCP Events adapter preserves event identity and protocol metadata", async () => {
  const adapter = new McpEventsAdapter({
    source: "mcp:docs",
    subjectFromData: (data) => String(data.document_id),
  });

  const event = await adapter.normalize({
    eventId: "evt-mcp-1",
    name: "comment.created",
    timestamp: "2026-10-01T12:05:00Z",
    data: {
      document_id: "doc-123",
      comment_id: "comment-456",
    },
    cursor: null,
  });

  assert.equal(event.eventId, "evt-mcp-1");
  assert.equal(event.type, "comment.created");
  assert.equal(event.subject, "doc-123");
  assert.equal(event.metadata?.protocolVersion, OPENAI_MCP_EVENTS_PROTOCOL_VERSION);
  assert.equal(event.metadata?.delivery, "webhook");
});

test("MCP subscription identity is stable across argument key order", () => {
  const left = mcpSubscriptionIdentity({
    principal: "user-1",
    callbackUrl: "https://receiver.example/callback",
    eventName: "comment.created",
    arguments: { document_id: "doc-1", project_id: "project-1" },
  });
  const right = mcpSubscriptionIdentity({
    principal: "user-1",
    callbackUrl: "https://receiver.example/callback",
    eventName: "comment.created",
    arguments: { project_id: "project-1", document_id: "doc-1" },
  });

  assert.equal(left, right);
});


test("polling fallback normalizes freshness into a stable dedupe key", async () => {
  const provider = new PollingEventProvider("build-system");
  const event = await provider.normalize({
    eventId: "poll-1",
    type: "build.ready",
    subject: "build-44",
    occurredAt: "2026-09-30T03:30:00Z",
    payload: { status: "ready" },
    freshnessToken: "etag-abc",
  });

  assert.equal(event.source, "polling:build-system");
  assert.equal(event.metadata?.delivery, "polling");
  assert.equal(event.metadata?.freshnessToken, "etag-abc");
  assert.match(event.dedupeKey, /etag-abc$/);
});
