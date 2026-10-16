#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseMultiFreeBakeoffInput, runMultiFreeBakeoff } from "./multi-free-bakeoff.js";

async function main(args: string[]): Promise<void> {
  if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--out" || !args[1] || !args[3]) {
    throw new Error("Usage: npm run dm:multi-free-bakeoff -- --input <manifest.json> --out <evidence.json>");
  }
  const input = parseMultiFreeBakeoffInput(JSON.parse(await readFile(args[1], "utf8")) as unknown);
  const result = runMultiFreeBakeoff(input);
  await mkdir(dirname(args[3]), { recursive: true });
  await writeFile(args[3], JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log("decision=" + result.decision + " complete=" + result.completeCohortCases +
    " live=" + result.eligibleLiveCohortCases + " missing=" + result.missingRuns.length);
  for (const resultCandidate of result.candidates) {
    console.log("candidate=" + resultCandidate.candidateId + " decision=" + resultCandidate.decision +
      " pass_rate=" + (resultCandidate.summary.candidatePassRate ?? "n/a"));
  }
  console.log("evidence=" + args[3]);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
