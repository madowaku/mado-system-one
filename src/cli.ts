#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  parseEvalJsonl,
  replayRecordsFromCases,
  runEval,
  writeEvalEvidence,
} from "./eval/skeleton.js";
import { createLayaTsProvider } from "./providers/laya.js";
import { ReplaySystemOneProvider } from "./providers/replay.js";

const usage = (): never => {
  console.error(
    "Usage: mso eval <fixture.jsonl> [--out <evidence.json>] [--dataset <id>] [--provider replay|laya] [--model <name>] [--lang <code>] [--min-confidence <0..1>]",
  );
  process.exit(2);
};

const optionValue = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const numericOption = (args: readonly string[], name: string): number | undefined => {
  const raw = optionValue(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be numeric`);
  }
  return value;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args[0] !== "eval") {
    usage();
  }
  const fixturePath = args[1] ?? usage();
  const providerName = optionValue(args, "--provider") ?? "replay";
  const cases = parseEvalJsonl(await readFile(fixturePath, "utf8"));

  const provider =
    providerName === "replay"
      ? new ReplaySystemOneProvider({ records: replayRecordsFromCases(cases) })
      : providerName === "laya"
        ? await createLayaTsProvider({
            ...(optionValue(args, "--model")
              ? { model: optionValue(args, "--model") }
              : {}),
            ...(optionValue(args, "--lang")
              ? { language: optionValue(args, "--lang") }
              : {}),
            ...(numericOption(args, "--min-confidence") === undefined
              ? {}
              : { minConfidence: numericOption(args, "--min-confidence") }),
          })
        : (() => {
            throw new Error(`unsupported provider: ${providerName}`);
          })();

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
