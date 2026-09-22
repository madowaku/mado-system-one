import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityPager,
  CapabilityRegistry,
  CapabilityResolver,
  MockSystemOneProvider,
  OutcomeCompiler,
  type DecisionRequest,
  type DecisionResponse,
  type OutcomeCompilationDraft,
  type OutcomeCompilerAdapter,
  type TypedResult,
} from "../src/index.js";

const response = (
  request: DecisionRequest,
  results: Readonly<Record<string, TypedResult>>,
): DecisionResponse => ({
  traceId: request.traceId,
  providerId: "outcome-pager-fixture",
  probabilitySemantics: "heuristic",
  results,
});

const registry = new CapabilityRegistry([
  {
    id: "filesystem",
    kind: "native_tool",
    name: "Filesystem",
    shortDescription: "Inspect local project files.",
    fullDescription: "Read project files and metadata without changing them.",
    availability: "available",
  },
  {
    id: "shell",
    kind: "cli",
    name: "Shell",
    shortDescription: "Run deterministic project commands.",
    fullDescription: "Run tests and other local verification commands.",
    availability: "available",
  },
  {
    id: "github",
    kind: "plugin",
    name: "GitHub",
    shortDescription: "Inspect connected repositories and GitHub state.",
    fullDescription: "Use for remote repository content and GitHub actions.",
    availability: "available",
  },
]);

const routingProvider = new MockSystemOneProvider({
  id: "outcome-pager-fixture",
  responder: (request) => {
    const wantsTests = request.state.includes("execute the project tests");
    const selected = wantsTests ? "shell" : "filesystem";

    if ("needsCapability" in request.questions) {
      return response(request, {
        needsCapability: {
          type: "noul",
          probabilityYes: 0.99,
        },
        wideRank: {
          type: "choice",
          selected,
          distribution: wantsTests
            ? { shell: 0.8, filesystem: 0.15, github: 0.05 }
            : { filesystem: 0.82, shell: 0.13, github: 0.05 },
        },
      });
    }

    return response(request, {
      finalChoice: {
        type: "choice",
        selected,
        distribution: wantsTests
          ? { shell: 0.88, filesystem: 0.12 }
          : { filesystem: 0.87, shell: 0.13 },
      },
      ...Object.fromEntries(
        Object.keys(request.questions)
          .filter((questionId) => questionId.startsWith("fit:"))
          .map((questionId) => {
            const capabilityId = questionId.slice("fit:".length);
            return [
              questionId,
              {
                type: "noul" as const,
                probabilityYes: capabilityId === selected ? 0.97 : 0.61,
              },
            ];
          }),
      ),
    });
  },
});

const compileFixture: OutcomeCompilationDraft = {
  outcome: {
    goal: "assess the fixture repository and identify incomplete work",
    deliverables: [
      {
        id: "status-report",
        description: "a concise evidence-backed status report",
      },
    ],
    requiredEvidence: [
      {
        id: "project-state",
        description: "observed project files showing current work state",
      },
      {
        id: "test-result",
        description: "observed result from the project test suite",
      },
    ],
    constraints: ["read-only: do not modify repository files"],
    completionCriteria: [
      {
        id: "evidence-backed",
        description: "all reported incomplete work is supported by observations",
      },
    ],
  },
  capabilityRequirements: [
    {
      id: "inspect-project",
      request: "inspect the local project files and current work state",
      reason: "collect repository-state evidence",
    },
    {
      id: "execute-tests",
      request: "execute the project tests and capture their result",
      reason: "collect verification evidence",
    },
  ],
  assumptions: [
    "the fixture repository is available in the local workspace",
  ],
};

const adapter = (draft: OutcomeCompilationDraft): OutcomeCompilerAdapter => ({
  id: "deterministic-outcome-fixture",
  async compile() {
    return draft;
  },
});

test("Runtime M0.3 compiles intent into outcome contract and capability requirements", async () => {
  const compiler = new OutcomeCompiler({
    adapter: adapter(compileFixture),
  });

  const compiled = await compiler.compile({
    traceId: "outcome-001",
    intent:
      "このrepoの状態を調べて、未完了項目を整理して。ファイルは変更しないで。",
  });

  assert.equal(compiled.compilerId, "deterministic-outcome-fixture");
  assert.equal(
    compiled.outcome.goal,
    "assess the fixture repository and identify incomplete work",
  );
  assert.deepEqual(compiled.outcome.constraints, [
    "read-only: do not modify repository files",
  ]);
  assert.deepEqual(
    compiled.capabilityRequirements.map((requirement) => requirement.id),
    ["inspect-project", "execute-tests"],
  );
  assert.deepEqual(compiled.assumptions, [
    "the fixture repository is available in the local workspace",
  ]);
});

test("Runtime M0.3 output feeds M0.2 Capability Pager without choosing tool ids in the compiler", async () => {
  const compiler = new OutcomeCompiler({
    adapter: adapter(compileFixture),
  });
  const resolver = new CapabilityResolver({
    provider: routingProvider,
    registry,
    config: {
      topK: 2,
      needThreshold: 0.3,
      fitThreshold: 0.4,
    },
  });
  const pager = new CapabilityPager({ resolver, registry });

  const compiled = await compiler.compile({
    traceId: "outcome-002",
    intent: "このrepoの状態とテスト結果を確認して。",
  });

  const paged = await pager.resolve({
    traceId: compiled.traceId,
    requirements: compiled.capabilityRequirements,
  });

  assert.deepEqual(
    paged.capabilities.map((capability) => capability.id),
    ["filesystem", "shell"],
  );
  assert.deepEqual(paged.unresolved, []);
  assert.equal(
    compiled.capabilityRequirements.some(
      (requirement) =>
        requirement.request === "filesystem" || requirement.request === "shell",
    ),
    false,
  );
});

test("Runtime M0.3 rejects duplicate contract ids before they can corrupt evidence mapping", async () => {
  const invalid: OutcomeCompilationDraft = {
    ...compileFixture,
    outcome: {
      ...compileFixture.outcome,
      requiredEvidence: [
        {
          id: "project-state",
          description: "first observation",
        },
        {
          id: "project-state",
          description: "ambiguous duplicate observation",
        },
      ],
    },
  };

  const compiler = new OutcomeCompiler({
    adapter: adapter(invalid),
  });

  await assert.rejects(
    compiler.compile({
      traceId: "outcome-003",
      intent: "inspect the repository",
    }),
    /duplicate evidence requirement id: project-state/,
  );
});

test("Runtime M0.3 allows outcomes that need no specialized capability", async () => {
  const compiler = new OutcomeCompiler({
    adapter: adapter({
      outcome: {
        goal: "explain a supplied concept",
        deliverables: [
          {
            id: "explanation",
            description: "a concise explanation",
          },
        ],
        requiredEvidence: [
          {
            id: "provided-context",
            description: "the context supplied with the request",
          },
        ],
        constraints: [],
        completionCriteria: [
          {
            id: "clear",
            description: "the explanation addresses the supplied concept",
          },
        ],
      },
      capabilityRequirements: [],
    }),
  });

  const compiled = await compiler.compile({
    traceId: "outcome-004",
    intent: "この文章の意味を説明して",
    context: ["fixture context"],
  });

  assert.deepEqual(compiled.capabilityRequirements, []);
  assert.deepEqual(compiled.assumptions, []);
});
