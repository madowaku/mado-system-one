import assert from "node:assert/strict";
import test from "node:test";
import {
  FREE_DEEPSEEK_MODEL_ID,
  parseCodingQualificationInput,
  qualifyFreeCodingAgent,
  type CodingQualificationInput,
  type CodingRun,
} from "../src/coding/free-agent-qualification.js";

const makeRun = (caseId: string, providerId: string): CodingRun => ({
  caseId,
  providerId,
  provenance: "live",
  testStatus: "pass",
  reviewStatus: "pass",
  testEvidenceRef: "ci:" + providerId + ":" + caseId,
  reviewEvidenceRef: "review:" + providerId + ":" + caseId,
  artifactRef: "artifact:" + providerId + ":" + caseId,
  elapsedMs: 1500,
  billedUsd: 0,
  billingEvidenceRef: "billing:" + providerId + ":" + caseId,
});

const makeInput = (): CodingQualificationInput => {
  const candidateId = FREE_DEEPSEEK_MODEL_ID;
  const incumbentId = "codex-reference";
  return {
    schemaVersion: "mso.coding-qualification-input.v0",
    datasetId: "public-two-case-live",
    evaluatedAt: "2026-10-15T13:00:00.000Z",
    candidateId,
    incumbentId,
    catalogProof: {
      modelId: "deepseek-v4.1-flash-free",
      sourceRef: "operator:catalog-and-price-snapshot",
      checkedAt: "2026-10-15T12:00:00.000Z",
      available: true,
      pricing: "free",
    },
    operatorReview: {
      isolationApproved: true,
      dataHandlingApproved: true,
      approvalRef: "operator:approved-public-benchmark-001",
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
    cases: [
      { id: "godot-logic", taskFamily: "godot", exposure: "approved_public", artifactRef: "fixture:godot" },
      { id: "ts-refactor", taskFamily: "typescript", exposure: "approved_public", artifactRef: "fixture:ts" },
    ],
    runs: [
      makeRun("godot-logic", candidateId),
      makeRun("godot-logic", incumbentId),
      makeRun("ts-refactor", candidateId),
      makeRun("ts-refactor", incumbentId),
    ],
  };
};

test("qualifies only complete live paired, verified and operator approved runs", () => {
  const result = qualifyFreeCodingAgent(makeInput());
  assert.equal(result.decision, "eligible_for_shadow");
  assert.equal(result.eligibleLivePairs, 2);
  assert.equal(result.summary.candidatePassRate, 1);
  assert.equal(result.summary.candidateBilledUsd, 0);
  assert.equal(result.syntheticExcludedFromPromotion, true);
  assert.equal(result.automaticProviderPromotion, false);
  assert.equal(result.automaticRoutingDecision, false);
  assert.equal(result.productionAuthorityChange, false);
  assert.equal(result.checks.every((check) => check.status === "pass"), true);
});

test("synthetic records do not qualify a candidate, even when their tests pass", () => {
  const input = makeInput();
  input.runs.forEach((run) => { run.provenance = "synthetic"; });
  assert.equal(qualifyFreeCodingAgent(input).decision, "insufficient_evidence");
  assert.equal(qualifyFreeCodingAgent(input).eligibleLivePairs, 0);
});

test("unverified bill or price blocks zero-cost qualification", () => {
  const input = makeInput();
  const candidate = input.runs[0];
  assert.ok(candidate);
  delete candidate.billingEvidenceRef;
  assert.equal(qualifyFreeCodingAgent(input).decision, "blocked");
  const paid = makeInput();
  paid.catalogProof.pricing = "paid";
  assert.equal(qualifyFreeCodingAgent(paid).decision, "blocked");
});

test("candidate regression, missing review, and a paid run block", () => {
  const input = makeInput();
  const candidate = input.runs[0];
  assert.ok(candidate);
  candidate.reviewStatus = "not_run";
  assert.equal(qualifyFreeCodingAgent(input).summary.regressions, 1);
  assert.equal(qualifyFreeCodingAgent(input).decision, "blocked");
  const paid = makeInput();
  const candidate2 = paid.runs[2];
  assert.ok(candidate2);
  candidate2.billedUsd = 0.01;
  assert.equal(qualifyFreeCodingAgent(paid).decision, "blocked");
});

test("incomplete pairs cannot pass by cherry-picking only successes", () => {
  const input = makeInput();
  input.runs.pop();
  const evidence = qualifyFreeCodingAgent(input);
  assert.deepEqual(evidence.missingPairs, ["ts-refactor"]);
  assert.equal(evidence.decision, "insufficient_evidence");
});

test("schema validation rejects duplicate runs, raw prompts, fabricated verification", () => {
  const duplicated = makeInput();
  duplicated.runs.push({ ...duplicated.runs[0]! });
  assert.throws(() => parseCodingQualificationInput(duplicated), /duplicate provider/);
  const raw = makeInput() as unknown as Record<string, unknown>;
  raw.prompt = "secret";
  assert.throws(() => parseCodingQualificationInput(raw), /unexpected field prompt/);
  const missingProof = makeInput();
  delete missingProof.runs[0]!.testEvidenceRef;
  assert.throws(() => parseCodingQualificationInput(missingProof), /testEvidenceRef/);
});

test("rejects unrelated candidate IDs and requires privacy/operator review", () => {
  const wrong = makeInput();
  wrong.candidateId = "opencode/deepseek-v4.1-flash";
  wrong.catalogProof.modelId = "deepseek-v4.1-flash";
  wrong.runs.forEach((run) => {
    if (run.providerId === FREE_DEEPSEEK_MODEL_ID) run.providerId = wrong.candidateId;
  });
  assert.equal(qualifyFreeCodingAgent(wrong).decision, "blocked");
  const unapproved = makeInput();
  unapproved.operatorReview.dataHandlingApproved = false;
  assert.equal(qualifyFreeCodingAgent(unapproved).decision, "blocked");
});

test("sourceRefs never include raw prompt or code and stable evidence is reproducible", () => {
  const input = makeInput();
  const a = qualifyFreeCodingAgent(input);
  const b = qualifyFreeCodingAgent(input);
  assert.deepEqual(a, b);
  assert.ok(a.sourceRefs.includes("operator:approved-public-benchmark-001"));
  assert.equal(JSON.stringify(a).includes("secret"), false);
});

test("stale or future price proof cannot qualify even when runs are free", () => {
  const stale = makeInput();
  stale.catalogProof.checkedAt = "2026-10-01T12:00:00.000Z";
  assert.equal(qualifyFreeCodingAgent(stale).decision, "blocked");
  const future = makeInput();
  future.catalogProof.checkedAt = "2026-10-16T12:00:00.000Z";
  assert.equal(qualifyFreeCodingAgent(future).decision, "blocked");
});
