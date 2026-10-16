/**
 * MSO-DM-M0.6.1: one incumbent, multiple free coding-agent candidates.
 * No model invocation. Each candidate is evaluated through the existing
 * M0.6 gate on the same fully matched, approved live cohort.
 */
import {
  FREE_CODING_MODEL_REGISTRY,
  parseCodingQualificationInput,
  qualifyFreeCodingAgent,
  type CatalogProof,
  type CodingCase,
  type CodingRun,
  type CodingQualificationEvidence,
  type FreeAgentPolicy,
  type CodingQualificationInput,
} from "./free-agent-qualification.js";

export interface PairedCodingCase extends CodingCase {
  snapshotRef: string;
  instructionRef: string;
  testPlanRef: string;
  budgetRef: string;
}
export interface PairedCodingRun extends CodingRun {
  snapshotRef: string;
  instructionRef: string;
  testPlanRef: string;
  budgetRef: string;
}
export interface MultiFreeCandidate {
  providerId: string;
  catalogProof: CatalogProof;
}
export interface MultiFreeBakeoffInput {
  schemaVersion: "mso.multi-free-bakeoff-input.v0";
  datasetId: string;
  evaluatedAt: string;
  incumbentId: string;
  candidates: MultiFreeCandidate[];
  operatorReview: CodingQualificationInput["operatorReview"];
  policy: FreeAgentPolicy;
  cases: PairedCodingCase[];
  runs: PairedCodingRun[];
}
export interface MultiFreePairResult {
  firstProviderId: string;
  secondProviderId: string;
  comparableLiveCases: number;
  firstWins: number;
  secondWins: number;
  bothPass: number;
  bothFail: number;
  firstP95ElapsedMs: number | null;
  secondP95ElapsedMs: number | null;
}
export interface MultiFreeBakeoffEvidence {
  schemaVersion: "mso.multi-free-bakeoff.v0";
  datasetId: string;
  evaluatedAt: string;
  incumbentId: string;
  candidateIds: string[];
  decision: "eligible_for_reviewed_shadow" | "blocked" | "insufficient_evidence";
  totalCases: number;
  completeCohortCases: number;
  eligibleLiveCohortCases: number;
  missingRuns: { caseId: string; providerId: string }[];
  candidates: CodingQualificationEvidence[];
  pairwise: MultiFreePairResult[];
  sourceRefs: string[];
  cohortMatchedOnly: true;
  syntheticExcludedFromPromotion: true;
  evidenceOnly: true;
  automaticProviderRanking: false;
  automaticRoutingDecision: false;
  automaticProviderPromotion: false;
  productionAuthorityChange: false;
}

const object = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(path + " must be an object");
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: readonly string[], path: string): void => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) {
    throw new Error(path + " has unexpected field " + key);
  }
};
const string = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(path + " must be nonblank");
  return value;
};
const records = (value: unknown, path: string): Record<string, unknown>[] => {
  if (!Array.isArray(value)) throw new Error(path + " must be an array");
  return value.map((item: unknown, i: number) => object(item, path + "[" + i + "]"));
};
const baseCase = (item: PairedCodingCase): CodingCase => ({
  id: item.id, taskFamily: item.taskFamily, exposure: item.exposure, artifactRef: item.artifactRef,
});
const baseRun = (item: PairedCodingRun): CodingRun => ({
  caseId: item.caseId,
  providerId: item.providerId,
  provenance: item.provenance,
  testStatus: item.testStatus,
  reviewStatus: item.reviewStatus,
  artifactRef: item.artifactRef,
  elapsedMs: item.elapsedMs,
  billedUsd: item.billedUsd,
  ...(item.testEvidenceRef === undefined ? {} : { testEvidenceRef: item.testEvidenceRef }),
  ...(item.reviewEvidenceRef === undefined ? {} : { reviewEvidenceRef: item.reviewEvidenceRef }),
  ...(item.billingEvidenceRef === undefined ? {} : { billingEvidenceRef: item.billingEvidenceRef }),
});
const runKey = (providerId: string, caseId: string): string => providerId + "\u0000" + caseId;
const verified = (run: PairedCodingRun): boolean =>
  run.testStatus === "pass" && run.reviewStatus === "pass" &&
  !!run.testEvidenceRef && !!run.reviewEvidenceRef;
const p95 = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
};

export const parseMultiFreeBakeoffInput = (raw: unknown): MultiFreeBakeoffInput => {
  const input = object(raw, "input");
  keys(input, ["schemaVersion", "datasetId", "evaluatedAt", "incumbentId", "candidates", "operatorReview", "policy", "cases", "runs"], "input");
  if (input.schemaVersion !== "mso.multi-free-bakeoff-input.v0") throw new Error("unsupported multi-free schema");
  const datasetId = string(input.datasetId, "datasetId");
  const evaluatedAt = string(input.evaluatedAt, "evaluatedAt");
  const incumbentId = string(input.incumbentId, "incumbentId");
  const candidates = records(input.candidates, "candidates").map((item, index) => {
    keys(item, ["providerId", "catalogProof"], "candidate");
    const providerId = string(item.providerId, "candidate.providerId");
    if (!Object.hasOwn(FREE_CODING_MODEL_REGISTRY, providerId)) throw new Error("unregistered free model: " + providerId);
    return { providerId, catalogProof: item.catalogProof as CatalogProof, index };
  });
  if (candidates.length < 2) throw new Error("multi-free bakeoff needs at least two candidate providers");
  if (new Set(candidates.map((candidate) => candidate.providerId)).size !== candidates.length) {
    throw new Error("duplicate candidate provider");
  }
  if (candidates.some((candidate) => candidate.providerId === incumbentId)) throw new Error("incumbent cannot be a candidate");
  const cases = records(input.cases, "cases").map((item) => {
    keys(item, ["id", "taskFamily", "exposure", "artifactRef", "snapshotRef", "instructionRef", "testPlanRef", "budgetRef"], "case");
    const extras = {
      snapshotRef: string(item.snapshotRef, "case.snapshotRef"),
      instructionRef: string(item.instructionRef, "case.instructionRef"),
      testPlanRef: string(item.testPlanRef, "case.testPlanRef"),
      budgetRef: string(item.budgetRef, "case.budgetRef"),
    };
    return { ...item, ...extras } as unknown as PairedCodingCase;
  });
  const runs = records(input.runs, "runs").map((item) => {
    keys(item, ["caseId", "providerId", "provenance", "testStatus", "reviewStatus", "testEvidenceRef", "reviewEvidenceRef", "artifactRef", "elapsedMs", "billedUsd", "billingEvidenceRef", "snapshotRef", "instructionRef", "testPlanRef", "budgetRef"], "run");
    return {
      ...item,
      snapshotRef: string(item.snapshotRef, "run.snapshotRef"),
      instructionRef: string(item.instructionRef, "run.instructionRef"),
      testPlanRef: string(item.testPlanRef, "run.testPlanRef"),
      budgetRef: string(item.budgetRef, "run.budgetRef"),
    } as unknown as PairedCodingRun;
  });
  const candidateIds = candidates.map((candidate) => candidate.providerId);
  const providers = [incumbentId, ...candidateIds];
  const seenRuns = new Set<string>();
  const caseMap = new Map(cases.map((item) => [item.id, item]));
  if (caseMap.size !== cases.length) throw new Error("duplicate case id");
  for (const run of runs) {
    const caseId = string(run.caseId, "run.caseId");
    const providerId = string(run.providerId, "run.providerId");
    if (!providers.includes(providerId)) throw new Error("unexpected provider in runs: " + providerId);
    const task = caseMap.get(caseId);
    if (!task) throw new Error("run references unknown case: " + caseId);
    const key = runKey(providerId, caseId);
    if (seenRuns.has(key)) throw new Error("duplicate run: " + key);
    seenRuns.add(key);
    for (const ref of ["snapshotRef", "instructionRef", "testPlanRef", "budgetRef"] as const) {
      if (run[ref] !== task[ref]) throw new Error("unfair comparison: " + ref + " mismatch for " + caseId + "/" + providerId);
    }
  }
  // Reuse M0.6's exhaustive validator for the nested policies, proofs and run schema.
  // Empty candidates are validated in the same way as completed candidates.
  const safeCandidates = candidates.map(({ providerId, catalogProof }) => ({ providerId, catalogProof }));
  for (const candidate of safeCandidates) {
    parseCodingQualificationInput({
      schemaVersion: "mso.coding-qualification-input.v0",
      datasetId, evaluatedAt, incumbentId,
      candidateId: candidate.providerId,
      catalogProof: candidate.catalogProof,
      operatorReview: input.operatorReview as CodingQualificationInput["operatorReview"],
      policy: input.policy as FreeAgentPolicy,
      cases: cases.map(baseCase),
      runs: runs.filter((run) => run.providerId === candidate.providerId || run.providerId === incumbentId).map(baseRun),
    });
  }
  return {
    schemaVersion: "mso.multi-free-bakeoff-input.v0",
    datasetId, evaluatedAt, incumbentId,
    candidates: safeCandidates,
    operatorReview: input.operatorReview as CodingQualificationInput["operatorReview"],
    policy: input.policy as FreeAgentPolicy,
    cases, runs,
  };
};

export const runMultiFreeBakeoff = (raw: MultiFreeBakeoffInput): MultiFreeBakeoffEvidence => {
  const input = parseMultiFreeBakeoffInput(raw);
  const candidateIds = input.candidates.map((item) => item.providerId).sort();
  const allIds = [input.incumbentId, ...candidateIds];
  const runMap = new Map(input.runs.map((run) => [runKey(run.providerId, run.caseId), run]));
  const missingRuns: {caseId: string; providerId: string}[] = [];
  const cohortCases: PairedCodingCase[] = [];
  const liveCases: PairedCodingCase[] = [];
  for (const item of [...input.cases].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    const group = allIds.map((providerId) => {
      const run = runMap.get(runKey(providerId, item.id));
      if (!run) missingRuns.push({ caseId: item.id, providerId });
      return run;
    });
    if (group.some((run) => !run)) continue;
    cohortCases.push(item);
    if (item.exposure === "approved_public" && group.every((run) => run?.provenance === "live")) liveCases.push(item);
  }
  const eligibleIds = new Set(liveCases.map((item) => item.id));
  const sampleIds = new Set(cohortCases.filter((item) => item.exposure === "public_synthetic").map((item) => item.id));
  const sampleRuns = input.runs.filter((run) => sampleIds.has(run.caseId) && run.provenance === "synthetic");
  const candidateEvidence: CodingQualificationEvidence[] = input.candidates.map((candidate) => {
    // An individual provider may not cherry-pick live tasks absent from the other candidate.
    // Full task inventory is always passed to M0.6 to flag missing paired coverage.
    const evaluatedRuns = input.runs.filter((run) =>
      (eligibleIds.has(run.caseId) || sampleRuns.includes(run)) &&
      (run.providerId === input.incumbentId || run.providerId === candidate.providerId));
    return qualifyFreeCodingAgent({
      schemaVersion: "mso.coding-qualification-input.v0",
      datasetId: input.datasetId,
      evaluatedAt: input.evaluatedAt,
      incumbentId: input.incumbentId,
      candidateId: candidate.providerId,
      catalogProof: candidate.catalogProof,
      operatorReview: input.operatorReview,
      policy: input.policy,
      cases: input.cases.map(baseCase),
      runs: evaluatedRuns.map(baseRun),
    });
  }).sort((a, b) => a.candidateId.localeCompare(b.candidateId, "en"));

  const pairwise: MultiFreePairResult[] = [];
  for (let i = 0; i < candidateIds.length; i++) for (let j = i + 1; j < candidateIds.length; j++) {
    const firstProviderId = candidateIds[i]!;
    const secondProviderId = candidateIds[j]!;
    let firstWins = 0, secondWins = 0, bothPass = 0, bothFail = 0;
    const firstLatencies: number[] = [], secondLatencies: number[] = [];
    for (const task of liveCases) {
      const first = runMap.get(runKey(firstProviderId, task.id))!;
      const second = runMap.get(runKey(secondProviderId, task.id))!;
      firstLatencies.push(first.elapsedMs);
      secondLatencies.push(second.elapsedMs);
      const firstPass = verified(first), secondPass = verified(second);
      if (firstPass && secondPass) bothPass++;
      else if (!firstPass && !secondPass) bothFail++;
      else if (firstPass) firstWins++;
      else secondWins++;
    }
    pairwise.push({
      firstProviderId, secondProviderId,
      comparableLiveCases: liveCases.length,
      firstWins, secondWins, bothPass, bothFail,
      firstP95ElapsedMs: p95(firstLatencies),
      secondP95ElapsedMs: p95(secondLatencies),
    });
  }
  const hasBlocked = candidateEvidence.some((entry) => entry.decision === "blocked");
  const hasInsufficient = candidateEvidence.some((entry) => entry.decision === "insufficient_evidence");
  const decision = hasInsufficient || missingRuns.length > 0 || liveCases.length < input.policy.minLivePairs
    ? "insufficient_evidence"
    : hasBlocked ? "blocked" : "eligible_for_reviewed_shadow";
  const sourceRefs = new Set([
    input.operatorReview.approvalRef,
    ...input.candidates.map((item) => item.catalogProof.sourceRef),
    ...input.cases.flatMap((item) => [
      item.artifactRef, item.snapshotRef, item.instructionRef, item.testPlanRef, item.budgetRef,
    ]),
    ...input.runs.flatMap((run) => [
      run.artifactRef,
      ...(run.testEvidenceRef ? [run.testEvidenceRef] : []),
      ...(run.reviewEvidenceRef ? [run.reviewEvidenceRef] : []),
      ...(run.billingEvidenceRef ? [run.billingEvidenceRef] : []),
    ]),
  ]);
  return {
    schemaVersion: "mso.multi-free-bakeoff.v0",
    datasetId: input.datasetId,
    evaluatedAt: input.evaluatedAt,
    incumbentId: input.incumbentId,
    candidateIds,
    decision,
    totalCases: input.cases.length,
    completeCohortCases: cohortCases.length,
    eligibleLiveCohortCases: liveCases.length,
    missingRuns,
    candidates: candidateEvidence,
    pairwise,
    sourceRefs: [...sourceRefs].sort(),
    cohortMatchedOnly: true,
    syntheticExcludedFromPromotion: true,
    evidenceOnly: true,
    automaticProviderRanking: false,
    automaticRoutingDecision: false,
    automaticProviderPromotion: false,
    productionAuthorityChange: false,
  };
};
