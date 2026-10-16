import assert from "node:assert/strict";
import test from "node:test";
import {
  FREE_DEEPSEEK_MODEL_ID,
  FREE_GLM_MODEL_ID,
} from "../src/coding/free-agent-qualification.js";
import {
  parseMultiFreeBakeoffInput,
  runMultiFreeBakeoff,
  type MultiFreeBakeoffInput,
  type PairedCodingRun,
} from "../src/coding/multi-free-bakeoff.js";

const incumbentId = "codex-reference";
const snapshots = [
  { id: "ts-error", taskFamily: "typescript" },
  { id: "godot-state", taskFamily: "godot" },
];
const build = (): MultiFreeBakeoffInput => {
  const cases = snapshots.map((item) => ({
    ...item,
    exposure: "approved_public" as const,
    artifactRef: "fixture:" + item.id,
    snapshotRef: "sha256:" + item.id,
    instructionRef: "prompt-digest:" + item.id,
    testPlanRef: "test-digest:" + item.id,
    budgetRef: "budget:standard",
  }));
  const providers = [incumbentId, FREE_DEEPSEEK_MODEL_ID, FREE_GLM_MODEL_ID];
  const runs: PairedCodingRun[] = cases.flatMap((item) =>
    providers.map((providerId) => ({
      caseId: item.id,
      providerId,
      provenance: "live" as const,
      testStatus: "pass" as const,
      reviewStatus: "pass" as const,
      testEvidenceRef: "test:" + providerId + ":" + item.id,
      reviewEvidenceRef: "review:" + providerId + ":" + item.id,
      artifactRef: "artifact:" + providerId + ":" + item.id,
      billingEvidenceRef: "invoice:" + providerId + ":" + item.id,
      billedUsd: 0,
      elapsedMs: providerId === FREE_GLM_MODEL_ID ? 2500 : 1000,
      snapshotRef: item.snapshotRef,
      instructionRef: item.instructionRef,
      testPlanRef: item.testPlanRef,
      budgetRef: item.budgetRef,
    })),
  );
  return {
    schemaVersion: "mso.multi-free-bakeoff-input.v0",
    datasetId: "paired-public-001",
    evaluatedAt: "2026-10-16T12:00:00.000Z",
    incumbentId,
    candidates: [
      FREE_GLM_MODEL_ID, FREE_DEEPSEEK_MODEL_ID,
    ].map((providerId) => ({
      providerId,
      catalogProof: {
        modelId: providerId.slice("opencode/".length),
        sourceRef: "operator:opencode-price-list-20261016",
        checkedAt: "2026-10-16T11:00:00.000Z",
        available: true,
        pricing: "free" as const,
      },
    })),
    operatorReview: {
      isolationApproved: true,
      dataHandlingApproved: true,
      approvalRef: "operator:public-disposable-workspaces",
    },
    policy: {
      minLivePairs: 2,
      minLiveTaskFamilies: 2,
      minVerifiedPassRate: 1,
      maxRegressionRate: 0,
      maxP95ElapsedMs: 30000,
      maxTotalBilledUsd: 0,
      maxCatalogAgeHours: 24,
    },
    cases,
    runs,
  };
};
const findRun = (input: MultiFreeBakeoffInput, id: string, caseId = "ts-error") => {
  const run = input.runs.find((r) => r.providerId === id && r.caseId === caseId);
  assert.ok(run);
  return run;
};

test("all three comparable live runs yield separate shadow-only qualification for both free models", () => {
  const result = runMultiFreeBakeoff(build());
  assert.equal(result.decision, "eligible_for_reviewed_shadow");
  assert.equal(result.completeCohortCases, 2);
  assert.equal(result.eligibleLiveCohortCases, 2);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((item) => item.decision === "eligible_for_shadow"));
  assert.equal(result.pairwise.length, 1);
  assert.equal(result.pairwise[0]?.bothPass, 2);
  assert.deepEqual(result.taskFamilySlices.map((slice) => slice.taskFamily), ["godot", "typescript"]);
  assert.equal(result.taskFamilySlices[0]?.providers.length, 3);
  assert.ok(result.taskFamilySlices.every((slice) => slice.providers.every((provider) => provider.verifiedPassRate === 1)));
  assert.equal(result.pairwise[0]?.firstWins, 0);
  assert.equal(result.pairwise[0]?.secondWins, 0);
  assert.equal(result.automaticProviderRanking, false);
  assert.equal(result.automaticRoutingDecision, false);
  assert.equal(result.productionAuthorityChange, false);
});

test("candidate failure creates side-by-side win/loss but never authority", () => {
  const input = build();
  findRun(input, FREE_GLM_MODEL_ID).reviewStatus = "fail";
  const result = runMultiFreeBakeoff(input);
  assert.equal(result.decision, "blocked");
  const pair = result.pairwise[0]!;
  assert.equal(pair.firstProviderId, FREE_DEEPSEEK_MODEL_ID);
  assert.equal(pair.secondProviderId, FREE_GLM_MODEL_ID);
  assert.equal(pair.firstWins, 1);
  assert.equal(pair.secondWins, 0);
  assert.equal(pair.bothPass, 1);
  assert.equal(result.candidates.find((c) => c.candidateId === FREE_GLM_MODEL_ID)?.summary.regressions, 1);
});

test("GLM and DeepSeek must both run: missing GLM is not a DeepSeek win", () => {
  const input = build();
  input.runs = input.runs.filter((r) => !(r.providerId === FREE_GLM_MODEL_ID && r.caseId === "ts-error"));
  const result = runMultiFreeBakeoff(input);
  assert.equal(result.decision, "insufficient_evidence");
  assert.equal(result.eligibleLiveCohortCases, 1);
  assert.deepEqual(result.missingRuns, [{ caseId: "ts-error", providerId: FREE_GLM_MODEL_ID }]);
  assert.ok(result.candidates.every((c) => c.eligibleLivePairs === 1));
});

test("a synthetic GLM or unapproved public task cannot inflate paired live evidence", () => {
  const synthetic = build();
  findRun(synthetic, FREE_GLM_MODEL_ID).provenance = "synthetic";
  assert.equal(runMultiFreeBakeoff(synthetic).eligibleLiveCohortCases, 1);
  assert.equal(runMultiFreeBakeoff(synthetic).decision, "insufficient_evidence");
  const unapproved = build();
  unapproved.cases[0]!.exposure = "public_synthetic";
  assert.equal(runMultiFreeBakeoff(unapproved).decision, "insufficient_evidence");
});

test("price, stale catalog, absent invoice and paid alias cannot earn shadow eligibility", () => {
  const unavailable = build();
  unavailable.candidates[0]!.catalogProof.pricing = "unverified";
  assert.equal(runMultiFreeBakeoff(unavailable).decision, "blocked");
  const stale = build();
  stale.candidates[0]!.catalogProof.checkedAt = "2026-10-01T00:00:00.000Z";
  assert.equal(runMultiFreeBakeoff(stale).decision, "blocked");
  const invoice = build();
  delete findRun(invoice, FREE_DEEPSEEK_MODEL_ID).billingEvidenceRef;
  assert.equal(runMultiFreeBakeoff(invoice).decision, "blocked");
  const paid = build();
  paid.candidates[0]!.providerId = "opencode/glm-5.3-flash";
  assert.throws(() => parseMultiFreeBakeoffInput(paid), /unregistered free model/);
});

test("a mismatched source snapshot, prompt, tests or budget rejects unfair comparisons", () => {
  for (const field of ["snapshotRef", "instructionRef", "testPlanRef", "budgetRef"] as const) {
    const input = build();
    findRun(input, FREE_GLM_MODEL_ID)[field] = "DIFFERENT:" + field;
    assert.throws(() => runMultiFreeBakeoff(input), new RegExp(field + " mismatch"));
  }
});

test("duplicate or extra runs and raw proprietary prompt fields are rejected", () => {
  const duplicate = build();
  duplicate.runs.push({ ...duplicate.runs[0]! });
  assert.throws(() => parseMultiFreeBakeoffInput(duplicate), /duplicate run/);
  const extra = build() as unknown as Record<string, unknown>;
  extra.prompt = "secret code";
  assert.throws(() => parseMultiFreeBakeoffInput(extra), /unexpected field prompt/);
  const nested = build();
  (nested.cases[0] as unknown as Record<string, unknown>).rawPrompt = "secret";
  assert.throws(() => parseMultiFreeBakeoffInput(nested), /unexpected field rawPrompt/);
});

test("unknown model, duplicate candidate, missing mandatory review evidence cannot pass", () => {
  const duplicated = build();
  duplicated.candidates[1]!.providerId = FREE_GLM_MODEL_ID;
  assert.throws(() => parseMultiFreeBakeoffInput(duplicated), /duplicate candidate/);
  const noReview = build();
  delete findRun(noReview, FREE_DEEPSEEK_MODEL_ID).reviewEvidenceRef;
  assert.throws(() => parseMultiFreeBakeoffInput(noReview), /reviewEvidenceRef/);
  const unsafe = build();
  unsafe.operatorReview.dataHandlingApproved = false;
  assert.equal(runMultiFreeBakeoff(unsafe).decision, "blocked");
});

test("JSON round-trip and candidate input order are deterministic", () => {
  const a = build();
  const x = runMultiFreeBakeoff(a);
  const b = build();
  b.candidates.reverse();
  b.runs.reverse();
  const y = runMultiFreeBakeoff(JSON.parse(JSON.stringify(b)) as MultiFreeBakeoffInput);
  assert.deepEqual(x, y);
  assert.equal(JSON.stringify(x).includes("secret code"), false);
  assert.ok(x.sourceRefs.includes("operator:public-disposable-workspaces"));
});

test("live agent activity on an unapproved fixture always blocks the bakeoff", () => {
  const input = build();
  input.cases[0]!.exposure = "public_synthetic";
  const result = runMultiFreeBakeoff(input);
  assert.equal(result.decision, "blocked");
  assert.equal(result.unapprovedLiveRuns.length, 3);
  assert.equal(result.automaticRoutingDecision, false);
});

test("task-family results expose a GLM-only defect without confusing Godot and TypeScript", () => {
  const input = build();
  findRun(input, FREE_GLM_MODEL_ID, "godot-state").testStatus = "fail";
  const result = runMultiFreeBakeoff(input);
  assert.equal(result.decision, "blocked");
  const godot = result.taskFamilySlices.find((slice) => slice.taskFamily === "godot");
  const ts = result.taskFamilySlices.find((slice) => slice.taskFamily === "typescript");
  assert.equal(godot?.providers.find((p) => p.providerId === FREE_GLM_MODEL_ID)?.verifiedPassRate, 0);
  assert.equal(ts?.providers.find((p) => p.providerId === FREE_GLM_MODEL_ID)?.verifiedPassRate, 1);
});
