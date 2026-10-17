/**
 * MSO-DM-M0.6.2c: Codex-controlled MCP delegation. No model-supplied prompt,
 * paths, credentials or approval can authorize live execution.
 */
import { readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  FREE_BEAM_MODEL_ID, FREE_DEEPSEEK_MODEL_ID, FREE_GLM_MODEL_ID,
} from "./free-agent-qualification.js";
import {
  preflightDogfoodJob, executeDogfoodJob, type DogfoodJob,
  type DogfoodEvidence, type DogfoodPlan,
} from "./sandbox-execution.js";

export type DelegationRole = "implement" | "review" | "long_context";
export type DataClass = "approved_public" | "private" | "confidential";
export type DelegationMode = "dry_run" | "execute";
export interface DelegationRequest {
  role: DelegationRole;
  taskRef: string;
  privacy: DataClass;
  mode?: DelegationMode;
}
export interface DelegationOptions {
  repoRoot: string;
  registry: Readonly<Record<string, DogfoodJob>>;
  // Runtime-owned authorization, provisioned by human operator out-of-band;
  // no MCP tool exists to create, set or list this authorization.
  authorization?: ExecutionAuthorization;
  executor?: (job: DogfoodJob, repoRoot: string, authDir: string, artifactsRoot: string) => Promise<DogfoodEvidence>;
}
export interface ExecutionAuthorization {
  schemaVersion: "mso.delegation-authorization.v0";
  taskRef: string;
  providerId: string;
  fixtureSha256: string;
  expiresAt: string;
  authDir: string;
  artifactsRoot: string;
  operatorRef: string;
  allowOneLiveExecution: true;
}
export interface DelegationResult {
  schemaVersion: "mso.delegation-result.v0";
  role: DelegationRole;
  taskRef: string;
  providerId: string;
  privacy: "approved_public";
  mode: DelegationMode;
  status: "planned" | "executed";
  externalCallsMade: boolean;
  plan: DogfoodPlan;
  run?: DogfoodEvidence;
  evidenceOnly: true;
  billingVerified: false;
  automaticRoutingDecision: false;
  productionAuthorityChange: false;
}
export const MODEL_ROLES: Readonly<Record<DelegationRole, string>> = Object.freeze({
  implement: FREE_DEEPSEEK_MODEL_ID,
  review: FREE_GLM_MODEL_ID,
  long_context: FREE_BEAM_MODEL_ID,
});
export const MODEL_PRIVACY: Readonly<Record<string, { retention: "zero" | "30_days"; maxExposure: "approved_public" }>> = Object.freeze({
  [FREE_DEEPSEEK_MODEL_ID]: { retention: "zero", maxExposure: "approved_public" },
  [FREE_GLM_MODEL_ID]: { retention: "zero", maxExposure: "approved_public" },
  [FREE_BEAM_MODEL_ID]: { retention: "30_days", maxExposure: "approved_public" },
});
const record = (x: unknown, name: string): Record<string, unknown> => {
  if (typeof x !== "object" || x === null || Array.isArray(x)) throw new Error(name + " must be object");
  return x as Record<string, unknown>;
};
const text = (x: unknown, name: string): string => {
  if (typeof x !== "string" || !x.trim()) throw new Error(name + " must be non-empty string");
  return x;
};
export const parseDelegationRequest = (raw: unknown): DelegationRequest => {
  const r = record(raw, "request");
  for (const key of Object.keys(r)) {
    if (!["role", "taskRef", "privacy", "mode"].includes(key)) throw new Error("unrecognized delegation field " + key);
  }
  if (!["implement", "review", "long_context"].includes(String(r.role))) throw new Error("unrecognized role");
  if (r.privacy !== "approved_public") throw new Error("private or confidential data denied");
  if (r.mode !== undefined && !["dry_run", "execute"].includes(String(r.mode))) throw new Error("invalid mode");
  const taskRef = text(r.taskRef, "taskRef");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/.test(taskRef)) throw new Error("unsafe task reference");
  return { role: r.role as DelegationRole, taskRef, privacy: "approved_public", mode: (r.mode ?? "dry_run") as DelegationMode };
};
export const parseExecutionAuthorization = (raw: unknown): ExecutionAuthorization => {
  const r = record(raw, "authorization");
  for (const key of Object.keys(r)) if (!["schemaVersion","taskRef","providerId","fixtureSha256","expiresAt","authDir","artifactsRoot","operatorRef","allowOneLiveExecution"].includes(key)) throw new Error("unknown authorization field");
  if (r.schemaVersion !== "mso.delegation-authorization.v0" || r.allowOneLiveExecution !== true) throw new Error("invalid operator authorization");
  const expiresAt = text(r.expiresAt, "expiresAt");
  if (!/^\d{4}-\d\d-\d\dT.*Z$/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt))) throw new Error("invalid UTC expiry");
  const fixtureSha256 = text(r.fixtureSha256,"fixtureSha256");
  if (!/^[a-f0-9]{64}$/.test(fixtureSha256)) throw new Error("invalid authorized fixture SHA");
  return {
    schemaVersion:"mso.delegation-authorization.v0",
    taskRef:text(r.taskRef,"taskRef"), providerId:text(r.providerId,"providerId"),
    fixtureSha256, expiresAt,
    authDir:text(r.authDir,"authDir"), artifactsRoot:text(r.artifactsRoot,"artifactsRoot"),
    operatorRef:text(r.operatorRef,"operatorRef"), allowOneLiveExecution:true,
  };
};
export const loadOperatorAuthorization = async (path: string): Promise<ExecutionAuthorization> => {
  if (resolve(path) !== path) throw new Error("authorization file path must be absolute");
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0) {
    throw new Error("operator authorization must be private regular file with mode 0600");
  }
  return parseExecutionAuthorization(JSON.parse(await readFile(path, "utf8")) as unknown);
};

export class DelegationRouter {
  private attempted = false;
  constructor(private readonly options: DelegationOptions) {}
  async delegate(raw: unknown): Promise<DelegationResult> {
    const request = parseDelegationRequest(raw);
    const providerId = MODEL_ROLES[request.role];
    const job = this.options.registry[request.taskRef];
    if (!job) throw new Error("task not registered by operator");
    if (job.providerId !== providerId) throw new Error("task is not approved for this role/model");
    if (job.approval.publicFixture !== true) throw new Error("fixture is not public and reviewed");
    const { plan } = await preflightDogfoodJob(job, this.options.repoRoot);
    const base = {
      schemaVersion:"mso.delegation-result.v0" as const,
      role:request.role, taskRef:request.taskRef, providerId,
      privacy:"approved_public" as const, evidenceOnly:true as const,
      billingVerified:false as const, automaticRoutingDecision:false as const,
      productionAuthorityChange:false as const,
    };
    if (request.mode !== "execute") {
      return { ...base, mode:"dry_run", status:"planned", externalCallsMade:false, plan };
    }
    const approval = this.options.authorization;
    if (!approval) throw new Error("operator execution authorization is absent; dry-run only");
    // Fail closed, consume approval before any I/O and never retry automatically.
    if (this.attempted) throw new Error("execution authorization already consumed");
    this.attempted = true;
    if (approval.taskRef !== request.taskRef ||
      approval.providerId !== providerId ||
      approval.fixtureSha256 !== plan.fixtureSha256 ||
      Date.now() >= Date.parse(approval.expiresAt)) {
      throw new Error("operator approval does not match task, model, digest or valid lifetime");
    }
    if (!Object.entries(job.approval).every(([key,val]) => key === "approvalRef" || val === true)) {
      throw new Error("manifest missing network/data/spending approval");
    }
    const execute = this.options.executor ?? executeDogfoodJob;
    const run = await execute(job, this.options.repoRoot, approval.authDir, approval.artifactsRoot);
    return { ...base, mode:"execute", status:"executed", externalCallsMade:true, plan, run };
  }
}
export const authorizationFingerprint = (auth: ExecutionAuthorization): string =>
  createHash("sha256").update(auth.taskRef + "\0" + auth.providerId + "\0" + auth.fixtureSha256).digest("hex");
