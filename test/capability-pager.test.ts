import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityPager,
  CapabilityRegistry,
  CapabilityResolver,
  MockSystemOneProvider,
  type DecisionRequest,
  type DecisionResponse,
} from "../src/index.js";

const registry = new CapabilityRegistry([
  {
    id: "filesystem",
    kind: "native_tool",
    name: "Filesystem",
    shortDescription: "Read project files.",
    fullDescription: "Inspect local project files without mutating them.",
    instructionsRef: "skills/filesystem.md",
    availability: "available",
  },
  {
    id: "shell",
    kind: "cli",
    name: "Shell",
    shortDescription: "Run local commands.",
    fullDescription: "Run deterministic project commands such as tests.",
    instructionsRef: "skills/shell.md",
    availability: "available",
  },
  {
    id: "github",
    kind: "plugin",
    name: "GitHub",
    shortDescription: "Inspect connected GitHub repositories.",
    fullDescription: "Use for remote repository state and GitHub actions.",
    availability: "available",
  },
  {
    id: "offline",
    kind: "native_tool",
    name: "Offline",
    shortDescription: "Unavailable fixture capability.",
    availability: "unavailable",
  },
]);

const response = (
  request: DecisionRequest,
  results: DecisionResponse["results"],
): DecisionResponse => ({
  traceId: request.traceId,
  providerId: "pager-fixture",
  probabilitySemantics: "heuristic",
  results,
});

const routingProvider = new MockSystemOneProvider({
  id: "pager-fixture",
  responder: (request) => {
    const wantsShell = request.state.includes("run the fixture tests");
    const wantsNone = request.state.includes("explain binary search");
    const selected = wantsShell ? "shell" : "filesystem";

    if ("needsCapability" in request.questions) {
      return response(request, {
        needsCapability: {
          type: "noul",
          probabilityYes: wantsNone ? 0.08 : 0.98,
        },
        wideRank: {
          type: "choice",
          selected,
          distribution: wantsShell
            ? { shell: 0.72, filesystem: 0.2, github: 0.08 }
            : { filesystem: 0.71, shell: 0.21, github: 0.08 },
        },
      });
    }

    const results: DecisionResponse["results"] = {
      finalChoice: {
        type: "choice",
        selected,
        distribution: wantsShell
          ? { shell: 0.82, filesystem: 0.18 }
          : { filesystem: 0.81, shell: 0.19 },
      },
    };

    for (const questionId of Object.keys(request.questions)) {
      if (!questionId.startsWith("fit:")) {
        continue;
      }

      const capabilityId = questionId.slice("fit:".length);
      results[questionId] = {
        type: "noul",
        probabilityYes: capabilityId === selected ? 0.96 : 0.66,
      };
    }

    return response(request, results);
  },
});

const makePager = () => {
  const resolver = new CapabilityResolver({
    provider: routingProvider,
    registry,
    config: {
      topK: 2,
      needThreshold: 0.3,
      fitThreshold: 0.4,
    },
  });

  return new CapabilityPager({ resolver, registry });
};

test("Runtime M0.2 pages only selected capabilities for multiple requirements", async () => {
  const result = await makePager().resolve({
    traceId: "pager-001",
    requirements: [
      {
        id: "inspect-project",
        request: "inspect the fixture project files",
        reason: "observe project state",
      },
      {
        id: "run-tests",
        request: "run the fixture tests",
        reason: "collect test evidence",
      },
    ],
  });

  assert.deepEqual(
    result.capabilities.map((capability) => capability.id),
    ["filesystem", "shell"],
  );
  assert.deepEqual(
    result.pages.map((page) => page.capabilityId),
    ["filesystem", "shell"],
  );
  assert.equal(result.pages.some((page) => page.capabilityId === "github"), false);
  assert.equal(result.pages.some((page) => page.capabilityId === "offline"), false);
  assert.deepEqual(result.unresolved, []);

  const filesystem = result.pages.find(
    (page) => page.capabilityId === "filesystem",
  );
  assert.equal(filesystem?.descriptor.instructionsRef, "skills/filesystem.md");
  assert.deepEqual(filesystem?.requirementIds, ["inspect-project"]);
});

test("Runtime M0.2 preserves NONE as unresolved instead of inventing a capability", async () => {
  const result = await makePager().resolve({
    traceId: "pager-002",
    requirements: [
      {
        id: "definition",
        request: "explain binary search",
        reason: "answer a general knowledge question",
      },
    ],
  });

  assert.deepEqual(result.capabilities, []);
  assert.deepEqual(result.pages, []);
  assert.equal(result.unresolved.length, 1);
  assert.deepEqual(result.unresolved[0]?.reasonCodes, [
    "capability_not_needed",
  ]);
});

test("Runtime M0.2 deduplicates one selected capability across requirements", async () => {
  const result = await makePager().resolve({
    traceId: "pager-003",
    requirements: [
      {
        id: "read-readme",
        request: "inspect the fixture project README",
        reason: "understand the project",
      },
      {
        id: "read-todo",
        request: "inspect the fixture project TODO",
        reason: "find incomplete work",
      },
    ],
  });

  assert.equal(result.capabilities.length, 1);
  assert.equal(result.capabilities[0]?.id, "filesystem");
  assert.deepEqual(result.pages[0]?.requirementIds, [
    "read-readme",
    "read-todo",
  ]);
  assert.equal(result.pages[0]?.wideTraceIds.length, 2);
  assert.equal(result.pages[0]?.deepTraceIds.length, 2);
});
