import assert from "node:assert/strict";
import test from "node:test";

import {
  PolicyGate,
  SystemOneRuntime,
  type RuntimeDefinition,
  type ToolAdapter,
} from "../src/index.js";

const fixedNow = "2026-09-22T00:00:00.000Z";

const fixtureDefinition: RuntimeDefinition = {
  outcome: {
    goal: "identify incomplete work in a fixture project",
    deliverables: [
      {
        id: "report",
        description: "current state and incomplete work report",
      },
    ],
    requiredEvidence: [
      {
        id: "todo-snapshot",
        description: "observed TODO state",
      },
      {
        id: "test-result",
        description: "observed test result",
      },
    ],
    constraints: ["read-only"],
    completionCriteria: [
      {
        id: "evidence-backed-report",
        description: "report conclusions are backed by required evidence",
      },
    ],
  },
  plan: {
    capabilities: [
      {
        id: "filesystem",
        reason: "inspect fixture project files",
      },
      {
        id: "shell",
        reason: "run fixture tests",
      },
    ],
    actions: [
      {
        id: "read-todo",
        capability: "filesystem",
        operation: "read",
        input: { path: "TODO.md" },
        reason: "observe incomplete work",
        sideEffect: false,
      },
      {
        id: "run-tests",
        capability: "shell",
        operation: "test",
        input: { command: "npm test" },
        reason: "collect test evidence",
        sideEffect: false,
      },
    ],
  },
};

const adapters: readonly ToolAdapter[] = [
  {
    capabilityId: "filesystem",
    async execute(operation) {
      assert.equal(operation, "read");
      return {
        ok: true,
        output: "[x] CLI skeleton\n[x] config loader\n[ ] validation\n[ ] smoke test",
        evidence: [
          {
            type: "file_snapshot",
            source: "fixture-project/TODO.md",
            description: "TODO snapshot",
            requirementIds: ["todo-snapshot"],
            data: {
              completed: ["CLI skeleton", "config loader"],
              incomplete: ["validation", "smoke test"],
            },
          },
        ],
      };
    },
  },
  {
    capabilityId: "shell",
    async execute(operation) {
      assert.equal(operation, "test");
      return {
        ok: true,
        output: "2 passing",
        evidence: [
          {
            type: "test_result",
            source: "fixture-project",
            description: "fixture test execution",
            requirementIds: ["test-result"],
            data: { passed: 2, failed: 0 },
          },
        ],
      };
    },
  },
];

test("M0 smoke: intent contract -> policy -> execution -> evidence -> verification", async () => {
  const runtime = new SystemOneRuntime({
    policy: new PolicyGate({
      rules: [
        {
          capability: "filesystem",
          operation: "read",
          decision: "auto",
          reason: "read-only fixture inspection",
        },
        {
          capability: "shell",
          operation: "test",
          decision: "auto",
          reason: "read-only fixture test",
        },
      ],
    }),
    adapters,
    now: () => fixedNow,
  });

  const run = runtime.createRun(
    "このfixture projectの状態を調べて、未完了項目を整理したレポートを作って。ファイルは変更しないで。",
    fixtureDefinition,
  );

  const result = await runtime.execute(run);

  assert.equal(result.status, "completed");
  assert.equal(result.verification?.success, true);
  assert.deepEqual(result.verification?.missing, []);
  assert.equal(result.evidence.length, 2);
  assert.equal(result.actions.every((action) => action.status === "executed"), true);
});

test("M0.1 human gate: ASK pauses and the same run resumes after approval", async () => {
  const runtime = new SystemOneRuntime({
    policy: new PolicyGate({
      rules: [
        {
          capability: "github",
          operation: "create_issue",
          decision: "ask",
          reason: "creating an issue changes external state",
        },
      ],
    }),
    adapters: [
      {
        capabilityId: "github",
        async execute() {
          return {
            ok: true,
            output: { url: "https://github.com/example/repo/issues/1" },
            evidence: [
              {
                type: "url",
                source: "github",
                description: "created issue",
                requirementIds: ["issue-url"],
              },
            ],
          };
        },
      },
    ],
    now: () => fixedNow,
  });

  const definition: RuntimeDefinition = {
    outcome: {
      goal: "create one issue",
      deliverables: [{ id: "issue", description: "GitHub issue" }],
      requiredEvidence: [{ id: "issue-url", description: "created issue URL" }],
      constraints: [],
      completionCriteria: [{ id: "created", description: "issue exists" }],
    },
    plan: {
      capabilities: [{ id: "github", reason: "create the requested issue" }],
      actions: [
        {
          id: "create-issue",
          capability: "github",
          operation: "create_issue",
          input: { title: "Add validation" },
          reason: "publish the observed incomplete item",
          sideEffect: true,
        },
      ],
    },
  };

  const initial = runtime.createRun("未完了作業をissueにして", definition);
  const paused = await runtime.execute(initial);

  assert.equal(paused.status, "requires_action");
  assert.equal(paused.actions[0]?.status, "planned");

  const approved = runtime.approve(paused, "create-issue", "approved by human");
  const resumed = await runtime.execute(approved);

  assert.equal(resumed.id, initial.id);
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.actions[0]?.status, "executed");
});

test("M0.3 evidence failure: tool success does not imply task success", async () => {
  const runtime = new SystemOneRuntime({
    policy: new PolicyGate({
      rules: [
        {
          capability: "shell",
          operation: "build",
          decision: "auto",
          reason: "fixture build",
        },
      ],
    }),
    adapters: [
      {
        capabilityId: "shell",
        async execute() {
          return {
            ok: true,
            output: "build succeeded",
            evidence: [
              {
                type: "command_output",
                source: "build",
                description: "build command exited successfully",
                requirementIds: ["build-result"],
              },
            ],
          };
        },
      },
    ],
    now: () => fixedNow,
  });

  const definition: RuntimeDefinition = {
    outcome: {
      goal: "prove that the web app visibly renders",
      deliverables: [{ id: "app", description: "rendering app" }],
      requiredEvidence: [
        { id: "build-result", description: "successful build" },
        { id: "visual-proof", description: "visual verification" },
      ],
      constraints: [],
      completionCriteria: [{ id: "visible", description: "app visibly renders" }],
    },
    plan: {
      capabilities: [{ id: "shell", reason: "build the app" }],
      actions: [
        {
          id: "build",
          capability: "shell",
          operation: "build",
          input: {},
          reason: "produce build evidence",
          sideEffect: false,
        },
      ],
    },
  };

  const result = await runtime.execute(
    runtime.createRun("画面が正しく表示されることを確認して", definition),
  );

  assert.equal(result.status, "failed");
  assert.deepEqual(result.verification?.missing, ["visual-proof"]);
});
