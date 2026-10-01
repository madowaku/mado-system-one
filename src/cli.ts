#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  parseEvalJsonl,
  replayRecordsFromCases,
  runEval,
  writeEvalEvidence,
} from "./eval/skeleton.js";
import { ReplaySystemOneProvider } from "./providers/replay.js";

const usage = (): never => {
  console.error(
    "Usage: mso eval <fixture.jsonl> [--out <evidence.json>] [--dataset <id>] [--provider replay]",
  );
  process.exit(2);
};

const optionValue = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args[0] !== "eval") {
    usage();
  }
  const fixturePath = args[1] ?? usage();
  const providerName = optionValue(args, "--provider") ?? "replay";
  if (providerName !== "replay") {
    throw new Error(`M0.0 only supports --provider replay; got ${providerName}`);
  }

  const cases = parseEvalJsonl(await readFile(fixturePath, "utf8"));
  const provider = new ReplaySystemOneProvider({
    records: replayRecordsFromCases(cases),
  });
  const datasetId = optionValue(args, "--dataset") ?? basename(fixturePath);
  const run = await runEval(provider, cases, { datasetId });
  const outPath = optionValue(args, "--out") ?? `evidence/eval/${run.runId}.json`;
  await writeEvalEvidence(outPath, run);

  const accuracy = (run.metrics.accuracy * 100).toFixed(1);
  console.log(
    `provider=${run.providerId} dataset=${run.datasetId} cases=${run.metrics.cases} accuracy=${accuracy}% errors=${run.metrics.providerErrors}`,
  );
  console.log(`evidence=${outPath}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});
