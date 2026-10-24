#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { evaluateHarnessLab, parseHarnessLabInput } from "./ecc-lab.js";

const usage = "Usage: node dist/src/harness/ecc-lab-cli.js <input.json> [--out <evidence.json>]";

async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 1 && args.length !== 3) throw new Error(usage);
  const path = args[0];
  if (!path) throw new Error(usage);
  let out: string | undefined;
  if (args.length === 3) {
    if (args[1] !== "--out" || !args[2]) throw new Error(usage);
    out = args[2];
  }
  const input = parseHarnessLabInput(JSON.parse(await readFile(path, "utf8")) as unknown);
  const report = evaluateHarnessLab(input);
  const encoded = JSON.stringify(report, null, 2) + "\n";
  if (out) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, encoded, { flag: "w" });
  } else {
    process.stdout.write(encoded);
  }
  // A HOLD/REJECT is a valid diagnostic; callers must inspect report.gate.
  // Malformed/unreadable input returns nonzero rather than silently passing.
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
