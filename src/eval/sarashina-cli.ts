import { readJapaneseRetrievalFixture, runJapaneseRetrievalBenchmark, writeJapaneseRetrievalEvidence, type RetrievalMode } from "./sarashina-ja.js";
import { SarashinaApiProvider } from "../providers/sarashina.js";

const usage = "Usage: npm run sarashina:ja -- <fixture.jsonl> --dataset <id> --out <evidence.json> [--mode lexical|embedding|embedding-rerank --live]";
const arg = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
export const runSarashinaCli = async (args: string[]): Promise<void> => {
  const fixturePath = args[0];
  const out = arg(args, "--out");
  const datasetId = arg(args, "--dataset");
  const mode = (arg(args, "--mode") ?? "lexical") as RetrievalMode;
  if (!fixturePath || fixturePath.startsWith("--") || !out || !datasetId ||
    !["lexical", "embedding", "embedding-rerank"].includes(mode)) {
    throw new Error(usage);
  }
  if (mode !== "lexical" && !args.includes("--live")) {
    throw new Error("remote evaluation requires explicit --live consent");
  }
  if (args.includes("--live") && mode === "lexical") {
    throw new Error("lexical-only mode must not request live API access");
  }
  const apiKey = process.env.SARASHINA_API_KEY;
  if (mode !== "lexical" && !apiKey) {
    throw new Error("SARASHINA_API_KEY is required for live evaluation");
  }
  const fixture = await readJapaneseRetrievalFixture(fixturePath, datasetId);
  const provider = apiKey && mode !== "lexical" ? new SarashinaApiProvider({ apiKey }) : undefined;
  const evidence = await runJapaneseRetrievalBenchmark(fixture, { mode, ...(provider ? { provider } : {}) });
  await writeJapaneseRetrievalEvidence(out, evidence);
  // Only non-sensitive summaries, no document text, query text or credentials.
  process.stdout.write(JSON.stringify({ datasetId, mode, metrics: evidence.metrics, out }, null, 2) + "\n");
};
if (process.argv[1] && /sarashina-cli\.[cm]?js$/.test(process.argv[1])) {
  runSarashinaCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write((error instanceof Error ? error.message : "unknown error") + "\n");
    process.exitCode = 1;
  });
}
