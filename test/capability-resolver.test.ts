import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityRegistry,
  CapabilityResolver,
  MockSystemOneProvider,
  type DecisionRequest,
  type DecisionResponse,
} from "../src/index.js";

const registry = new CapabilityRegistry([
  {
    id: "github",
    kind: "plugin",
    name: "GitHub",
    shortDescription: "Inspect repositories, issues, pull requests, and code.",
    fullDescription: "Use for work that depends on repository content or GitHub actions.",
    availability: "available",
  },
  {
    id: "browser",
    kind: "browser",
    name: "Browser",
    shortDescription: "Browse public web pages.",
    fullDescription: "Use for current public web information outside connected repositories.",
    availability: "available",
  },
  {
    id: "computer-use",
    kind: "computer_use",
    name: "Computer Use",
    shortDescription: "Operate graphical interfaces.",
    availability: "available",
  },
  {
    id: "offline-tool",
    kind: "native_tool",
    name: "Unavailable Tool",
    shortDescription: "Should never enter the candidate set.",
    availability: "unavailable",
  },
]);

const makeResponse = (
  request: DecisionRequest,
  results: DecisionResponse["results"],
): DecisionResponse => ({
  traceId: request.traceId,
  providerId: "fixture",
  probabilitySemantics: "heuristic",
  results,
});

test("returns NONE before deep ranking when no capability is needed", async () => {
  let calls = 0;

  const provider = new MockSystemOneProvider({
    id: "fixture",
    responder: (request) => {
      calls += 1;
      return makeResponse(request, {
        needsCapability: {
          type: "noul",
          probabilityYes: 0.12,
        },
        wideRank: {
          type: "choice",
          selected: "browser",
          distribution: {
            github: 0.2,
            browser: 0.7,
            "computer-use": 0.1,
          },
        },
      });
    },
  });

  const resolver = new CapabilityResolver({
    provider,
    registry,
    config: {
      topK: 2,
      needThreshold: 0.3,
      fitThreshold: 0.4,
    },
  });

  const result = await resolver.resolve({
    traceId: "route-001",
    request: "Explain what a binary search is.",
  });

  assert.equal(result.suggestedCapability, null);
  assert.deepEqual(result.reasonCodes, ["capability_not_needed"]);
  assert.equal(calls, 1);
});

test("uses wide ranking then deep absolute fit to produce an advisory suggestion", async () => {
  const seenStates: string[] = [];

  const provider = new MockSystemOneProvider({
    id: "fixture",
    responder: (request) => {
      seenStates.push(request.state);

      if ("needsCapability" in request.questions) {
        assert.equal(request.state.includes("Unavailable Tool"), false);

        return makeResponse(request, {
          needsCapability: {
            type: "noul",
            probabilityYes: 0.97,
          },
          wideRank: {
            type: "choice",
            selected: "browser",
            distribution: {
              github: 0.44,
              browser: 0.51,
              "computer-use": 0.05,
            },
          },
        });
      }

      return makeResponse(request, {
        finalChoice: {
          type: "choice",
          selected: "github",
          distribution: {
            github: 0.73,
            browser: 0.27,
          },
        },
        "fit:github": {
          type: "noul",
          probabilityYes: 0.94,
        },
        "fit:browser": {
          type: "noul",
          probabilityYes: 0.62,
        },
      });
    },
  });

  const resolver = new CapabilityResolver({
    provider,
    registry,
    config: {
      topK: 2,
      needThreshold: 0.3,
      fitThreshold: 0.4,
    },
  });

  const result = await resolver.resolve({
    traceId: "route-002",
    request: "Inspect the madowaku/mado-system-one repository.",
  });

  assert.equal(result.suggestedCapability, "github");
  assert.deepEqual(result.alternatives, ["browser"]);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.deepTraceId, "route-002:deep");
  assert.equal(seenStates.length, 2);
});

test("rejects all relative winners when every candidate fails the fit gate", async () => {
  const provider = new MockSystemOneProvider({
    id: "fixture",
    responder: (request) => {
      if ("needsCapability" in request.questions) {
        return makeResponse(request, {
          needsCapability: {
            type: "noul",
            probabilityYes: 0.91,
          },
          wideRank: {
            type: "choice",
            selected: "browser",
            distribution: {
              github: 0.45,
              browser: 0.5,
              "computer-use": 0.05,
            },
          },
        });
      }

      return makeResponse(request, {
        finalChoice: {
          type: "choice",
          selected: "browser",
          distribution: {
            github: 0.4,
            browser: 0.6,
          },
        },
        "fit:github": {
          type: "noul",
          probabilityYes: 0.18,
        },
        "fit:browser": {
          type: "noul",
          probabilityYes: 0.24,
        },
      });
    },
  });

  const resolver = new CapabilityResolver({
    provider,
    registry,
    config: {
      topK: 2,
      needThreshold: 0.3,
      fitThreshold: 0.4,
    },
  });

  const result = await resolver.resolve({
    traceId: "route-003",
    request: "Post this update to a service that is not represented in the registry.",
  });

  assert.equal(result.suggestedCapability, null);
  assert.deepEqual(result.reasonCodes, ["no_candidate_passed_fit_gate"]);
});

test("fit gate can override the relative final winner", async () => {
  const provider = new MockSystemOneProvider({
    id: "fixture",
    responder: (request) => {
      if ("needsCapability" in request.questions) {
        return makeResponse(request, {
          needsCapability: {
            type: "noul",
            probabilityYes: 0.98,
          },
          wideRank: {
            type: "choice",
            selected: "browser",
            distribution: {
              github: 0.46,
              browser: 0.49,
              "computer-use": 0.05,
            },
          },
        });
      }

      return makeResponse(request, {
        finalChoice: {
          type: "choice",
          selected: "browser",
          distribution: {
            github: 0.42,
            browser: 0.58,
          },
        },
        "fit:github": {
          type: "noul",
          probabilityYes: 0.93,
        },
        "fit:browser": {
          type: "noul",
          probabilityYes: 0.21,
        },
      });
    },
  });

  const resolver = new CapabilityResolver({
    provider,
    registry,
    config: {
      topK: 2,
      needThreshold: 0.3,
      fitThreshold: 0.4,
    },
  });

  const result = await resolver.resolve({
    traceId: "route-004",
    request: "Read a connected private repository.",
  });

  assert.equal(result.suggestedCapability, "github");
});
