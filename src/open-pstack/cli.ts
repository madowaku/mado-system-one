#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluatePstackGate } from "./intake.js";

const [inputPath, outputPath, ...rest] = process.argv.slice(2);
if (!inputPath || !outputPath || rest.length !== 0 ||
    resolve(inputPath) === resolve(outputPath)) {
  console.error(
    "Usage: node dist/src/open-pstack/cli.js <trial.json> <new-outcome.json>",
  );
  process.exitCode = 2;
} else {
  try {
    const input: unknown = JSON.parse(await readFile(inputPath, "utf8"));
    const evidence = evaluatePstackGate(input);
    // Fail closed on existing destinations. Never overwrite source, history,
    // global Codex/Claude configuration, or other application state.
    await writeFile(outputPath, JSON.stringify(evidence, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(`${evidence.decision}: ${evidence.trialId} (advisory only)`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
