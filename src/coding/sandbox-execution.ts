/**
 * MSO-DM-M0.6.2: opt-in, disposable OpenCode execution with minimal evidence.
 * This is an operator tool, NEVER a CI/model-side automatic execution path.
 */
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { FREE_CODING_MODEL_REGISTRY } from "./free-agent-qualification.js";

export interface DogfoodJob {
  schemaVersion: "mso.coding-dogfood-job.v0";
  runId: string;
  caseId: string;
  taskFamily: string;
  providerId: string;
  fixtureDir: string;
  promptFile: string;
  expectedFixtureSha256: string;
  image: string;
  egressNetwork: string;
  limits: { timeoutSeconds: number; memoryMb: number; cpus: number };
  approval: {
    publicFixture: boolean;
    externalTransmission: boolean;
    spendingRisk: boolean;
    networkEgressControlled: boolean;
    approvalRef: string;
  };
}
export interface DogfoodEvidence {
  schemaVersion: "mso.coding-dogfood-run.v0";
  runId: string;
  caseId: string;
  taskFamily: string;
  providerId: string;
  provenance: "live";
  status: "succeeded" | "failed" | "timed_out";
  exitCode: number | null;
  elapsedMs: number;
  fixtureSha256: string;
  artifactSha256: string;
  outputSha256: string;
  outputBytes: number;
  artifactRef: string;
  approvalRef: string;
  testStatus: "not_run";
  reviewStatus: "not_run";
  billedUsd: null;
  billingEvidenceRef: null;
  rawTranscriptPersisted: false;
  automaticallyQualified: false;
  automaticRoutingDecision: false;
}
export interface DogfoodPlan {
  schemaVersion: "mso.coding-dogfood-plan.v0";
  runId: string;
  caseId: string;
  providerId: string;
  fixtureSha256: string;
  image: string;
  egressNetwork: string;
  timeoutSeconds: number;
  simulatedOnly: true;
  externalCallsMade: false;
  secretsAccessed: false;
}
const required = (v: unknown, n: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new Error(n + " must be non-empty");
  return v;
};
const object = (v: unknown, n: string): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(n + " must be an object");
  return v as Record<string, unknown>;
};
const keys = (o: Record<string, unknown>, allowed: string[], n: string): void => {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new Error(n + " unknown key " + k);
};
const int = (v: unknown, n: string, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(n + " outside allowed range");
  }
  return v;
};
const bool = (v: unknown, n: string): boolean => {
  if (typeof v !== "boolean") throw new Error(n + " must be boolean");
  return v;
};

export const parseDogfoodJob = (raw: unknown): DogfoodJob => {
  const input = object(raw, "job");
  keys(input, ["schemaVersion", "runId", "caseId", "taskFamily", "providerId", "fixtureDir", "promptFile", "expectedFixtureSha256", "image", "egressNetwork", "limits", "approval"], "job");
  if (input.schemaVersion !== "mso.coding-dogfood-job.v0") throw new Error("unsupported job schema");
  const runId = required(input.runId, "runId");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runId)) throw new Error("invalid runId");
  const caseId = required(input.caseId, "caseId");
  const taskFamily = required(input.taskFamily, "taskFamily");
  const providerId = required(input.providerId, "providerId");
  if (!Object.hasOwn(FREE_CODING_MODEL_REGISTRY, providerId)) throw new Error("unapproved or non-free provider: " + providerId);
  const fixtureDir = required(input.fixtureDir, "fixtureDir");
  if (isAbsolute(fixtureDir) || fixtureDir.includes("\\") || fixtureDir.split("/").some(part => part === ".." || part === ".")) {
    throw new Error("fixtureDir must be a repository-relative path");
  }
  if (!fixtureDir.startsWith("fixtures/dogfood/")) throw new Error("only fixtures/dogfood are eligible");
  const promptFile = required(input.promptFile, "promptFile");
  if (promptFile.includes("/") || promptFile.includes("\\") || promptFile.startsWith(".")) throw new Error("promptFile must be a top-level public fixture file");
  const expectedFixtureSha256 = required(input.expectedFixtureSha256, "expectedFixtureSha256");
  if (!/^[a-f0-9]{64}$/.test(expectedFixtureSha256)) throw new Error("expectedFixtureSha256 must be sha256");
  const image = required(input.image, "image");
  if (!/^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error("Docker image must be immutable digest-pinned");
  const egressNetwork = required(input.egressNetwork, "egressNetwork");
  if (!/^mso-free-egress-[a-z0-9-]{1,32}$/.test(egressNetwork)) throw new Error("egress must be an explicitly provisioned mso-free-egress-* network");
  const limits = object(input.limits, "limits");
  keys(limits, ["timeoutSeconds","memoryMb","cpus"], "limits");
  const approval = object(input.approval, "approval");
  keys(approval, ["publicFixture","externalTransmission","spendingRisk","networkEgressControlled","approvalRef"], "approval");
  return {
    schemaVersion: "mso.coding-dogfood-job.v0",
    runId, caseId, taskFamily, providerId, fixtureDir, promptFile, expectedFixtureSha256, image, egressNetwork,
    limits: {
      timeoutSeconds: int(limits.timeoutSeconds, "timeoutSeconds", 10, 600),
      memoryMb: int(limits.memoryMb, "memoryMb", 256, 4096),
      cpus: int(limits.cpus, "cpus", 1, 4),
    },
    approval: {
      publicFixture: bool(approval.publicFixture, "publicFixture"),
      externalTransmission: bool(approval.externalTransmission, "externalTransmission"),
      spendingRisk: bool(approval.spendingRisk, "spendingRisk"),
      networkEgressControlled: bool(approval.networkEgressControlled, "networkEgressControlled"),
      approvalRef: required(approval.approvalRef, "approvalRef"),
    },
  };
};

const banned = (name: string): boolean =>
  name === ".git" || name === ".opencode" || name === "node_modules" ||
  name === "opencode.json" || name === "auth.json" ||
  name.startsWith(".env") || /(^|[._-])(secret|credential|token|private.key)([._-]|$)/i.test(name);

export const hashPublicFixture = async (root: string): Promise<string> => {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("fixture root must be a real directory");
  const files: { path: string; content: Buffer }[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const item of (await readdir(dir)).sort()) {
      if (banned(item)) throw new Error("private or executable configuration in fixture: " + item);
      const path = join(dir, item);
      const rel = prefix ? prefix + "/" + item : item;
      const st = await lstat(path);
      if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile()) || st.nlink > 1 && st.isFile()) {
        throw new Error("fixture contains unsafe file type: " + rel);
      }
      if (st.isDirectory()) await walk(path, rel);
      else {
        if (st.size > 512 * 1024 || files.length >= 80) throw new Error("fixture exceeds size or file count limit");
        files.push({ path: rel, content: await readFile(path) });
      }
    }
  };
  await walk(root, "");
  if (files.length === 0) throw new Error("empty fixture");
  if (files.reduce((sum, f) => sum + f.content.length, 0) > 2 * 1024 * 1024) throw new Error("fixture exceeds 2MB");
  const h = createHash("sha256");
  for (const f of files) {
    h.update(String(Buffer.byteLength(f.path))).update(":").update(f.path).update(":");
    h.update(String(f.content.length)).update(":").update(f.content);
  }
  return h.digest("hex");
};

export const preflightDogfoodJob = async (raw: unknown, repoRoot: string): Promise<{ job: DogfoodJob; plan: DogfoodPlan; fixturePath: string; prompt: string }> => {
  const job = parseDogfoodJob(raw);
  for (const dir of [resolve(repoRoot), resolve(repoRoot, "fixtures"), resolve(repoRoot, "fixtures", "dogfood")]) {
    const st = await lstat(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("public fixture path may not contain linked directories");
  }
  const allowedRoot = resolve(repoRoot, "fixtures", "dogfood");
  const fixturePath = resolve(repoRoot, job.fixtureDir);
  if (!fixturePath.startsWith(allowedRoot + sep)) throw new Error("fixture escaped allowed root");
  const sha = await hashPublicFixture(fixturePath);
  if (sha !== job.expectedFixtureSha256) throw new Error("fixture SHA mismatch: stale or unreviewed public snapshot");
  const prompt = await readFile(join(fixturePath, job.promptFile), "utf8");
  if (prompt.length === 0 || prompt.length > 8000) throw new Error("public prompt must be 1 to 8000 chars");
  return {
    job, fixturePath, prompt,
    plan: {
      schemaVersion: "mso.coding-dogfood-plan.v0",
      runId: job.runId, caseId: job.caseId, providerId: job.providerId, fixtureSha256: sha,
      image: job.image, egressNetwork: job.egressNetwork, timeoutSeconds: job.limits.timeoutSeconds,
      simulatedOnly: true, externalCallsMade: false, secretsAccessed: false,
    },
  };
};

export interface DockerInvocation { args: string[]; name: string }
export const dockerInvocation = (job: DogfoodJob, workspace: string, authDir: string, prompt: string, name: string): DockerInvocation => {
  const config = JSON.stringify({
    "$schema": "https://opencode.ai/config.json",
    permission: {
      "*": "deny", read: "allow", edit: "allow", glob: "allow", grep: "allow", list: "allow",
      external_directory: "deny", bash: "deny", webfetch: "deny", websearch: "deny", task: "deny",
    },
    mcp: {}, autoupdate: false,
  });
  return { name, args: [
    "run", "--rm", "--pull=never", "--init", "--name", name,
    "--network", job.egressNetwork, "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--pids-limit=64",
    "--memory", String(job.limits.memoryMb) + "m", "--cpus", String(job.limits.cpus),
    "--user", String(process.getuid?.() ?? 10001) + ":" + String(process.getgid?.() ?? 10001),
    "--workdir=/workspace", "--tmpfs=/tmp:rw,nosuid,nodev,mode=1777,size=256m",
    "--mount", "type=bind,src=" + workspace + ",dst=/workspace",
    "--mount", "type=bind,src=" + authDir + ",dst=/tmp/xdg/opencode",
    "--env=HOME=/tmp", "--env=XDG_DATA_HOME=/tmp/xdg",
    "--env=XDG_CONFIG_HOME=/tmp/config", "--env=XDG_CACHE_HOME=/tmp/cache",
    "--env=XDG_STATE_HOME=/tmp/state",
    "--env=OPENCODE_CONFIG_CONTENT=" + config,
    "--env=OPENCODE_DISABLE_DEFAULT_PLUGINS=true",
    "--env=OPENCODE_DISABLE_CLAUDE_CODE=true",
    "--env=OPENCODE_DISABLE_AUTOUPDATE=true",
    "--env=OPENCODE_DISABLE_LSP_DOWNLOAD=true",
    "--entrypoint=opencode", job.image, "--pure", "run", "--model", job.providerId,
    "--format", "json", "--title", "mso-dogfood-" + job.caseId, prompt,
  ] };
};

export interface CommandResult {
  exitCode: number | null;
  timedOut: boolean;
  elapsedMs: number;
  outputSha256: string;
  outputBytes: number;
}
export type CommandRunner = (name: string, args: string[], timeoutMs: number) => Promise<CommandResult>;

export const defaultCommandRunner: CommandRunner = async (name, args, timeoutMs) => {
  const started = performance.now();
  const hash = createHash("sha256");
  let outputBytes = 0, timedOut = false;
  const child = spawn(name, args, { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "" } });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      hash.update(chunk);
      if (outputBytes > 2 * 1024 * 1024) child.kill("SIGKILL");
    });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finished = new Promise<number | null>((resolveFinish, rejectFinish) => {
    child.once("error", rejectFinish);
    child.once("close", (code) => resolveFinish(code));
  });
  try {
    timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    const exitCode = await finished;
    return {
      exitCode, timedOut, elapsedMs: Math.round(performance.now() - started),
      outputSha256: hash.digest("hex"), outputBytes,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const executeDogfoodJob = async (
  raw: unknown, repoRoot: string, authDir: string, artifactsRoot: string,
  runner: CommandRunner = defaultCommandRunner,
): Promise<DogfoodEvidence> => {
  const { job, fixturePath, plan, prompt } = await preflightDogfoodJob(raw, repoRoot);
  if (!Object.entries(job.approval).every(([key, value]) => key === "approvalRef" || value === true)) {
    throw new Error("explicit public/data/network/spending approvals required before live execution");
  }
  if (!isAbsolute(authDir) || !isAbsolute(artifactsRoot)) throw new Error("auth/artifacts paths must be absolute");
  const authPath = resolve(authDir);
  const artifactRoot = resolve(artifactsRoot);
  const repoPath = resolve(repoRoot);
  const intersects = (a: string, b: string): boolean =>
    a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
  if (intersects(authPath, artifactRoot) || intersects(authPath, repoPath)) {
    throw new Error("credential directory cannot overlap repository or artifacts");
  }
  const auth = await lstat(authDir);
  if (!auth.isDirectory() || auth.isSymbolicLink()) throw new Error("dedicated auth directory required");
  const authFile = await lstat(join(authDir, "auth.json"));
  if ((auth.mode & 0o077) !== 0) throw new Error("auth directory must be owner-only (chmod 700)");
  if (!authFile.isFile() || authFile.isSymbolicLink()) throw new Error("dedicated OpenCode auth.json required");
  if ((authFile.mode & 0o077) !== 0) throw new Error("auth.json must have owner-only permissions (chmod 600)");
  const artifactPath = resolve(artifactsRoot, job.runId);
  try { await stat(artifactPath); throw new Error("artifact directory already exists"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(artifactsRoot, { recursive: true });
  const sandbox = await mkdtemp(join(tmpdir(), "mso-dogfood-"));
  const workspace = join(sandbox, "workspace");
  const containerName = "mso-dogfood-" + randomUUID().slice(0, 12);
  const invocation = dockerInvocation(job, workspace, authDir, prompt, containerName);
  try {
    await cp(fixturePath, workspace, { recursive: true, errorOnExist: true });
    if (await hashPublicFixture(workspace) !== plan.fixtureSha256) throw new Error("fixture changed while staging");
    let command: CommandResult;
    try {
      command = await runner("docker", invocation.args, job.limits.timeoutSeconds * 1000);
    } finally {
      // Docker CLI timeout can leave a container running; force-stop by exact random name.
      // Cleanup failure is not a reason to silently declare a run safe.
      if (runner === defaultCommandRunner) {
        const cleanup = await defaultCommandRunner("docker", ["rm", "-f", containerName], 15000);
        if (cleanup.timedOut) throw new Error("Docker cleanup timed out; inspect running containers");
      }
    }
    const artifactSha256 = await hashPublicFixture(workspace);
    await cp(workspace, artifactPath, { recursive: true, errorOnExist: true });
    const status = command.timedOut ? "timed_out" : command.exitCode === 0 ? "succeeded" : "failed";
    return {
      schemaVersion: "mso.coding-dogfood-run.v0",
      runId: job.runId, caseId: job.caseId, taskFamily: job.taskFamily,
      providerId: job.providerId, provenance: "live", status,
      exitCode: command.exitCode, elapsedMs: command.elapsedMs,
      fixtureSha256: plan.fixtureSha256, artifactSha256, outputSha256: command.outputSha256,
      outputBytes: command.outputBytes, artifactRef: "public-dogfood:" + job.runId + ":" + artifactSha256,
      approvalRef: job.approval.approvalRef,
      testStatus: "not_run", reviewStatus: "not_run",
      billedUsd: null, billingEvidenceRef: null,
      rawTranscriptPersisted: false, automaticallyQualified: false, automaticRoutingDecision: false,
    };
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
};
