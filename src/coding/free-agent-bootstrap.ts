#!/usr/bin/env node
/**
 * Generates a deliberately non-executable starter registry for Codex MCP.
 * No credentials, models, containers or network are contacted.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { hashPublicFixture, preflightDogfoodJob, type DogfoodJob } from "./sandbox-execution.js";
import { MODEL_ROLES } from "./free-agent-delegation.js";

export type StarterRegistry = Readonly<Record<string, DogfoodJob>>;

export const createStarterRegistry = async (repoRoot: string): Promise<StarterRegistry> => {
  const root = resolve(repoRoot);
  const fixtureDirs: Record<keyof typeof MODEL_ROLES, string> = {
    implement: "fixtures/dogfood/ts-clamp",
    review: "fixtures/dogfood/ts-clamp",
    long_context: "fixtures/dogfood/godot-combo",
  };
  const registry: Record<string, DogfoodJob> = {};
  for (const role of ["implement", "review", "long_context"] as const) {
    const fixtureDir = fixtureDirs[role];
    const expectedFixtureSha256 = await hashPublicFixture(resolve(root, fixtureDir));
    const job: DogfoodJob = {
      schemaVersion: "mso.coding-dogfood-job.v0",
      runId: "dryrun-" + role,
      caseId: role === "long_context" ? "godot-combo" : "ts-clamp",
      taskFamily: role === "long_context" ? "godot" : "typescript",
      providerId: MODEL_ROLES[role],
      fixtureDir,
      promptFile: "TASK.md",
      expectedFixtureSha256,
      // This intentionally fictitious image digest prevents accidentally claiming
      // a reviewed/installed image. Do not use this output for live execution.
      image: "ghcr.io/replace-with-reviewed-opencode@sha256:" + "0".repeat(64),
      egressNetwork: "mso-free-egress-unconfigured",
      limits: { timeoutSeconds: 120, memoryMb: 1024, cpus: 1 },
      approval: {
        publicFixture: true,
        externalTransmission: false,
        spendingRisk: false,
        networkEgressControlled: false,
        approvalRef: "starter:DRY-RUN-ONLY",
      },
    };
    // Validate all frozen public fixtures now rather than failing at MCP use time.
    await preflightDogfoodJob(job, root);
    registry["public:" + role] = job;
  }
  return registry;
};

const main = async (args: string[]): Promise<void> => {
  const opt = (name: string): string => {
    const i = args.indexOf(name);
    if (i < 0 || !args[i+1] || args[i+1]?.startsWith("--")) throw new Error(name + " is required");
    return args[i+1]!;
  };
  const root = resolve(opt("--repo-root"));
  const rawOutput = opt("--out");
  if (!isAbsolute(rawOutput)) throw new Error("--out must be an absolute path outside the repository");
  const out = resolve(rawOutput);
  if (out.startsWith(root + sep) || out === root) throw new Error("operator registry must be outside the repository");
  const registry = await createStarterRegistry(root);
  await mkdir(dirname(out), { recursive: true, mode: 0o700 });
  await writeFile(out, JSON.stringify(registry, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log("starter_registry=" + out + " roles=3 mode=dry_run external_calls=0");
};

if (process.argv[1]?.endsWith("free-agent-bootstrap.js")) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
