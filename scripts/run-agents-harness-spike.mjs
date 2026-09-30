import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  AgentsRepoAuditHarness,
  MDD26_M0_3_THRIFT_MODEL,
  OpenAIAgentsHttpTransport,
  toHarnessBakeoffRecord,
  toManagedHarnessEvidence,
} from "../dist/src/index.js";

const apiKey = process.env.OPENAI_API_KEY;
const requestedModel = process.env.MADO_AGENTS_MODEL ?? MDD26_M0_3_THRIFT_MODEL;
const model = MDD26_M0_3_THRIFT_MODEL;

if (!apiKey) {
  console.error("OPENAI_API_KEY is required for the live Agents API spike.");
  process.exit(2);
}
if (requestedModel !== MDD26_M0_3_THRIFT_MODEL) {
  console.error(
    `MDD26-M0.3 thrift fixture is locked to ${MDD26_M0_3_THRIFT_MODEL}; received ${requestedModel}.`,
  );
  process.exit(2);
}

const repoRoot = process.cwd();
const maxTotalChars = Number(process.env.MADO_AGENTS_SNAPSHOT_MAX_CHARS ?? 12000);
const maxFileChars = Number(process.env.MADO_AGENTS_SNAPSHOT_FILE_CHARS ?? 3000);
const softBudgetUsd = Number(process.env.MADO_AGENTS_SOFT_BUDGET_USD ?? 0.05);

const fixedFiles = [
  "AGENTS.md",
  "package.json",
  "src/index.ts",
  "test/agents-harness.test.ts",
  "docs/devday-2026/MDD26-M0.3_AGENTS_HARNESS_SPIKE.md",
];

const candidates = fixedFiles;
let remaining = maxTotalChars;
const sections = [];

for (const relative of candidates) {
  if (remaining <= 0) break;
  const absolute = path.join(repoRoot, relative);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;

  const raw = fs.readFileSync(absolute, "utf8");
  const take = Math.min(raw.length, maxFileChars, remaining);
  const content = raw.slice(0, take);
  remaining -= take;

  sections.push(
    [
      `===== FILE: ${relative} =====`,
      content,
      take < raw.length ? "\n[TRUNCATED BY MDD26-M0.3 SNAPSHOT BUDGET]" : "",
    ].join("\n"),
  );
}

if (sections.length === 0) {
  console.error("No allowlisted repository files were available for the audit snapshot.");
  process.exit(2);
}

const snapshot = sections.join("\n\n");
const snapshotId =
  "sha256:" + createHash("sha256").update(snapshot).digest("hex");

const transport = new OpenAIAgentsHttpTransport({ apiKey });
const harness = new AgentsRepoAuditHarness(transport);

const startedAt = new Date().toISOString();
const run = await harness.run({
  model,
  snapshot,
  snapshotId,
  maxConcurrentSubagents: 2,
});
const finishedAt = new Date().toISOString();

const evidence = toManagedHarnessEvidence(run);

const lunaPricingSnapshot = {
  asOf: "2026-09-30",
  serviceTier: "default",
  inputPerMillion: 0.10,
  cachedInputPerMillion: 0.01,
  outputPerMillion: 0.50,
};

const usageCostEstimate = (() => {
  if (
    run.usage.inputTokens === undefined ||
    run.usage.outputTokens === undefined
  ) {
    return null;
  }
  const cached = Math.min(
    run.usage.cachedInputTokens ?? 0,
    run.usage.inputTokens,
  );
  const uncached = Math.max(0, run.usage.inputTokens - cached);
  return (
    (uncached / 1_000_000) * lunaPricingSnapshot.inputPerMillion +
    (cached / 1_000_000) * lunaPricingSnapshot.cachedInputPerMillion +
    (run.usage.outputTokens / 1_000_000) * lunaPricingSnapshot.outputPerMillion
  );
})();

const bakeoff = toHarnessBakeoffRecord(run, {
  runtime: "openai-agents-api-live",
  notes: [
    "Independent MADO Verification is still required.",
    "This thrift fixture records a dated Luna standard-price estimate only; billing dashboards remain authoritative.",
  ],
});

const full = {
  milestone: "MDD26-M0.3",
  startedAt,
  finishedAt,
  model,
  snapshot: {
    id: snapshotId,
    includedFiles: sections.length,
    characters: snapshot.length,
    policy: "allowlisted read-only text snapshot; .env and arbitrary filesystem paths are not read",
  },
  run,
  evidence,
  budget: {
    mode: "soft",
    targetUsd: softBudgetUsd,
    estimatedUsd: usageCostEstimate,
    exceeded:
      usageCostEstimate === null ? null : usageCostEstimate > softBudgetUsd,
    pricingSnapshot: lunaPricingSnapshot,
    caveat:
      "Soft budget only. Agents usage is best-effort and this is not an API-side hard spend cap.",
  },
  bakeoff: {
    ...bakeoff,
    estimatedCostUsd: usageCostEstimate,
  },
};

const summary = {
  milestone: full.milestone,
  startedAt,
  finishedAt,
  model,
  snapshot: full.snapshot,
  run: {
    sessionId: run.sessionId ?? null,
    terminalStatus: run.terminalStatus,
    subagentIds: run.subagentIds,
    usage: run.usage,
    evidenceRefCount: run.evidenceRefs.length,
    recovery: run.recovery,
  },
  evidence,
  budget: full.budget,
  bakeoff: full.bakeoff,
};

console.log(JSON.stringify(summary, null, 2));

if (full.budget.exceeded === true) {
  console.error(
    "WARN: estimated Luna usage $" +
      full.budget.estimatedUsd.toFixed(6) +
      " exceeded soft budget $" +
      softBudgetUsd.toFixed(2) +
      ".",
  );
}

const out = process.env.MADO_AGENTS_EVIDENCE_OUT;
if (out) {
  const absoluteOut = path.resolve(out);
  fs.mkdirSync(path.dirname(absoluteOut), { recursive: true });
  fs.writeFileSync(absoluteOut, JSON.stringify(full, null, 2) + "\n", "utf8");
  console.error(`Full M0.3 evidence written to ${absoluteOut}`);
}
