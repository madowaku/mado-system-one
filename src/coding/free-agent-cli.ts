#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  parseCodingQualificationInput,
  qualifyFreeCodingAgent,
} from "./free-agent-qualification.js";

const main = async (args: string[]): Promise<void> => {
  if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--out" || !args[1] || !args[3]) {
    throw new Error("Usage: npm run dm:free-qualify -- --input <runs.json> --out <evidence.json>");
  }
  const input = parseCodingQualificationInput(JSON.parse(await readFile(args[1], "utf8")) as unknown);
  const evidence = qualifyFreeCodingAgent(input);
  await mkdir(dirname(args[3]), { recursive: true });
  await writeFile(args[3], JSON.stringify(evidence, null, 2) + "\n", { flag: "w" });
  console.log("decision=" + evidence.decision +
    " live_pairs=" + evidence.eligibleLivePairs +
    " verified_passes=" + evidence.summary.candidateVerifiedPasses +
    " evidence=" + args[3]);
  // Evidence insufficiency/blockage is a measured result, not a CLI crash.
};

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
