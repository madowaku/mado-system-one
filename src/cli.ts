#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { SystemOneProvider } from "./core/provider.js";
import {
  runComparison,
  writeComparisonEvidence,
} from "./eval/compare.js";
import {
  buildDisagreementLab,
  writeDisagreementLab,
} from "./eval/disagreement.js";
import {
  buildFineTunePack,
  writeFineTunePack,
} from "./finetune/candidate.js";
import {
  parseDisagreementQueueJsonl,
  parseFineTuneAnnotationsJsonl,
} from "./finetune/io.js";
import {
  parseEvalJsonl,
  replayRecordsFromCases,
  runEval,
  writeEvalEvidence,
  type EvalCase,
} from "./eval/skeleton.js";
import {
  evaluatePromotionGate,
  writePromotionGateEvidence,
} from "./promotion/gate.js";
import {
  parseEvalRun,
  parsePromotionControls,
  parsePromotionPolicy,
  parsePromotionReviewJsonl,
  parseShadowTraceJsonl,
} from "./promotion/io.js";
import { createLayaTsProvider } from "./providers/laya.js";
import { ReplaySystemOneProvider } from "./providers/replay.js";

const usage = (): never => {
  console.error(
    "Usage:\n" +
      "  mso eval <fixture.jsonl> [--provider replay|laya] [--out <evidence.json>] [--dataset <id>]\n" +
      "  mso compare <fixture.jsonl> [--providers replay,laya] [--out <comparison.json>] [--dataset <id>]\n" +
      "  mso disagreements <fixture.jsonl> [--providers replay,laya] [--pair replay:laya] [--focus laya] [--out <summary.json>] [--queue <review.jsonl>]\n" +
      "  mso promotion-check --policy <policy.json> --eval <eval.json> [--shadow <shadow.jsonl>] [--reviews <reviews.jsonl>] [--controls <controls.json>] [--out <gate.json>]\n" +
      "  mso finetune-pack --queue <disagreements.jsonl> --annotations <annotations.jsonl> --out-dir <dir> [--validation-fraction <0..0.5>] [--split-seed <text>]\n" +
      "Shared Laya options: [--model <name>] [--lang <code>] [--min-confidence <0..1>]\n" +
      "Compare options: [--score-tolerance <number>]\n" +
      "Disagreement option: [--high-confidence <0..1>]",
  );
  process.exit(2);
};

const optionValue = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const requiredOption = (args: readonly string[], name: string): string => {
  const value = optionValue(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
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

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8")) as unknown;

const createProvider = async (
  name: string,
  cases: readonly EvalCase[],
  args: readonly string[],
): Promise<SystemOneProvider> => {
  if (name === "replay") {
    return new ReplaySystemOneProvider({
      records: replayRecordsFromCases(cases),
    });
  }
  if (name === "laya") {
    const model = optionValue(args, "--model");
    const language = optionValue(args, "--lang");
    const minConfidence = numericOption(args, "--min-confidence");
    return createLayaTsProvider({
      ...(model ? { model } : {}),
      ...(language ? { language } : {}),
      ...(minConfidence === undefined ? {} : { minConfidence }),
    });
  }
  throw new Error(`unsupported provider: ${name}`);
};

const loadFixture = async (
  fixturePath: string,
): Promise<{ cases: EvalCase[]; datasetId: string }> => {
  const cases = parseEvalJsonl(await readFile(fixturePath, "utf8"));
  return { cases, datasetId: basename(fixturePath) };
};

const runPromotionCheck = async (args: readonly string[]): Promise<void> => {
  const policyPath = requiredOption(args, "--policy");
  const evalPath = requiredOption(args, "--eval");
  const shadowPath = optionValue(args, "--shadow");
  const reviewsPath = optionValue(args, "--reviews");
  const controlsPath = optionValue(args, "--controls");

  const policy = parsePromotionPolicy(await readJson(policyPath));
  const offlineRun = parseEvalRun(await readJson(evalPath));
  const shadowTraces = shadowPath
    ? parseShadowTraceJsonl(await readFile(shadowPath, "utf8"))
    : [];
  const reviews = reviewsPath
    ? parsePromotionReviewJsonl(await readFile(reviewsPath, "utf8"))
    : [];
  const controls = controlsPath
    ? parsePromotionControls(await readJson(controlsPath))
    : undefined;

  const evidence = evaluatePromotionGate({
    policy,
    offlineRun,
    shadowTraces,
    reviews,
    ...(controls ? { controls } : {}),
  });
  const outPath =
    optionValue(args, "--out") ??
    `evidence/promotion/${evidence.gateId}.json`;
  await writePromotionGateEvidence(outPath, evidence);

  console.log(
    `candidate=${evidence.candidateProviderId} surface=${evidence.decisionSurface} stage=${evidence.maxEligibleStage} action=${evidence.action}`,
  );
  for (const transition of evidence.transitions) {
    console.log(
      `transition=${transition.from}->${transition.to} status=${transition.status}`,
    );
  }
  console.log(`evidence=${outPath}`);
};

const runFineTunePack = async (args: readonly string[]): Promise<void> => {
  const queuePath = requiredOption(args, "--queue");
  const annotationsPath = requiredOption(args, "--annotations");
  const outDir = requiredOption(args, "--out-dir");
  const validationFraction = numericOption(args, "--validation-fraction");
  const splitSeed = optionValue(args, "--split-seed");

  const records = parseDisagreementQueueJsonl(
    await readFile(queuePath, "utf8"),
  );
  const annotations = parseFineTuneAnnotationsJsonl(
    await readFile(annotationsPath, "utf8"),
  );
  const pack = buildFineTunePack(records, annotations, {
    ...(validationFraction === undefined ? {} : { validationFraction }),
    ...(splitSeed ? { splitSeed } : {}),
  });
  await writeFineTunePack(outDir, pack);

  console.log(
    `pack=${pack.manifest.packId} ready_records=${pack.manifest.counts.trainingReadyRecords} held=${pack.manifest.counts.heldRecords} train_cases=${pack.manifest.counts.trainCases} validation_cases=${pack.manifest.counts.validationCases}`,
  );
  console.log(`out_dir=${outDir}`);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "promotion-check") {
    await runPromotionCheck(args);
    return;
  }

  if (command === "finetune-pack") {
    await runFineTunePack(args);
    return;
  }

  const fixturePath = args[1] ?? usage();
  const loaded = await loadFixture(fixturePath);
  const datasetId = optionValue(args, "--dataset") ?? loaded.datasetId;

  if (command === "eval") {
    const providerName = optionValue(args, "--provider") ?? "replay";
    const provider = await createProvider(providerName, loaded.cases, args);
    const run = await runEval(provider, loaded.cases, { datasetId });
    const outPath = optionValue(args, "--out") ?? `evidence/eval/${run.runId}.json`;
    await writeEvalEvidence(outPath, run);

    const accuracy = (run.metrics.accuracy * 100).toFixed(1);
    console.log(
      `provider=${run.providerId} dataset=${run.datasetId} cases=${run.metrics.cases} accuracy=${accuracy}% errors=${run.metrics.providerErrors}`,
    );
    console.log(`evidence=${outPath}`);
    return;
  }

  if (command === "disagreements") {
    const providerNames = (optionValue(args, "--providers") ?? "replay,laya")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (providerNames.length < 2) {
      throw new Error("--providers requires at least two comma-separated providers");
    }

    const pairRaw =
      optionValue(args, "--pair") ?? `${providerNames[0]}:${providerNames[1]}`;
    const pairParts = pairRaw.split(":").map((item) => item.trim()).filter(Boolean);
    const leftProvider = pairParts[0];
    const rightProvider = pairParts[1];
    if (!leftProvider || !rightProvider || pairParts.length !== 2) {
      throw new Error("--pair must be formatted as left:right");
    }

    const providers: SystemOneProvider[] = [];
    for (const name of providerNames) {
      providers.push(await createProvider(name, loaded.cases, args));
    }

    const scoreAgreementTolerance = numericOption(args, "--score-tolerance");
    const evidence = await runComparison(providers, loaded.cases, {
      datasetId,
      ...(scoreAgreementTolerance === undefined
        ? {}
        : { scoreAgreementTolerance }),
    });

    const focusProvider = optionValue(args, "--focus") ?? rightProvider;
    const highConfidenceThreshold = numericOption(args, "--high-confidence");
    const lab = buildDisagreementLab(evidence, loaded.cases, {
      leftProvider,
      rightProvider,
      focusProvider,
      ...(highConfidenceThreshold === undefined
        ? {}
        : { highConfidenceThreshold }),
    });

    const summaryPath =
      optionValue(args, "--out") ??
      `evidence/disagreements/${lab.labId}.json`;
    const queuePath =
      optionValue(args, "--queue") ??
      `evidence/disagreements/${lab.labId}.jsonl`;
    await writeDisagreementLab(summaryPath, queuePath, lab);

    console.log(
      `pair=${leftProvider}:${rightProvider} focus=${focusProvider} disagreements=${lab.summary.total} p0=${lab.summary.byPriority.p0} p1=${lab.summary.byPriority.p1} p2=${lab.summary.byPriority.p2} p3=${lab.summary.byPriority.p3}`,
    );
    console.log(`summary=${summaryPath}`);
    console.log(`queue=${queuePath}`);
    return;
  }

  if (command === "compare") {
    const providerNames = (optionValue(args, "--providers") ?? "replay,laya")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (providerNames.length < 2) {
      throw new Error("--providers requires at least two comma-separated providers");
    }

    const providers: SystemOneProvider[] = [];
    for (const name of providerNames) {
      providers.push(await createProvider(name, loaded.cases, args));
    }

    const scoreAgreementTolerance = numericOption(args, "--score-tolerance");
    const evidence = await runComparison(providers, loaded.cases, {
      datasetId,
      ...(scoreAgreementTolerance === undefined
        ? {}
        : { scoreAgreementTolerance }),
    });
    const outPath =
      optionValue(args, "--out") ??
      `evidence/compare/${evidence.comparisonId}.json`;
    await writeComparisonEvidence(outPath, evidence);

    for (const pair of evidence.pairs) {
      console.log(
        `pair=${pair.left}:${pair.right} comparable=${pair.comparableQuestions} agreement=${(pair.agreementRate * 100).toFixed(1)}% disagreements=${pair.disagreements} left_only_correct=${pair.leftOnlyCorrect} right_only_correct=${pair.rightOnlyCorrect}`,
      );
    }
    console.log(`evidence=${outPath}`);
    return;
  }

  usage();
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});
