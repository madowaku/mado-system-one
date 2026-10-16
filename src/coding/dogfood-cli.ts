#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { executeDogfoodJob, preflightDogfoodJob } from "./sandbox-execution.js";
import { reconcileDogfoodProof } from "./billing-reconciliation.js";
import type { DogfoodEvidence } from "./sandbox-execution.js";
import type { PairedCodingCase } from "./multi-free-bakeoff.js";

const option = (args: string[], name: string): string => {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1] || args[i + 1]?.startsWith("--")) {
    throw new Error("required argument " + name);
  }
  return args[i + 1]!;
};
const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8")) as unknown;
const save = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
};

const main = async (args: string[]): Promise<void> => {
  if (args[0] === "probe") {
    const raw = await readJson(option(args, "--manifest"));
    const repoRoot = resolve(option(args, "--repo-root"));
    const out = option(args, "--out");
    const { plan } = await preflightDogfoodJob(raw, repoRoot);
    if (args.includes("--execute")) {
      for (const flag of ["--ack-public", "--ack-network", "--ack-spending"]) {
        if (!args.includes(flag)) throw new Error("explicit execution acknowledgement required: " + flag);
      }
      const authDir = resolve(option(args, "--auth-dir"));
      const artifactsRoot = resolve(option(args, "--artifacts-root"));
      const result = await executeDogfoodJob(raw, repoRoot, authDir, artifactsRoot);
      await save(out, result);
      console.log("recorded_run=" + result.runId + " status=" + result.status +
        " test=not_run billing=unverified report=" + out);
    } else {
      await save(out, plan);
      console.log("dry_run=" + plan.runId + " external_calls=0 plan=" + out);
    }
    return;
  }
  if (args[0] === "reconcile") {
    const run = await readJson(option(args, "--run")) as DogfoodEvidence;
    const task = await readJson(option(args, "--case")) as PairedCodingCase;
    const billing = args.includes("--billing") ? await readJson(option(args,"--billing")) : null;
    const verification = args.includes("--verification") ? await readJson(option(args,"--verification")) : null;
    const result = reconcileDogfoodProof(run, task, billing, verification);
    const out = option(args,"--out");
    await save(out, result);
    console.log("reconciled=" + result.runId + " billed_usd=" + (result.billedUsd ?? "unverified") +
      " independent_pass=" + result.independentlyVerified + " report=" + out);
    return;
  }
  throw new Error(
    "Usage: npm run dm:dogfood -- probe --manifest <job.json> --repo-root <repo> --out <plan.json>\n" +
    "Live opt-in: add --execute --ack-public --ack-network --ack-spending --auth-dir <dedicated dir> --artifacts-root <dir>\n" +
    "Proof: npm run dm:dogfood -- reconcile --run <run.json> --case <case.json> [--billing <ledger.json>] [--verification <checks.json>] --out <proof.json>",
  );
};
main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
