import { createHash } from "node:crypto";
import { evaluateTrial, type Outcome, type Trial } from "../recursive-harness/lab.js";

export type PstackSkill = "poteto-mode" | "reflect" | "correct";
export type GateDecision = "reject" | "insufficient_evidence" | "review_required";

export interface PstackIntake {
  schemaVersion: "mso.open-pstack-intake.v0";
  source: {
    repository: "ericlitman/open-pstack";
    release: "1.15.0";
    commit: string;
    license: "MIT";
  };
  skills: Array<{ name: PstackSkill; path: string; blobSha: string }>;
  controls: {
    installPlugin: false;
    enableHooks: false;
    runExternalCommands: false;
    enableNetwork: false;
    modifyGlobalSettings: false;
    automaticActivation: false;
    humanReviewRequired: true;
    maxAddedCostUsd: number;
    maxAddedLatencyMs: number;
    minVerifiedSuccessGain: number;
  };
  audit: {
    status: "pending" | "approved";
    evidenceDigest?: string;
  };
}

export interface PstackGateInput {
  schemaVersion: "mso.open-pstack-trial.v0";
  intake: PstackIntake;
  trial: Trial;
}

export interface PstackGateEvidence {
  schemaVersion: "mso.open-pstack-gate.v0";
  trialId: string;
  sourceCommit: string;
  sourceFingerprint: string;
  intakeStatus: "quarantined" | "supervised_review_only";
  decision: GateDecision;
  reasons: string[];
  measures: Outcome["metrics"];
  rhoDecision: Outcome["decision"];
  rhoReasons: string[];
  independentVerificationRequired: true;
  humanReviewRequired: true;
  codeOrPluginExecuted: false;
  automaticActivation: false;
  runtimeAuthorityChange: false;
}

const sourceCommit = "9368993ea3d96b491833d53c0964b389e868162c";
const skillPins: Record<PstackSkill, { path: string; blobSha: string }> = {
  "poteto-mode": {
    path: "plugins/pstack/skills/poteto-mode/SKILL.md",
    blobSha: "dcab879a0cdb30b4885536bb9a3b90161808d765",
  },
  reflect: {
    path: "plugins/pstack/skills/reflect/SKILL.md",
    blobSha: "a1d550b75af79b1ba57f56fe522953bdae612012",
  },
  correct: {
    path: "plugins/pstack/skills/correct/SKILL.md",
    blobSha: "c45e06f48a0982ae19f92c6e83a8cd05988097a3",
  },
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function parsePstackIntake(value: unknown): PstackIntake {
  if (!record(value) || value.schemaVersion !== "mso.open-pstack-intake.v0") {
    throw new Error("invalid Open Pstack intake schema");
  }
  const { source, skills, controls, audit } = value;
  if (!record(source) || source.repository !== "ericlitman/open-pstack" ||
      source.release !== "1.15.0" || source.license !== "MIT" ||
      source.commit !== sourceCommit) {
    throw new Error("unreviewed Open Pstack source revision");
  }
  if (!Array.isArray(skills) || skills.length !== 3) {
    throw new Error("exactly three pinned advisory skills required");
  }
  const seen = new Set<PstackSkill>();
  for (const skill of skills) {
    if (!record(skill) || typeof skill.name !== "string" ||
        !(skill.name in skillPins)) {
      throw new Error("unexpected skill");
    }
    const name = skill.name as PstackSkill;
    if (seen.has(name) || skill.path !== skillPins[name].path ||
        skill.blobSha !== skillPins[name].blobSha) {
      throw new Error("skill pin mismatch or duplicate");
    }
    seen.add(name);
  }
  if (!record(controls)) throw new Error("missing isolation controls");
  for (const name of [
    "installPlugin", "enableHooks", "runExternalCommands",
    "enableNetwork", "modifyGlobalSettings", "automaticActivation",
  ]) {
    if (controls[name] !== false) throw new Error(`unsafe control: ${name}`);
  }
  if (controls.humanReviewRequired !== true) {
    throw new Error("human review must remain required");
  }
  for (const name of ["maxAddedCostUsd", "maxAddedLatencyMs"]) {
    if (typeof controls[name] !== "number" ||
        !Number.isFinite(controls[name]) || controls[name] < 0) {
      throw new Error(`invalid budget: ${name}`);
    }
  }
  if (typeof controls.minVerifiedSuccessGain !== "number" ||
      !Number.isSafeInteger(controls.minVerifiedSuccessGain) ||
      controls.minVerifiedSuccessGain < 0) {
    throw new Error("invalid minVerifiedSuccessGain");
  }
  if (!record(audit) || !["pending", "approved"].includes(String(audit.status)) ||
      (audit.status === "approved" && !isSha256(audit.evidenceDigest)) ||
      (audit.evidenceDigest !== undefined && !isSha256(audit.evidenceDigest))) {
    throw new Error("invalid review evidence");
  }
  return value as unknown as PstackIntake;
}

// Binds an A/B candidate to reviewed source pins and *declared* isolation
// controls, not to an installed plugin. The audit review may change separately.
export function fingerprintPstackIntake(intake: PstackIntake): string {
  const checked = parsePstackIntake(intake);
  const skills = [...checked.skills]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, path, blobSha }) => ({ name, path, blobSha }));
  return sha256(JSON.stringify({
    source: checked.source,
    skills,
    controls: checked.controls,
  }));
}

export function evaluatePstackGate(value: unknown): PstackGateEvidence {
  if (!record(value) || value.schemaVersion !== "mso.open-pstack-trial.v0" ||
      !record(value.trial)) {
    throw new Error("invalid Open Pstack trial");
  }
  const intake = parsePstackIntake(value.intake);
  // The existing RHO evaluator is authoritative for the paired probe format.
  // It validates digests, per-executor pairs, sandbox claims and regressions.
  const trial = value.trial as unknown as Trial;
  const rho = evaluateTrial(trial);
  const fingerprint = fingerprintPstackIntake(intake);
  if (trial.candidateDigest !== fingerprint) {
    throw new Error("trial candidate does not match pinned intake fingerprint");
  }
  const reasons = [...rho.reasons];
  let decision: GateDecision = rho.decision;
  if (rho.metrics.costDeltaUsd > intake.controls.maxAddedCostUsd ||
      rho.metrics.latencyDeltaMs > intake.controls.maxAddedLatencyMs ||
      rho.metrics.successesCandidate - rho.metrics.successesBaseline <
        intake.controls.minVerifiedSuccessGain) {
    reasons.push("quality_or_budget_gate_failed");
    decision = "reject";
  }
  const reviewed = intake.audit.status === "approved";
  if (!reviewed) reasons.push("source_review_pending");
  if (!trial.operatorApproved) reasons.push("operator_approval_required");
  if (decision !== "reject" && (!reviewed || !trial.operatorApproved)) {
    decision = "insufficient_evidence";
  }
  return {
    schemaVersion: "mso.open-pstack-gate.v0",
    trialId: trial.trialId,
    sourceCommit: sourceCommit,
    sourceFingerprint: fingerprint,
    intakeStatus: reviewed ? "supervised_review_only" : "quarantined",
    decision,
    reasons: [...new Set(reasons)].sort(),
    measures: rho.metrics,
    rhoDecision: rho.decision,
    rhoReasons: rho.reasons,
    independentVerificationRequired: true,
    humanReviewRequired: true,
    codeOrPluginExecuted: false,
    automaticActivation: false,
    runtimeAuthorityChange: false,
  };
}
