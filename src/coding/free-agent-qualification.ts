/**
 * MSO-DM-M0.6: coding-agent qualification is deliberately separate from the
 * SystemOneProvider typed-decision interface. Offline and evidence-only.
 */
export const FREE_DEEPSEEK_MODEL_ID = "opencode/deepseek-v4.1-flash-free";

type VerificationStatus = "pass" | "fail" | "not_run";
type Provenance = "synthetic" | "live";

export interface CodingCase {
  id: string;
  taskFamily: string;
  exposure: "public_synthetic" | "approved_public";
  artifactRef: string;
}

export interface CodingRun {
  caseId: string;
  providerId: string;
  provenance: Provenance;
  testStatus: VerificationStatus;
  reviewStatus: VerificationStatus;
  testEvidenceRef?: string;
  reviewEvidenceRef?: string;
  artifactRef: string;
  elapsedMs: number;
  billedUsd: number | null;
  billingEvidenceRef?: string;
}

export interface FreeAgentPolicy {
  minLivePairs: number;
  minLiveTaskFamilies: number;
  minVerifiedPassRate: number;
  maxRegressionRate: number;
  maxP95ElapsedMs: number;
  maxTotalBilledUsd: number;
}

export interface CatalogProof {
  modelId: string;
  sourceRef: string;
  checkedAt: string;
  available: boolean;
  pricing: "free" | "paid" | "unverified";
}

export interface CodingQualificationInput {
  schemaVersion: "mso.coding-qualification-input.v0";
  datasetId: string;
  incumbentId: string;
  candidateId: string;
  catalogProof: CatalogProof;
  operatorReview: {
    isolationApproved: boolean;
    dataHandlingApproved: boolean;
    approvalRef: string;
  };
  policy: FreeAgentPolicy;
  cases: CodingCase[];
  runs: CodingRun[];
}

export interface QualificationCheck {
  id: string;
  status: "pass" | "fail" | "insufficient";
  detail: string;
}

export interface CodingQualificationEvidence {
  schemaVersion: "mso.coding-qualification.v0";
  datasetId: string;
  candidateId: string;
  incumbentId: string;
  decision: "eligible_for_shadow" | "blocked" | "insufficient_evidence";
  observedPairs: number;
  eligibleLivePairs: number;
  missingPairs: string[];
  summary: {
    taskFamilies: number;
    candidateVerifiedPasses: number;
    incumbentVerifiedPasses: number;
    candidatePassRate: number | null;
    incumbentPassRate: number | null;
    regressions: number;
    wins: number;
    ties: number;
    regressionRate: number | null;
    candidateP95ElapsedMs: number | null;
    candidateBilledUsd: number | null;
    billingCoverage: number;
  };
  checks: QualificationCheck[];
  sourceRefs: string[];
  syntheticExcludedFromPromotion: true;
  evidenceOnly: true;
  automaticRoutingDecision: false;
  automaticProviderPromotion: false;
  productionAuthorityChange: false;
}

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(label + " must be an object");
  }
  return value as Record<string, unknown>;
};
const allowed = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(label + " has unexpected field " + key);
  }
};
const nonblank = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(label + " must be a non-empty string");
  }
  return value;
};
const numberIn = (value: unknown, label: string, min: number, max = Infinity): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(label + " must be a finite number in range");
  }
  return value;
};
const boolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") throw new Error(label + " must be boolean");
  return value;
};
const oneOf = <T extends string>(value: unknown, options: readonly T[], label: string): T => {
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw new Error(label + " must be one of " + options.join(","));
  }
  return value as T;
};
const array = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(label + " must be an array");
  return value as unknown[];
};

export const parseCodingQualificationInput = (value: unknown): CodingQualificationInput => {
  const input = asRecord(value, "input");
  allowed(input, ["schemaVersion", "datasetId", "candidateId", "incumbentId", "catalogProof", "operatorReview", "policy", "cases", "runs"], "input");
  if (input.schemaVersion !== "mso.coding-qualification-input.v0") {
    throw new Error("unsupported coding qualification input schema");
  }
  const datasetId = nonblank(input.datasetId, "datasetId");
  const candidateId = nonblank(input.candidateId, "candidateId");
  const incumbentId = nonblank(input.incumbentId, "incumbentId");
  if (candidateId === incumbentId) throw new Error("candidate and incumbent must differ");

  const proof = asRecord(input.catalogProof, "catalogProof");
  allowed(proof, ["modelId", "sourceRef", "checkedAt", "available", "pricing"], "catalogProof");
  const checkedAt = nonblank(proof.checkedAt, "catalogProof.checkedAt");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(checkedAt) || !Number.isFinite(Date.parse(checkedAt))) {
    throw new Error("catalogProof.checkedAt must be an ISO timestamp");
  }
  const catalogProof: CatalogProof = {
    modelId: nonblank(proof.modelId, "catalogProof.modelId"),
    sourceRef: nonblank(proof.sourceRef, "catalogProof.sourceRef"),
    checkedAt,
    available: boolean(proof.available, "catalogProof.available"),
    pricing: oneOf(proof.pricing, ["free", "paid", "unverified"], "catalogProof.pricing"),
  };
  const operator = asRecord(input.operatorReview, "operatorReview");
  allowed(operator, ["isolationApproved", "dataHandlingApproved", "approvalRef"], "operatorReview");
  const operatorReview = {
    isolationApproved: boolean(operator.isolationApproved, "operatorReview.isolationApproved"),
    dataHandlingApproved: boolean(operator.dataHandlingApproved, "operatorReview.dataHandlingApproved"),
    approvalRef: nonblank(operator.approvalRef, "operatorReview.approvalRef"),
  };
  const policyInput = asRecord(input.policy, "policy");
  allowed(policyInput, ["minLivePairs", "minLiveTaskFamilies", "minVerifiedPassRate", "maxRegressionRate", "maxP95ElapsedMs", "maxTotalBilledUsd"], "policy");
  const minLivePairs = numberIn(policyInput.minLivePairs, "minLivePairs", 1);
  const minLiveTaskFamilies = numberIn(policyInput.minLiveTaskFamilies, "minLiveTaskFamilies", 1);
  if (!Number.isInteger(minLivePairs) || !Number.isInteger(minLiveTaskFamilies)) {
    throw new Error("minimum evidence counts must be integers");
  }
  const policy: FreeAgentPolicy = {
    minLivePairs,
    minLiveTaskFamilies,
    minVerifiedPassRate: numberIn(policyInput.minVerifiedPassRate, "minVerifiedPassRate", 0, 1),
    maxRegressionRate: numberIn(policyInput.maxRegressionRate, "maxRegressionRate", 0, 1),
    maxP95ElapsedMs: numberIn(policyInput.maxP95ElapsedMs, "maxP95ElapsedMs", 0),
    maxTotalBilledUsd: numberIn(policyInput.maxTotalBilledUsd, "maxTotalBilledUsd", 0),
  };
  const caseIds = new Set<string>();
  const cases: CodingCase[] = array(input.cases, "cases").map((raw, index) => {
    const item = asRecord(raw, "cases[" + index + "]");
    allowed(item, ["id", "taskFamily", "exposure", "artifactRef"], "case");
    const id = nonblank(item.id, "case.id");
    if (caseIds.has(id)) throw new Error("duplicate caseId: " + id);
    caseIds.add(id);
    return {
      id,
      taskFamily: nonblank(item.taskFamily, "case.taskFamily"),
      exposure: oneOf(item.exposure, ["public_synthetic", "approved_public"], "case.exposure"),
      artifactRef: nonblank(item.artifactRef, "case.artifactRef"),
    };
  });
  if (cases.length === 0) throw new Error("cases must not be empty");
  const runKeys = new Set<string>();
  const runs: CodingRun[] = array(input.runs, "runs").map((raw, index) => {
    const item = asRecord(raw, "runs[" + index + "]");
    allowed(item, ["caseId", "providerId", "provenance", "testStatus", "reviewStatus", "testEvidenceRef", "reviewEvidenceRef", "artifactRef", "elapsedMs", "billedUsd", "billingEvidenceRef"], "run");
    const caseId = nonblank(item.caseId, "run.caseId");
    const providerId = nonblank(item.providerId, "run.providerId");
    if (!caseIds.has(caseId)) throw new Error("run references unknown case " + caseId);
    if (providerId !== candidateId && providerId !== incumbentId) throw new Error("unexpected provider " + providerId);
    const key = providerId + "\u0000" + caseId;
    if (runKeys.has(key)) throw new Error("duplicate provider/case run " + providerId + "/" + caseId);
    runKeys.add(key);
    const testStatus = oneOf(item.testStatus, ["pass", "fail", "not_run"], "run.testStatus");
    const reviewStatus = oneOf(item.reviewStatus, ["pass", "fail", "not_run"], "run.reviewStatus");
    if (testStatus === "pass") nonblank(item.testEvidenceRef, "run.testEvidenceRef");
    if (reviewStatus === "pass") nonblank(item.reviewEvidenceRef, "run.reviewEvidenceRef");
    if (item.testEvidenceRef !== undefined) nonblank(item.testEvidenceRef, "run.testEvidenceRef");
    if (item.reviewEvidenceRef !== undefined) nonblank(item.reviewEvidenceRef, "run.reviewEvidenceRef");
    if (item.billingEvidenceRef !== undefined) nonblank(item.billingEvidenceRef, "run.billingEvidenceRef");
    const billedUsd = item.billedUsd === null ? null : numberIn(item.billedUsd, "run.billedUsd", 0);
    return {
      caseId, providerId,
      provenance: oneOf(item.provenance, ["synthetic", "live"], "run.provenance"),
      testStatus, reviewStatus,
      artifactRef: nonblank(item.artifactRef, "run.artifactRef"),
      elapsedMs: numberIn(item.elapsedMs, "run.elapsedMs", 0),
      billedUsd,
      ...(item.testEvidenceRef === undefined ? {} : { testEvidenceRef: item.testEvidenceRef as string }),
      ...(item.reviewEvidenceRef === undefined ? {} : { reviewEvidenceRef: item.reviewEvidenceRef as string }),
      ...(item.billingEvidenceRef === undefined ? {} : { billingEvidenceRef: item.billingEvidenceRef as string }),
    };
  });
  return {
    schemaVersion: "mso.coding-qualification-input.v0",
    datasetId, candidateId, incumbentId, catalogProof, operatorReview, policy, cases, runs,
  };
};

const isVerifiedPass = (run: CodingRun): boolean =>
  run.testStatus === "pass" && run.reviewStatus === "pass" &&
  Boolean(run.testEvidenceRef && run.reviewEvidenceRef);

const p95 = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
};

export const qualifyFreeCodingAgent = (input: CodingQualificationInput): CodingQualificationEvidence => {
  // Validate even when called directly, not just through the CLI.
  const validated = parseCodingQualificationInput(input);
  const runs = new Map(validated.runs.map((run) => [run.providerId + "\u0000" + run.caseId, run]));
  const paired: Array<{ task: CodingCase; candidate: CodingRun; incumbent: CodingRun }> = [];
  const missingPairs: string[] = [];
  for (const task of validated.cases) {
    const candidate = runs.get(validated.candidateId + "\u0000" + task.id);
    const incumbent = runs.get(validated.incumbentId + "\u0000" + task.id);
    if (!candidate || !incumbent) {
      missingPairs.push(task.id);
      continue;
    }
    paired.push({ task, candidate, incumbent });
  }
  const live = paired.filter(({ task, candidate, incumbent }) =>
    task.exposure === "approved_public" &&
    candidate.provenance === "live" && incumbent.provenance === "live",
  );
  const count = live.length;
  const candidatePasses = live.filter(({ candidate }) => isVerifiedPass(candidate)).length;
  const incumbentPasses = live.filter(({ incumbent }) => isVerifiedPass(incumbent)).length;
  const regressions = live.filter(({ candidate, incumbent }) => isVerifiedPass(incumbent) && !isVerifiedPass(candidate)).length;
  const wins = live.filter(({ candidate, incumbent }) => isVerifiedPass(candidate) && !isVerifiedPass(incumbent)).length;
  const ties = live.filter(({ candidate, incumbent }) => isVerifiedPass(candidate) === isVerifiedPass(incumbent)).length;
  const families = new Set(live.map(({ task }) => task.taskFamily)).size;
  const billingCoverage = live.filter(({ candidate }) =>
    candidate.billedUsd !== null && Boolean(candidate.billingEvidenceRef)).length;
  const totalCost = billingCoverage === count && count > 0
    ? live.reduce((total, { candidate }) => total + (candidate.billedUsd ?? 0), 0)
    : null;
  const passRate = count ? candidatePasses / count : null;
  const regressionRate = count ? regressions / count : null;
  const latency = p95(live.map(({ candidate }) => candidate.elapsedMs));
  const checks: QualificationCheck[] = [];
  const add = (id: string, ok: boolean | null, detail: string): void => {
    checks.push({ id, status: ok === null ? "insufficient" : ok ? "pass" : "fail", detail });
  };
  add("model_identity_and_catalog",
    validated.candidateId === FREE_DEEPSEEK_MODEL_ID &&
    validated.catalogProof.modelId === "deepseek-v4.1-flash-free" &&
    validated.catalogProof.available &&
    validated.catalogProof.pricing === "free",
    "Require the exact free-tier model ID and operator-checked pricing, not the paid alias");
  add("operator_data_and_isolation_approval",
    validated.operatorReview.isolationApproved && validated.operatorReview.dataHandlingApproved,
    "Only approved public workloads in isolated disposable workspaces");
  add("live_paired_cases", count >= validated.policy.minLivePairs,
    String(count) + "/" + String(validated.policy.minLivePairs) + " live paired cases");
  add("task_family_coverage", families >= validated.policy.minLiveTaskFamilies,
    String(families) + "/" + String(validated.policy.minLiveTaskFamilies) + " live task families");
  add("verified_pass_rate", passRate === null ? null : passRate >= validated.policy.minVerifiedPassRate,
    "Tests AND independent review must pass with evidence references");
  add("regression_rate", regressionRate === null ? null : regressionRate <= validated.policy.maxRegressionRate,
    "Incumbent verified passes that candidate did not reproduce");
  add("p95_elapsed_ms", latency === null ? null : latency <= validated.policy.maxP95ElapsedMs,
    "Candidate p95 end-to-end elapsed milliseconds");
  add("cost_evidence_coverage", count === 0 ? null : billingCoverage === count,
    "Each live candidate run requires a billing reference AND an actual billed amount");
  add("total_billed_usd", count === 0 ? null : totalCost !== null && totalCost <= validated.policy.maxTotalBilledUsd,
    "A free model name never substitutes for actual billing verification");
  add("live_data_exposure", !validated.runs.some((run) => run.provenance === "live" && validated.cases.find((task) => task.id === run.caseId)?.exposure !== "approved_public"),
    "All live data must be explicitly approved public tasks");
  add("paired_completeness", missingPairs.length === 0, "No unmatched fixture cases");
  const insufficient = checks.some((check) => check.status === "insufficient") ||
    count < validated.policy.minLivePairs || families < validated.policy.minLiveTaskFamilies;
  const failed = checks.some((check) => check.status === "fail");
  const decision = insufficient ? "insufficient_evidence" :
    failed ? "blocked" : "eligible_for_shadow";
  const sourceRefs = new Set<string>([
    validated.catalogProof.sourceRef, validated.operatorReview.approvalRef,
    ...validated.cases.map((task) => task.artifactRef),
    ...validated.runs.flatMap((run) => [
      run.artifactRef,
      ...(run.testEvidenceRef ? [run.testEvidenceRef] : []),
      ...(run.reviewEvidenceRef ? [run.reviewEvidenceRef] : []),
      ...(run.billingEvidenceRef ? [run.billingEvidenceRef] : []),
    ]),
  ]);
  return {
    schemaVersion: "mso.coding-qualification.v0",
    datasetId: validated.datasetId,
    candidateId: validated.candidateId,
    incumbentId: validated.incumbentId,
    decision,
    observedPairs: paired.length,
    eligibleLivePairs: count,
    missingPairs,
    summary: {
      taskFamilies: families,
      candidateVerifiedPasses: candidatePasses,
      incumbentVerifiedPasses: incumbentPasses,
      candidatePassRate: passRate,
      incumbentPassRate: count ? incumbentPasses / count : null,
      regressions, wins, ties, regressionRate,
      candidateP95ElapsedMs: latency,
      candidateBilledUsd: totalCost,
      billingCoverage,
    },
    checks,
    sourceRefs: [...sourceRefs].sort(),
    syntheticExcludedFromPromotion: true,
    evidenceOnly: true,
    automaticRoutingDecision: false,
    automaticProviderPromotion: false,
    productionAuthorityChange: false,
  };
};
