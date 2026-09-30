import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  AgentsRepoAuditHarness,
  OpenAIAgentsHttpTransport,
  toHarnessBakeoffRecord,
  toManagedHarnessEvidence,
} from "../dist/src/index.js";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.MADO_AGENTS_MODEL;

if (!apiKey) {
  console.error("OPENAI_API_KEY is required for the live Agents API spike.");
  process.exit(2);
}
if (!model) {
  console.error("MADO_AGENTS_MODEL is required. Choose the model explicitly for this bake-off.");
  process.exit(2);
}

const repoRoot = process.cwd();
const maxTotalChars = Number(process.env.MADO_AGENTS_SNAPSHOT_MAX_CHARS ?? 70000);
const maxFileChars = Number(process.env.MADO_AGENTS_SNAPSHOT_FILE_CHARS ?? 12000);

const fixedFiles = [
  "README.md",
  "AGENTS.md",
  "package.json",
  "src/index.ts",
  "docs/MADO_SYSTEM_ONE_ARCHITECTURE.md",
  "docs/MADO_SYSTEM_ONE_OPERATIONS.md",
  "docs/MADO_MULTI_AGENT_FORGE_SPEC.md",
  "docs/devday-2026/MDD26-M0.2_EVENT_SPINE.md",
];

const testDir = path.join(repoRoot, "test");
const testFiles = fs.existsSync(testDir)
  ? fs
      .readdirSync(testDir)
      .filter((name) => name.endsWith(".test.ts"))
      .sort()
      .map((name) => `test/${name}`)
  : [];

const candidates = [...fixedFiles, ...testFiles];
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
  maxConcurrentSubagents: 3,
});
const finishedAt = new Date().toISOString();

const evidence = toManagedHarnessEvidence(run);
const bakeoff = toHarnessBakeoffRecord(run, {
  runtime: "openai-agents-api-live",
  notes: [
    "Independent MADO Verification is still required.",
    "Apply current model/tool/container prices externally; the repository does not hard-code price tables.",
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
  bakeoff,
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
  bakeoff,
};

console.log(JSON.stringify(summary, null, 2));

const out = process.env.MADO_AGENTS_EVIDENCE_OUT;
if (out) {
  const absoluteOut = path.resolve(out);
  fs.mkdirSync(path.dirname(absoluteOut), { recursive: true });
  fs.writeFileSync(absoluteOut, JSON.stringify(full, null, 2) + "\n", "utf8");
  console.error(`Full M0.3 evidence written to ${absoluteOut}`);
}
