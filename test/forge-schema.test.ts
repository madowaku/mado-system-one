import assert from "node:assert/strict";
import test from "node:test";

import {
  ForgeContractError,
  assertForgeTransition,
  assertNoOwnershipConflicts,
  detectOwnershipConflicts,
  parseForgeM0Fixture,
  validateForgeM0Fixture,
  type ForgeM0Fixture,
  type OwnershipLease,
} from "../src/index.js";

const fixture: ForgeM0Fixture = {
  run: {
    runId: "forge-m0-001",
    phase: "contract_freeze",
    artifactVersion: "artifact-001",
    startedAt: "2026-09-25T00:00:00Z",
    updatedAt: "2026-09-25T00:05:00Z",
    evidenceRoot: "evidence/forge-m0-001",
  },
  candidates: [
    {
      id: "candidate-a",
      thesis: "Contract-first implementation.",
      assumptions: ["The artifact can be decomposed into owned surfaces."],
      evidenceRefs: ["evidence/forge-m0-001/decisions/candidate-a.json"],
      risks: ["Bad contracts can freeze the wrong boundary."],
    },
  ],
  juryResults: [
    {
      jurorId: "juror-engineering",
      lens: "engineering_feasibility",
      candidateIds: ["candidate-a"],
      observations: ["The approach can be tested without a live agent runtime."],
      rejectedAssumptions: [],
      reusableStrengths: ["Explicit ownership."],
      uncertainty: ["Live runtime behavior is not covered by M0.0."],
      synthesisGuidance: ["Keep contracts runtime-agnostic."],
      evidenceRefs: ["evidence/forge-m0-001/decisions/jury.json"],
    },
  ],
  ownershipLeases: [
    {
      surfaceId: "forge-contracts",
      ownerAgentId: "builder-contracts",
      allowedWrites: ["src/forge/contracts.ts"],
      forbiddenWrites: ["src/core"],
      dependencies: [],
      expiresAtPhase: "review",
    },
    {
      surfaceId: "forge-ownership",
      ownerAgentId: "builder-ownership",
      allowedWrites: ["src/forge/ownership.ts"],
      forbiddenWrites: ["src/core"],
      dependencies: ["forge-contracts"],
      expiresAtPhase: "review",
    },
  ],
  buildReports: [
    {
      agentId: "builder-contracts",
      ownedSurfaces: ["forge-contracts"],
      changedSurfaces: ["src/forge/contracts.ts"],
      acceptanceResults: [
        {
          criterionId: "fixture-round-trip",
          passed: true,
          evidenceRefs: ["test/forge-schema.test.ts"],
        },
      ],
      evidenceRefs: ["test/forge-schema.test.ts"],
      crossOwnerRequests: [],
      unresolved: [],
    },
  ],
  findings: [
    {
      findingId: "finding-001",
      claim: "Overlapping write scopes must be rejected.",
      severity: "high",
      reproduction: ["Assign src/forge and src/forge/contracts.ts to different owners."],
      evidenceRefs: ["test/forge-schema.test.ts"],
      status: "confirmed",
    },
  ],
  falsificationResults: [
    {
      findingId: "finding-001",
      verifierAgentId: "verifier-001",
      outcome: "real",
      reproductionAttempted: true,
      refutationAttempted: true,
      evidenceRefs: ["test/forge-schema.test.ts"],
      notes: ["Ancestor and descendant write scopes overlap."],
    },
  ],
  humanSignals: [
    {
      signalId: "human-001",
      observation: "Keep the first milestone deterministic and inspectable.",
      artifactVersion: "artifact-001",
      affectedDecisionIds: ["decision-contract-scope"],
      severity: "note",
      evidenceRefs: ["docs/MADO_MULTI_AGENT_FORGE_SPEC.md"],
    },
  ],
  releaseGate: {
    artifactVersion: "artifact-001",
    status: "blocked",
    contractValid: true,
    functionalCorrectness: false,
    experientialQuality: false,
    operationalSafety: true,
    unresolvedFindingIds: ["finding-001"],
    humanBlockerSignalIds: [],
    policyConfirmationRefs: [],
    evidenceRefs: ["test/forge-schema.test.ts"],
    rollbackRef: "git:main-before-maf-m0.0",
  },
};

test("MAF-M0.0 fixture survives JSON round-trip with runtime validation", () => {
  const json = JSON.stringify(fixture);
  const restored = parseForgeM0Fixture(json);

  assert.deepEqual(restored, fixture);
  assert.doesNotThrow(() => validateForgeM0Fixture(restored));
});

test("MAF-M0.0 fixture rejects malformed runtime data", () => {
  const invalid = {
    ...fixture,
    run: {
      ...fixture.run,
      phase: "teleport",
    },
  };

  assert.throws(
    () => validateForgeM0Fixture(invalid),
    /run\.phase has unsupported value: teleport/,
  );

  assert.throws(
    () => parseForgeM0Fixture("{not-json"),
    ForgeContractError,
  );
});

test("Forge phase guard allows declared transitions and rejects invalid jumps", () => {
  assert.doesNotThrow(() => assertForgeTransition("contract_freeze", "build"));
  assert.doesNotThrow(() => assertForgeTransition("review", "build"));

  assert.throws(
    () => assertForgeTransition("intake", "done"),
    /invalid Forge phase transition: intake -> done/,
  );
  assert.throws(
    () => assertForgeTransition("done", "build"),
    ForgeContractError,
  );
});

test("ownership detector finds exact and ancestor-descendant collisions", () => {
  const leases: readonly OwnershipLease[] = [
    {
      surfaceId: "forge-root",
      ownerAgentId: "agent-a",
      allowedWrites: ["./src/forge/**"],
      forbiddenWrites: [],
      dependencies: [],
      expiresAtPhase: "review",
    },
    {
      surfaceId: "forge-contract",
      ownerAgentId: "agent-b",
      allowedWrites: ["src/forge/contracts.ts"],
      forbiddenWrites: [],
      dependencies: [],
      expiresAtPhase: "review",
    },
    {
      surfaceId: "context",
      ownerAgentId: "agent-c",
      allowedWrites: ["src/context"],
      forbiddenWrites: [],
      dependencies: [],
      expiresAtPhase: "review",
    },
  ];

  const conflicts = detectOwnershipConflicts(leases);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.leftOwnerAgentId, "agent-a");
  assert.equal(conflicts[0]?.rightOwnerAgentId, "agent-b");
  assert.throws(
    () => assertNoOwnershipConflicts(leases),
    /ownership overlap detected/,
  );
});

test("ownership detector allows disjoint scopes and repeated scopes for one owner", () => {
  const leases: readonly OwnershipLease[] = [
    {
      surfaceId: "contracts",
      ownerAgentId: "agent-a",
      allowedWrites: ["src/forge/contracts.ts"],
      forbiddenWrites: [],
      dependencies: [],
      expiresAtPhase: "review",
    },
    {
      surfaceId: "tests",
      ownerAgentId: "agent-b",
      allowedWrites: ["test/forge-schema.test.ts"],
      forbiddenWrites: [],
      dependencies: [],
      expiresAtPhase: "review",
    },
    {
      surfaceId: "contracts-doc",
      ownerAgentId: "agent-a",
      allowedWrites: ["src/forge/contracts.ts"],
      forbiddenWrites: [],
      dependencies: [],
      expiresAtPhase: "review",
    },
  ];

  assert.deepEqual(detectOwnershipConflicts(leases), []);
  assert.doesNotThrow(() => assertNoOwnershipConflicts(leases));
});
