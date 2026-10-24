/**
 * MSO-DM-M0.7: offline evidence intake, never an agent executor.
 * Inspired by ECC's Continuous Learning v2, Agent Eval and Harness Construction.
 * An external receipt is a claim until the independent verifier checks its references.
 */
export type HarnessLane = "codex" | "claude-code" | "free";
export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN";
export type GateStatus = "HOLD" | "REJECT" | "READY_FOR_HUMAN_REVIEW";

export interface HarnessTask {
  id: string;
  projectId: string;
  revision: string;
  sensitivity: "public" | "private" | "secret";
  requiredChecks: readonly string[];
}
export interface HarnessCheck {
  id: string;
  status: CheckStatus;
  judge: "deterministic" | "independent" | "self-report";
  evidenceRef?: string;
}
export interface HarnessReceipt {
  taskId: string;
  lane: HarnessLane;
  attempt: number;
  origin: "synthetic" | "external-receipt";
  isolated: boolean;
  projectId: string;
  revision: string;
  checks: readonly HarnessCheck[];
  durationMs?: number;
  costUsd?: number;
  tokenCount?: number;
  evidenceRef?: string;
  /** External free-tier dispatch is never performed by this lab. */
  consentForFreeExternal?: boolean;
}
export interface HarnessInstinct {
  id: string;
  projectId: string;
  scope: "project" | "global";
  confidence: number;
  evidenceRefs: readonly string[];
  proposedAction: string;
}
export interface HarnessSkill {
  id: string;
  source: string;
  license: string;
  path: string;
  body: string;
}
export interface HarnessLabInput {
  schemaVersion: "mso.ecc-harness-input.v0";
  tasks: readonly HarnessTask[];
  receipts: readonly HarnessReceipt[];
  instincts: readonly HarnessInstinct[];
  skills: readonly HarnessSkill[];
}
export interface HarnessLaneReport {
  lane: HarnessLane;
  taskCount: number;
  receipts: number;
  independentlyPassing: number;
  failed: number;
  unknown: number;
  synthetic: number;
  missingTasks: readonly string[];
  durationMsTotal?: number;
  costUsdTotal?: number;
  tokenCountTotal?: number;
  status: GateStatus;
  reasons: readonly string[];
}
export interface HarnessCandidateReport {
  id: string;
  status: "REVIEW_ONLY" | "BLOCKED";
  reasons: readonly string[];
}
export interface HarnessLabReport {
  schemaVersion: "mso.ecc-harness-report.v0";
  mode: "OFFLINE_SHADOW";
  automaticLearning: false;
  automaticPromotion: false;
  automaticRouting: false;
  runtimeAuthorityChange: false;
  externalAgentInvocation: false;
  humanReviewRequired: true;
  laneReports: readonly HarnessLaneReport[];
  instincts: readonly HarnessCandidateReport[];
  skills: readonly HarnessCandidateReport[];
  gate: GateStatus;
  reasons: readonly string[];
}

const lanes: readonly HarnessLane[] = ["codex", "claude-code", "free"];
const statusValues: readonly CheckStatus[] = ["PASS", "FAIL", "UNKNOWN"];
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 4096;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finiteNonnegative = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const unique = (items: readonly string[]): boolean => new Set(items).size === items.length;
const safeEvidence = (s: unknown): s is string =>
  nonempty(s) && !/[\r\n\x00-\x1f]/.test(s) &&
  !/(?:secret|password|token|api[_-]?key)\s*[:=]/i.test(s);

export function parseHarnessLabInput(value: unknown): HarnessLabInput {
  if (!object(value) || value.schemaVersion !== "mso.ecc-harness-input.v0" ||
      !Array.isArray(value.tasks) || !Array.isArray(value.receipts) ||
      !Array.isArray(value.instincts) || !Array.isArray(value.skills)) {
    throw new Error("invalid mso.ecc-harness-input.v0 envelope");
  }
  const input = value as unknown as HarnessLabInput;
  const taskIds = new Set<string>();
  for (const t of input.tasks) {
    if (!object(t) || !nonempty(t.id) || !nonempty(t.projectId) ||
        !nonempty(t.revision) || !["public", "private", "secret"].includes(t.sensitivity) ||
        !Array.isArray(t.requiredChecks) || t.requiredChecks.length === 0 ||
        !t.requiredChecks.every(nonempty) || !unique(t.requiredChecks) || taskIds.has(t.id)) {
      throw new Error("invalid or duplicate task");
    }
    taskIds.add(t.id);
  }
  if (input.tasks.length === 0) throw new Error("at least one task is required");
  const receiptKeys = new Set<string>();
  for (const r of input.receipts) {
    if (!object(r) || !taskIds.has(r.taskId) ||
        !lanes.includes(r.lane) || !Number.isSafeInteger(r.attempt) || r.attempt < 1 ||
        !["synthetic", "external-receipt"].includes(r.origin) || typeof r.isolated !== "boolean" ||
        !nonempty(r.projectId) || !nonempty(r.revision) ||
        !Array.isArray(r.checks) || !r.checks.every(c =>
          object(c) && nonempty(c.id) && statusValues.includes(c.status as CheckStatus) &&
          ["deterministic", "independent", "self-report"].includes(c.judge as string) &&
          (c.evidenceRef === undefined || safeEvidence(c.evidenceRef))) ||
        !unique(r.checks.map(c => c.id)) ||
        (r.durationMs !== undefined && !finiteNonnegative(r.durationMs)) ||
        (r.costUsd !== undefined && !finiteNonnegative(r.costUsd)) ||
        (r.tokenCount !== undefined && !finiteNonnegative(r.tokenCount)) ||
        (r.evidenceRef !== undefined && !safeEvidence(r.evidenceRef)) ||
        (r.consentForFreeExternal !== undefined && typeof r.consentForFreeExternal !== "boolean")) {
      throw new Error("invalid receipt");
    }
    const key = [r.taskId, r.lane, r.attempt].join("/");
    if (receiptKeys.has(key)) throw new Error("duplicate task/lane/attempt receipt");
    receiptKeys.add(key);
  }
  const instinctIds = new Set<string>();
  for (const i of input.instincts) {
    if (!object(i) || !nonempty(i.id) || instinctIds.has(i.id) ||
        !nonempty(i.projectId) || !["project", "global"].includes(i.scope) ||
        typeof i.confidence !== "number" || !Number.isFinite(i.confidence) ||
        i.confidence < 0 || i.confidence > 1 || !nonempty(i.proposedAction) ||
        !Array.isArray(i.evidenceRefs) || !i.evidenceRefs.every(safeEvidence) ||
        !unique(i.evidenceRefs)) throw new Error("invalid instinct");
    instinctIds.add(i.id);
  }
  const skillIds = new Set<string>();
  for (const s of input.skills) {
    if (!object(s) || !nonempty(s.id) || skillIds.has(s.id) ||
        !nonempty(s.source) || !nonempty(s.license) ||
        !nonempty(s.path) || typeof s.body !== "string" || s.body.length > 100000) {
      throw new Error("invalid skill candidate");
    }
    skillIds.add(s.id);
  }
  return input;
}

/** No shell, git, file writes, hosted model calls, or automatic skill loading. */
export function evaluateHarnessLab(input: HarnessLabInput): HarnessLabReport {
  // Validate again; callers can bypass the JSON parser.
  parseHarnessLabInput(input);
  const taskById = new Map(input.tasks.map(t => [t.id, t]));
  const laneReports: HarnessLaneReport[] = lanes.map(lane => {
    const receipts = input.receipts.filter(r => r.lane === lane);
    let independentlyPassing = 0, failed = 0, unknown = 0, synthetic = 0;
    const reasons: string[] = [];
    const missingTasks = input.tasks.filter(t => !receipts.some(r => r.taskId === t.id)).map(t => t.id);
    const validObserved = receipts.filter(r => r.origin === "external-receipt");
    for (const r of receipts) {
      const t = taskById.get(r.taskId)!;
      const checks = new Map(r.checks.map(c => [c.id, c]));
      const violated = r.checks.some(c => c.status === "FAIL");
      const unsupported = t.projectId !== r.projectId || t.revision !== r.revision ||
        (lane === "free" && t.sensitivity !== "public") ||
        (lane === "free" && r.origin === "external-receipt" && r.consentForFreeExternal !== true);
      if (r.origin === "synthetic") synthetic++;
      if (unsupported || violated) {
        failed++;
        reasons.push(`${r.taskId}/${r.attempt}: policy, revision, or check failure`);
        continue;
      }
      const passing = r.origin === "external-receipt" && r.isolated &&
        safeEvidence(r.evidenceRef) &&
        t.requiredChecks.every(id => {
          const c = checks.get(id);
          return c?.status === "PASS" && c.judge !== "self-report" && safeEvidence(c.evidenceRef);
        });
      if (passing) independentlyPassing++;
      else {
        unknown++;
        reasons.push(`${r.taskId}/${r.attempt}: missing independent isolated evidence or synthetic replay`);
      }
    }
    if (missingTasks.length) reasons.push(`missing tasks: ${missingTasks.join(", ")}`);
    const sumObserved = (key: "durationMs" | "costUsd" | "tokenCount") => {
      const values = validObserved.map(r => r[key]).filter((v): v is number => v !== undefined);
      return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
    };
    const status: GateStatus = failed ? "REJECT" :
      missingTasks.length || unknown || receipts.length === 0 ? "HOLD" : "READY_FOR_HUMAN_REVIEW";
    const durationMsTotal = sumObserved("durationMs");
    const costUsdTotal = sumObserved("costUsd");
    const tokenCountTotal = sumObserved("tokenCount");
    return {
      lane, taskCount: input.tasks.length, receipts: receipts.length,
      independentlyPassing, failed, unknown, synthetic, missingTasks, status, reasons,
      ...(durationMsTotal === undefined ? {} : { durationMsTotal }),
      ...(costUsdTotal === undefined ? {} : { costUsdTotal }),
      ...(tokenCountTotal === undefined ? {} : { tokenCountTotal }),
    };
  });
  const instincts: HarnessCandidateReport[] = input.instincts.map(i => {
    const reasons: string[] = [];
    if (i.scope !== "project") reasons.push("global scope is not permitted in shadow");
    if (!input.tasks.some(t => t.projectId === i.projectId)) reasons.push("unknown project");
    if (i.evidenceRefs.length === 0) reasons.push("no supporting evidence");
    if (i.confidence < 0.7) reasons.push("confidence below review threshold");
    return { id: i.id, status: reasons.length ? "BLOCKED" : "REVIEW_ONLY", reasons };
  });
  const skills: HarnessCandidateReport[] = input.skills.map(s => {
    const reasons: string[] = [];
    if (s.license !== "MIT" || !s.source.startsWith("https://github.com/affaan-m/ECC")) {
      reasons.push("unapproved source or license");
    }
    if (!/^skills\/[a-z0-9-]+\/SKILL\.md$/.test(s.path)) reasons.push("unsafe skill path");
    if (!/^---\r?\nname: [a-z0-9-]+\r?\ndescription: .+/m.test(s.body)) {
      reasons.push("missing portable skill frontmatter");
    }
    if (/\$\{CLAUDE_(?:PROJECT_DIR|PLUGIN_ROOT|SKILL_DIR|SESSION_ID)\}|\$ARGUMENTS/.test(s.body)) {
      reasons.push("Claude-only substitution");
    }
    if (/(?:^|\n)hooks\s*:/im.test(s.body) ||
        /(?:curl|wget)[^\n|]*\|\s*(?:ba)?sh\b|(?:rm\s+-rf|git\s+push\s+--force)/i.test(s.body) ||
        /(?:npm|pnpm|yarn)\s+(?:install|add)\b/i.test(s.body)) {
      reasons.push("executable installation, destructive action or hook declaration");
    }
    return { id: s.id, status: reasons.length ? "BLOCKED" : "REVIEW_ONLY", reasons };
  });
  const reasons: string[] = [];
  if (laneReports.some(r => r.status === "REJECT")) reasons.push("agent receipt or privacy policy rejected");
  if ([...instincts, ...skills].some(r => r.status === "BLOCKED")) reasons.push("candidate safety or provenance check blocked");
  if (laneReports.some(r => r.status === "HOLD")) reasons.push("missing actual independently judged A/B evidence");
  const gate: GateStatus = reasons.some(r => /rejected|blocked/.test(r)) ? "REJECT" :
    reasons.length ? "HOLD" : "READY_FOR_HUMAN_REVIEW";
  return {
    schemaVersion: "mso.ecc-harness-report.v0", mode: "OFFLINE_SHADOW",
    automaticLearning: false, automaticPromotion: false, automaticRouting: false,
    runtimeAuthorityChange: false, externalAgentInvocation: false, humanReviewRequired: true,
    laneReports, instincts, skills, gate, reasons,
  };
}
