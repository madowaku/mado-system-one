#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { SystemOneProvider } from "./core/provider.js";
import type { SystemOnePattern } from "./core/types.js";
import {
  assertCanaryPolicyAgainstRegistry,
  buildCanaryActivationPolicy,
  evaluateCanaryAdvance,
  summarizeCanaryTraces,
  type CanaryStage,
} from "./activation/canary.js";
import {
  parseCanaryAdvancePolicy,
  parseCanaryTraceJsonl,
  readCanaryActivationPolicy,
  readCanaryAdvanceEvidence,
  writeCanaryActivationPolicy,
  writeCanaryAdvanceEvidence,
} from "./activation/io.js";
import {
  runCanaryRollbackDrill,
  writeCanaryRollbackDrill,
} from "./activation/drill.js";
import {
  buildActiveLimitedDriftPolicy,
  evaluateDriftWindow,
} from "./activation/drift.js";
import {
  readActiveLimitedDriftPolicy,
  writeActiveLimitedDriftPolicy,
  writeDriftWindowEvidence,
} from "./activation/drift_io.js";
import { evaluateHoldRequalification } from "./activation/recovery.js";
import {
  readDriftHoldEvent,
  readHoldRecoveryCase,
  writeHoldRequalificationResult,
} from "./activation/recovery_io.js";
import {
  acceptWorkloadRebaseline,
  buildWorkloadRebaselineCandidate,
} from "./activation/rebaseline.js";
import {
  readWorkloadRebaselineAcceptanceEvidence,
  readWorkloadRebaselineAcceptanceReview,
  readWorkloadRebaselineCandidateEvidence,
  readWorkloadRebaselineReview,
  writeWorkloadRebaselineAcceptanceResult,
  writeWorkloadRebaselineCandidateResult,
} from "./activation/rebaseline_io.js";
import {
  runComparison,
  writeComparisonEvidence,
} from "./eval/compare.js";
import {
  parseShadowBakeoffPolicy,
  runCrossProviderBakeoff,
  writeCrossProviderBakeoffEvidence,
} from "./eval/bakeoff.js";
import {
  buildDisagreementLab,
  writeDisagreementLab,
} from "./eval/disagreement.js";
import {
  buildFineTunePack,
  writeFineTunePack,
} from "./finetune/candidate.js";
import {
  fingerprintLayaOnnxCheckpoint,
} from "./reeval/checkpoint.js";
import {
  parseFineTuneValidationJsonl,
  runCandidateReeval,
  writeCandidateReevalArtifacts,
} from "./reeval/candidate.js";
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
import {
  createLayaCheckpointProvider,
  createLayaTsProvider,
} from "./providers/laya.js";
import { createCloudflareClefProvider } from "./providers/clef.js";
import { ReplaySystemOneProvider } from "./providers/replay.js";
import {
  appendLineageEvent,
  assertPromotionEvidence,
  createCheckpointLineageRegistry,
  deriveLineageState,
  planRollback,
  recordRollback,
} from "./lineage/registry.js";
import {
  bindCheckpointToDistributionEpoch,
  createBaselineLineageRegistry,
  deriveBaselineLineageState,
  registerInitialDistributionEpoch,
  registerRebaselineDistributionEpoch,
} from "./baseline/registry.js";
import {
  createBaselineLineageRegistryFile,
  mutateBaselineLineageRegistry,
  readBaselineLineageRegistry,
} from "./baseline/io.js";
import {
  createCheckpointLineageRegistryFile,
  mutateCheckpointLineageRegistry,
  parseCandidateReevalEvidence,
  parsePromotionGateEvidence,
  parseRollbackPlan,
  readCheckpointLineageRegistry,
  writeRollbackPlan,
} from "./lineage/io.js";

const usage = (): never => {
  console.error(
    "Usage:\n" +
      "  mso eval <fixture.jsonl> [--provider replay|laya|clef|clef-flash] [--out <evidence.json>] [--dataset <id>]\n" +
      "  mso compare <fixture.jsonl> [--providers replay,laya,clef-flash] [--out <comparison.json>] [--dataset <id>]\n" +
      "  mso dm-bakeoff <fixture.jsonl> --providers <csv> --incumbent <provider-id> --policy <policy.json> [--out <evidence.json>] [--dataset <id>]\n" +
      "  mso disagreements <fixture.jsonl> [--providers replay,laya,clef-flash] [--pair laya:clef-flash] [--focus clef-flash] [--out <summary.json>] [--queue <review.jsonl>]\n" +
      "  mso promotion-check --policy <policy.json> --eval <eval.json> [--shadow <shadow.jsonl>] [--reviews <reviews.jsonl>] [--controls <controls.json>] [--out <gate.json>]\n" +
      "  mso finetune-pack --queue <disagreements.jsonl> --annotations <annotations.jsonl> --out-dir <dir> [--validation-fraction <0..0.5>] [--split-seed <text>]\n" +
      "  mso candidate-reeval --validation <validation.jsonl> --base-checkpoint <onnx-dir> --candidate-checkpoint <onnx-dir> --out-dir <dir> [--model english|multilingual|typed-decisions] [--incumbent-eval <eval.json>]\n" +
      "  mso lineage-init --registry <registry.json> --registry-id <id> --surface <decision-surface>\n" +
      "  mso lineage-register --registry <registry.json> --checkpoint-id <id> --checkpoint-dir <onnx-dir> [--ref <name>] [--origin base|fine_tune|imported] [--parent <id>] [--known-good --known-good-ref <evidence-ref>] [--reeval <summary.json>] [--pack-ref <ref>]\n" +
      "  mso lineage-promote --registry <registry.json> --checkpoint-id <id> --gate <gate.json> --reeval <summary.json> --rollback-target <id>\n" +
      "  mso lineage-set-rollback-safety --registry <registry.json> --checkpoint-id <id> --eligible <true|false> --evidence-ref <ref> --reason <text>\n" +
      "  mso rollback-plan --registry <registry.json> --to <checkpoint-id> --reason <text> --out <plan.json> [--from <checkpoint-id>]\n" +
      "  mso lineage-record-rollback --registry <registry.json> --plan <plan.json> --execution-ref <ref>\n" +
      "  mso lineage-show --registry <registry.json>\n" +
      "  mso canary-plan --registry <registry.json> --policy-id <id> --candidate-provider <id> --incumbent-provider <id> --stage <off|canary_1|canary_5|canary_25|limited_active> --patterns <csv> --max-consecutive-errors <n> --min-error-rate-attempts <n> --max-error-rate <0..1> --out <policy.json>\n" +
      "  mso canary-evaluate --policy <policy.json> --traces <traces.jsonl> --advance-policy <policy.json> --out <advance.json>\n" +
      "  mso canary-drill --registry <registry.json> --out-dir <dir> [--rollback-target <checkpoint-id>]\n" +
      "  mso drift-plan --activation-policy <limited-active-policy.json> --baseline-policy <canary-policy.json> --baseline-traces <traces.jsonl> --policy-id <id> --window-size <n> --min-selected <n> --min-comparable <n> --min-confidence-samples <n> --max-candidate-error <0..1> --max-incumbent-error <0..1> --max-fallback <0..1> --max-disagreement <0..1> --max-latency-ratio <n> --max-confidence-delta <0..1> --out <policy.json>\n" +
      "  mso drift-evaluate --activation-policy <limited-active-policy.json> --drift-policy <policy.json> --traces <traces.jsonl> --out <evidence.json>\n" +
      "  mso hold-requalify --registry <registry.json> --activation-policy <held-policy.json> --drift-policy <drift-policy.json> --hold <hold.json> --recovery <recovery.json> --recovery-traces <traces.jsonl> --new-policy-id <id> --out-dir <dir>\n" +
      "  mso rebaseline-plan --registry <registry.json> --activation-policy <held-policy.json> --drift-policy <drift-policy.json> --hold <hold.json> --recovery <recovery.json> --candidate-traces <traces.jsonl> --review <review.json> --new-policy-id <id> --min-selected <n> --min-comparable <n> --min-confidence-samples <n> --max-candidate-error <0..1> --max-incumbent-error <0..1> --max-fallback <0..1> --max-latency-ratio <n> --out-dir <dir>\n" +
      "  mso baseline-lineage-init --registry <registry.json> --registry-id <id> --surface <decision-surface>\n" +
      "  mso baseline-register-initial --registry <baseline-registry.json> --checkpoint-registry <checkpoint-registry.json> --activation-policy <limited-active-policy.json> --drift-policy <drift-policy.json> --epoch-id <id> --distribution-summary <text> --source-evidence-ref <ref> --binding-evidence-ref <ref>\n" +
      "  mso baseline-register-rebaseline --registry <baseline-registry.json> --checkpoint-registry <checkpoint-registry.json> --acceptance <rebaseline.acceptance.json> --activation-policy <limited-active-policy.json> --drift-policy <drift-policy.json> --epoch-id <id> --binding-evidence-ref <ref>\n" +
      "  mso baseline-bind-checkpoint --registry <baseline-registry.json> --checkpoint-registry <checkpoint-registry.json> --activation-policy <limited-active-policy.json> --drift-policy <drift-policy.json> --evidence-ref <ref> [--epoch-id <id>]\n" +
      "  mso baseline-show --registry <baseline-registry.json>\n" +
      "  mso rebaseline-accept --registry <registry.json> --candidate <rebaseline.candidate.json> --canary-1-policy <policy.json> --canary-1-advance <advance.json> --canary-5-policy <policy.json> --canary-5-advance <advance.json> --canary-25-policy <policy.json> --canary-25-advance <advance.json> --review <acceptance-review.json> --limited-active-policy-id <id> --drift-policy-id <id> --window-size <n> --min-selected <n> --min-comparable <n> --min-confidence-samples <n> --max-candidate-error <0..1> --max-incumbent-error <0..1> --max-fallback <0..1> --max-disagreement <0..1> --max-latency-ratio <n> --max-confidence-delta <0..1> --out-dir <dir>\n" +
      "Shared Laya options: [--model <name>] [--lang <code>] [--min-confidence <0..1>]\n" +
      "Cloudflare Clef env: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AUTH_TOKEN\n" +
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
  if (name === "clef" || name === "clef-flash") {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_AUTH_TOKEN;
    if (!accountId || !apiToken) {
      throw new Error(
        `${name} requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_TOKEN`,
      );
    }
    return createCloudflareClefProvider({
      accountId,
      apiToken,
      model: name,
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


const checkpointModel = (
  args: readonly string[],
): "english" | "multilingual" | "typed-decisions" => {
  const model = optionValue(args, "--model") ?? "english";
  if (
    model !== "english" &&
    model !== "multilingual" &&
    model !== "typed-decisions"
  ) {
    throw new Error("--model must be english|multilingual|typed-decisions");
  }
  return model;
};

const runCandidateReevalCli = async (
  args: readonly string[],
): Promise<void> => {
  const validationPath = requiredOption(args, "--validation");
  const baseCheckpointDir = requiredOption(args, "--base-checkpoint");
  const candidateCheckpointDir = requiredOption(args, "--candidate-checkpoint");
  const outDir = requiredOption(args, "--out-dir");
  const model = checkpointModel(args);
  const language = optionValue(args, "--lang");
  const device = optionValue(args, "--device");
  const baseId = optionValue(args, "--base-id") ?? "laya-base";
  const candidateId = optionValue(args, "--candidate-id") ?? "laya-candidate";
  const baseRef = optionValue(args, "--base-ref") ?? basename(baseCheckpointDir);
  const candidateRef =
    optionValue(args, "--candidate-ref") ?? basename(candidateCheckpointDir);
  const datasetId =
    optionValue(args, "--dataset") ?? basename(validationPath);

  const cases = parseFineTuneValidationJsonl(
    await readFile(validationPath, "utf8"),
  );
  const [baseCheckpoint, candidateCheckpoint] = await Promise.all([
    fingerprintLayaOnnxCheckpoint(baseCheckpointDir, baseRef),
    fingerprintLayaOnnxCheckpoint(candidateCheckpointDir, candidateRef),
  ]);

  const baseProvider = await createLayaCheckpointProvider({
    id: baseId,
    checkpointDir: baseCheckpointDir,
    model,
    ...(language ? { language } : {}),
    ...(device ? { device } : {}),
  });
  const candidateProvider = await createLayaCheckpointProvider({
    id: candidateId,
    checkpointDir: candidateCheckpointDir,
    model,
    ...(language ? { language } : {}),
    ...(device ? { device } : {}),
  });

  const incumbentPath = optionValue(args, "--incumbent-eval");
  const incumbentRun = incumbentPath
    ? parseEvalRun(await readJson(incumbentPath))
    : undefined;

  const result = await runCandidateReeval(
    cases,
    baseProvider,
    candidateProvider,
    {
      datasetId,
      baseCheckpoint,
      candidateCheckpoint,
      ...(incumbentRun ? { incumbentRun } : {}),
    },
  );
  await writeCandidateReevalArtifacts(outDir, result);

  const delta = result.evidence.deltas.candidateVsBase;
  console.log(
    `reeval=${result.evidence.reevalId} candidate=${candidateId} accuracy_delta=${delta.accuracy.toFixed(4)} regressions=${result.evidence.regressionCount} improvements=${result.evidence.improvementCount}`,
  );
  console.log(
    `candidate_eval=${outDir}/candidate.eval.json promotion_input=yes`,
  );
  console.log(`summary=${outDir}/summary.json`);
};


const flag = (args: readonly string[], name: string): boolean =>
  args.includes(name);

const lineageOrigin = (
  args: readonly string[],
): "base" | "fine_tune" | "imported" => {
  const value = optionValue(args, "--origin") ?? "imported";
  if (value !== "base" && value !== "fine_tune" && value !== "imported") {
    throw new Error("--origin must be base|fine_tune|imported");
  }
  return value;
};

const runLineageInit = async (args: readonly string[]): Promise<void> => {
  const registryPath = requiredOption(args, "--registry");
  const registry = createCheckpointLineageRegistry(
    requiredOption(args, "--registry-id"),
    requiredOption(args, "--surface"),
  );
  await createCheckpointLineageRegistryFile(registryPath, registry);
  console.log(
    `registry=${registry.registryId} surface=${registry.decisionSurface} events=0`,
  );
  console.log(`path=${registryPath}`);
};

const runLineageRegister = async (args: readonly string[]): Promise<void> => {
  const registryPath = requiredOption(args, "--registry");
  const checkpointId = requiredOption(args, "--checkpoint-id");
  const checkpointDir = requiredOption(args, "--checkpoint-dir");
  const checkpointRef = optionValue(args, "--ref") ?? basename(checkpointDir);
  const parentCheckpointId = optionValue(args, "--parent");
  const origin = lineageOrigin(args);
  const fineTunePackRef = optionValue(args, "--pack-ref");
  const reevalPath = optionValue(args, "--reeval");
  const knownGood = flag(args, "--known-good");
  const knownGoodEvidenceRef = optionValue(args, "--known-good-ref");
  if (knownGood && !knownGoodEvidenceRef) {
    throw new Error("--known-good requires --known-good-ref");
  }
  const checkpoint = await fingerprintLayaOnnxCheckpoint(
    checkpointDir,
    checkpointRef,
  );
  const reeval = reevalPath
    ? parseCandidateReevalEvidence(await readJson(reevalPath))
    : undefined;

  const next = await mutateCheckpointLineageRegistry(
    registryPath,
    (registry) => {
      const state = deriveLineageState(registry);
      if (reeval) {
        if (
          reeval.candidateCheckpoint.fingerprint !== checkpoint.fingerprint
        ) {
          throw new Error(
            "re-eval candidate fingerprint does not match checkpoint being registered",
          );
        }
        if (parentCheckpointId) {
          const parent = state.checkpoints[parentCheckpointId];
          if (!parent) {
            throw new Error(
              `parent checkpoint is not registered: ${parentCheckpointId}`,
            );
          }
          if (
            reeval.baseCheckpoint.fingerprint !==
            parent.checkpoint.fingerprint
          ) {
            throw new Error(
              "re-eval base fingerprint does not match registered parent checkpoint",
            );
          }
        }
      }

      return appendLineageEvent(registry, {
        type: "checkpoint_registered",
        data: {
          checkpointId,
          checkpoint,
          origin,
          knownGood,
          ...(knownGoodEvidenceRef ? { knownGoodEvidenceRef } : {}),
          ...(parentCheckpointId ? { parentCheckpointId } : {}),
          ...(fineTunePackRef ? { fineTunePackRef } : {}),
          ...(reevalPath ? { reevalEvidenceRef: reevalPath } : {}),
          ...(reeval ? { reevalId: reeval.reevalId } : {}),
        },
      });
    },
  );
  const state = deriveLineageState(next);
  console.log(
    `registered=${checkpointId} fingerprint=${checkpoint.fingerprint} known_good=${knownGood}`,
  );
  console.log(
    `events=${state.eventCount} head_hash=${state.headEventHash ?? "none"}`,
  );
};

const runLineagePromote = async (args: readonly string[]): Promise<void> => {
  const registryPath = requiredOption(args, "--registry");
  const checkpointId = requiredOption(args, "--checkpoint-id");
  const gatePath = requiredOption(args, "--gate");
  const reevalPath = requiredOption(args, "--reeval");
  const rollbackTargetId = requiredOption(args, "--rollback-target");
  const gate = parsePromotionGateEvidence(await readJson(gatePath));
  const reeval = parseCandidateReevalEvidence(await readJson(reevalPath));

  const next = await mutateCheckpointLineageRegistry(
    registryPath,
    (registry) => {
      assertPromotionEvidence(registry, checkpointId, gate, reeval);
      return appendLineageEvent(registry, {
        type: "promotion_recorded",
        data: {
          checkpointId,
          gateId: gate.gateId,
          gateEvidenceRef: gatePath,
          reevalId: reeval.reevalId,
          reevalEvidenceRef: reevalPath,
          rollbackTargetId,
        },
      });
    },
  );
  const state = deriveLineageState(next);
  console.log(
    `promoted=${checkpointId} recorded_head=${state.recordedHeadCheckpointId ?? "none"} rollback_target=${rollbackTargetId}`,
  );
  console.log(
    "runtime_authority_changed=false action=registry_evidence_only",
  );
};


const booleanOption = (
  args: readonly string[],
  name: string,
): boolean => {
  const raw = requiredOption(args, name);
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true|false`);
};

const runLineageSetRollbackSafety = async (
  args: readonly string[],
): Promise<void> => {
  const registryPath = requiredOption(args, "--registry");
  const checkpointId = requiredOption(args, "--checkpoint-id");
  const eligible = booleanOption(args, "--eligible");
  const evidenceRef = requiredOption(args, "--evidence-ref");
  const reason = requiredOption(args, "--reason");

  const next = await mutateCheckpointLineageRegistry(
    registryPath,
    (registry) =>
      appendLineageEvent(registry, {
        type: "rollback_safety_set",
        data: {
          checkpointId,
          eligible,
          evidenceRef,
          reason,
        },
      }),
  );
  const state = deriveLineageState(next);
  const checkpoint = state.checkpoints[checkpointId];
  console.log(
    `checkpoint=${checkpointId} rollback_eligible=${checkpoint?.knownGood ?? false} evidence_ref=${checkpoint?.knownGoodEvidenceRef ?? "none"}`,
  );
};

const runRollbackPlanCli = async (args: readonly string[]): Promise<void> => {
  const registryPath = requiredOption(args, "--registry");
  const outPath = requiredOption(args, "--out");
  const registry = await readCheckpointLineageRegistry(registryPath);
  const fromCheckpointId = optionValue(args, "--from");
  const plan = planRollback(
    registry,
    requiredOption(args, "--to"),
    {
      reason: requiredOption(args, "--reason"),
      ...(fromCheckpointId ? { fromCheckpointId } : {}),
    },
  );
  await writeRollbackPlan(outPath, plan);
  console.log(
    `plan=${plan.planId} from=${plan.fromCheckpointId} to=${plan.toCheckpointId} steps=${plan.path.join("->")}`,
  );
  console.log(
    "automatic_execution=false runtime_authority_changed=false",
  );
  console.log(`out=${outPath}`);
};

const runLineageRecordRollback = async (
  args: readonly string[],
): Promise<void> => {
  const registryPath = requiredOption(args, "--registry");
  const planPath = requiredOption(args, "--plan");
  const executionRef = requiredOption(args, "--execution-ref");
  const plan = parseRollbackPlan(await readJson(planPath));
  const next = await mutateCheckpointLineageRegistry(
    registryPath,
    (registry) => recordRollback(registry, plan, executionRef),
  );
  const state = deriveLineageState(next);
  console.log(
    `rollback_recorded=${plan.planId} recorded_head=${state.recordedHeadCheckpointId ?? "none"} execution_ref=${executionRef}`,
  );
  console.log("registry_record_only=true");
};

const runLineageShow = async (args: readonly string[]): Promise<void> => {
  const registry = await readCheckpointLineageRegistry(
    requiredOption(args, "--registry"),
  );
  console.log(JSON.stringify(deriveLineageState(registry), null, 2));
};


const requiredNumberOption = (
  args: readonly string[],
  name: string,
): number => {
  const value = Number(requiredOption(args, name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  return value;
};

const canaryStageOption = (
  args: readonly string[],
): CanaryStage => {
  const value = requiredOption(args, "--stage");
  if (
    value !== "off" &&
    value !== "canary_1" &&
    value !== "canary_5" &&
    value !== "canary_25" &&
    value !== "limited_active"
  ) {
    throw new Error(
      "--stage must be off|canary_1|canary_5|canary_25|limited_active",
    );
  }
  return value;
};

const canaryPatternsOption = (
  args: readonly string[],
): SystemOnePattern[] => {
  const allowed = new Set<SystemOnePattern>([
    "route",
    "compute",
    "rank",
    "gate",
    "act",
    "score",
    "abstain",
    "sieve",
    "walk",
    "verify",
  ]);
  const values = requiredOption(args, "--patterns")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error("--patterns must be non-empty");
  for (const value of values) {
    if (!allowed.has(value as SystemOnePattern)) {
      throw new Error(`unsupported canary pattern: ${value}`);
    }
  }
  return values as SystemOnePattern[];
};

const runCanaryPlan = async (args: readonly string[]): Promise<void> => {
  const registryPath = requiredOption(args, "--registry");
  const outPath = requiredOption(args, "--out");
  const registry = await readCheckpointLineageRegistry(registryPath);
  const policy = buildCanaryActivationPolicy(registry, {
    policyId: requiredOption(args, "--policy-id"),
    candidateProviderId: requiredOption(args, "--candidate-provider"),
    incumbentProviderId: requiredOption(args, "--incumbent-provider"),
    stage: canaryStageOption(args),
    allowedPatterns: canaryPatternsOption(args),
    circuitBreaker: {
      maxConsecutiveCandidateErrors: requiredNumberOption(
        args,
        "--max-consecutive-errors",
      ),
      minCandidateAttemptsForErrorRate: requiredNumberOption(
        args,
        "--min-error-rate-attempts",
      ),
      maxCandidateErrorRate: requiredNumberOption(
        args,
        "--max-error-rate",
      ),
    },
  });
  assertCanaryPolicyAgainstRegistry(registry, policy);
  await writeCanaryActivationPolicy(outPath, policy);
  console.log(
    `policy=${policy.policyId} stage=${policy.stage} traffic=${policy.trafficFraction} candidate=${policy.candidateCheckpointId}`,
  );
  console.log(
    `lineage_head_hash=${policy.lineageHeadEventHash} automatic_stage_advance=false`,
  );
  console.log(`out=${outPath}`);
};

const runCanaryEvaluate = async (
  args: readonly string[],
): Promise<void> => {
  const policyPath = requiredOption(args, "--policy");
  const tracesPath = requiredOption(args, "--traces");
  const advancePolicyPath = requiredOption(args, "--advance-policy");
  const outPath = requiredOption(args, "--out");

  const policy = await readCanaryActivationPolicy(policyPath);
  const traces = parseCanaryTraceJsonl(
    await readFile(tracesPath, "utf8"),
  );
  const thresholds = parseCanaryAdvancePolicy(
    await readJson(advancePolicyPath),
  );
  const summary = summarizeCanaryTraces(policy, traces);
  const evidence = evaluateCanaryAdvance(summary, thresholds);
  await writeCanaryAdvanceEvidence(outPath, evidence);

  console.log(
    `policy=${policy.policyId} stage=${policy.stage} selected=${summary.candidateSelected} errors=${summary.candidateErrors} fallbacks=${summary.fallbacks} status=${evidence.status} action=${evidence.action}`,
  );
  console.log("automatic_stage_advance=false");
  console.log(`out=${outPath}`);
};

const runCanaryDrillCli = async (
  args: readonly string[],
): Promise<void> => {
  const registry = await readCheckpointLineageRegistry(
    requiredOption(args, "--registry"),
  );
  const outDir = requiredOption(args, "--out-dir");
  const rollbackTargetCheckpointId = optionValue(
    args,
    "--rollback-target",
  );
  const result = await runCanaryRollbackDrill(registry, {
    ...(rollbackTargetCheckpointId
      ? { rollbackTargetCheckpointId }
      : {}),
  });
  await writeCanaryRollbackDrill(outDir, result);

  console.log(
    `drill=${result.report.drillId} passed=${result.report.passed} candidate=${result.report.candidateCheckpointId} rollback_target=${result.report.rollbackTargetCheckpointId}`,
  );
  console.log(
    `kill=${result.report.checks.faultTriggeredKill} fallback=${result.report.checks.faultFellBackToIncumbent} restored=${result.report.checks.simulatedRegistryRestoredTarget}`,
  );
  console.log(
    "production_registry_mutated=false external_runtime_authority_changed=false",
  );
  console.log(`out_dir=${outDir}`);
  if (!result.report.passed) {
    throw new Error("canary rollback drill did not pass all checks");
  }
};


const runDriftPlan = async (args: readonly string[]): Promise<void> => {
  const activationPolicy = await readCanaryActivationPolicy(
    requiredOption(args, "--activation-policy"),
  );
  const baselinePolicy = await readCanaryActivationPolicy(
    requiredOption(args, "--baseline-policy"),
  );
  const baselineTraces = parseCanaryTraceJsonl(
    await readFile(requiredOption(args, "--baseline-traces"), "utf8"),
  );
  const baselineSummary = summarizeCanaryTraces(
    baselinePolicy,
    baselineTraces,
  );
  const policy = buildActiveLimitedDriftPolicy(
    activationPolicy,
    baselinePolicy,
    baselineSummary,
    {
      policyId: requiredOption(args, "--policy-id"),
      window: {
        size: requiredNumberOption(args, "--window-size"),
        minCandidateSelected: requiredNumberOption(args, "--min-selected"),
        minComparableQuestions: requiredNumberOption(args, "--min-comparable"),
        minCandidateConfidenceSamples: requiredNumberOption(
          args,
          "--min-confidence-samples",
        ),
      },
      thresholds: {
        maxCandidateErrorRate: requiredNumberOption(
          args,
          "--max-candidate-error",
        ),
        maxIncumbentErrorRate: requiredNumberOption(
          args,
          "--max-incumbent-error",
        ),
        maxFallbackRate: requiredNumberOption(args, "--max-fallback"),
        maxDisagreementRate: requiredNumberOption(
          args,
          "--max-disagreement",
        ),
        maxP95LatencyRatio: requiredNumberOption(
          args,
          "--max-latency-ratio",
        ),
        maxMeanCandidateConfidenceDelta: requiredNumberOption(
          args,
          "--max-confidence-delta",
        ),
      },
    },
  );
  const outPath = requiredOption(args, "--out");
  await writeActiveLimitedDriftPolicy(outPath, policy);
  console.log(
    `policy=${policy.policyId} activation=${policy.activationPolicyId} baseline=${policy.baseline.sourcePolicyId} window=${policy.window.size}`,
  );
  console.log(
    `automatic_hold=true automatic_rollback=false baseline_confidence=${policy.baseline.meanCandidateConfidence.toFixed(4)}`,
  );
  console.log(`out=${outPath}`);
};

const runDriftEvaluate = async (
  args: readonly string[],
): Promise<void> => {
  const activationPolicy = await readCanaryActivationPolicy(
    requiredOption(args, "--activation-policy"),
  );
  const driftPolicy = await readActiveLimitedDriftPolicy(
    requiredOption(args, "--drift-policy"),
  );
  const traces = parseCanaryTraceJsonl(
    await readFile(requiredOption(args, "--traces"), "utf8"),
  );
  const evidence = evaluateDriftWindow(
    driftPolicy,
    activationPolicy,
    traces,
  );
  const outPath = requiredOption(args, "--out");
  await writeDriftWindowEvidence(outPath, evidence);

  console.log(
    `policy=${driftPolicy.policyId} status=${evidence.status} action=${evidence.action} traces=${evidence.traceCount} selected=${evidence.summary.candidateSelected}`,
  );
  console.log(
    `candidate_error_rate=${evidence.summary.candidateErrorRate.toFixed(4)} fallback_rate=${evidence.summary.fallbackRate.toFixed(4)} disagreement_rate=${evidence.disagreementRate.toFixed(4)} confidence_delta=${evidence.confidenceDelta.toFixed(4)}`,
  );
  console.log("automatic_rollback=false");
  console.log(`out=${outPath}`);
};


const runHoldRequalify = async (
  args: readonly string[],
): Promise<void> => {
  const registry = await readCheckpointLineageRegistry(
    requiredOption(args, "--registry"),
  );
  const activationPolicy = await readCanaryActivationPolicy(
    requiredOption(args, "--activation-policy"),
  );
  const driftPolicy = await readActiveLimitedDriftPolicy(
    requiredOption(args, "--drift-policy"),
  );
  const hold = await readDriftHoldEvent(
    requiredOption(args, "--hold"),
  );
  const recovery = await readHoldRecoveryCase(
    requiredOption(args, "--recovery"),
  );
  const recoveryTraces = parseCanaryTraceJsonl(
    await readFile(requiredOption(args, "--recovery-traces"), "utf8"),
  );
  const recoveryWindow = evaluateDriftWindow(
    driftPolicy,
    activationPolicy,
    recoveryTraces,
  );
  const result = evaluateHoldRequalification(
    registry,
    activationPolicy,
    driftPolicy,
    hold,
    recovery,
    recoveryWindow,
    {
      newActivationPolicyId: requiredOption(args, "--new-policy-id"),
    },
  );
  const outDir = requiredOption(args, "--out-dir");
  await writeHoldRequalificationResult(outDir, result);

  console.log(
    `requalification=${result.evidence.requalificationId} classification=${result.evidence.classification} status=${result.evidence.status} action=${result.evidence.action}`,
  );
  console.log(
    `automatic_reactivation=false automatic_rollback=false old_session_reusable=false`,
  );
  if (result.restartPolicy) {
    console.log(
      `restart_policy=${result.restartPolicy.policyId} stage=${result.restartPolicy.stage} traffic=${result.restartPolicy.trafficFraction}`,
    );
  }
  console.log(`out_dir=${outDir}`);
};


const runRebaselinePlan = async (
  args: readonly string[],
): Promise<void> => {
  const registry = await readCheckpointLineageRegistry(
    requiredOption(args, "--registry"),
  );
  const activationPolicy = await readCanaryActivationPolicy(
    requiredOption(args, "--activation-policy"),
  );
  const driftPolicy = await readActiveLimitedDriftPolicy(
    requiredOption(args, "--drift-policy"),
  );
  const hold = await readDriftHoldEvent(
    requiredOption(args, "--hold"),
  );
  const recovery = await readHoldRecoveryCase(
    requiredOption(args, "--recovery"),
  );
  const traces = parseCanaryTraceJsonl(
    await readFile(requiredOption(args, "--candidate-traces"), "utf8"),
  );
  const review = await readWorkloadRebaselineReview(
    requiredOption(args, "--review"),
  );

  const result = buildWorkloadRebaselineCandidate(
    registry,
    activationPolicy,
    driftPolicy,
    hold,
    recovery,
    traces,
    review,
    {
      minCandidateSelected: requiredNumberOption(args, "--min-selected"),
      minComparableQuestions: requiredNumberOption(args, "--min-comparable"),
      minCandidateConfidenceSamples: requiredNumberOption(
        args,
        "--min-confidence-samples",
      ),
      maxCandidateErrorRate: requiredNumberOption(
        args,
        "--max-candidate-error",
      ),
      maxIncumbentErrorRate: requiredNumberOption(
        args,
        "--max-incumbent-error",
      ),
      maxFallbackRate: requiredNumberOption(args, "--max-fallback"),
      maxP95LatencyRatio: requiredNumberOption(
        args,
        "--max-latency-ratio",
      ),
    },
    {
      newCanaryPolicyId: requiredOption(args, "--new-policy-id"),
    },
  );
  const outDir = requiredOption(args, "--out-dir");
  await writeWorkloadRebaselineCandidateResult(outDir, result);

  console.log(
    `rebaseline=${result.evidence.rebaselineId} status=${result.evidence.status} action=${result.evidence.action} confidence_delta=${result.evidence.delta.meanCandidateConfidence.toFixed(4)} disagreement_delta=${result.evidence.delta.disagreementRate.toFixed(4)}`,
  );
  console.log(
    `old_baseline_replaced=false automatic_activation=false`,
  );
  if (result.restartPolicy) {
    console.log(
      `recovery_canary_policy=${result.restartPolicy.policyId} stage=${result.restartPolicy.stage}`,
    );
  }
  console.log(`out_dir=${outDir}`);
};

const runRebaselineAccept = async (
  args: readonly string[],
): Promise<void> => {
  const registry = await readCheckpointLineageRegistry(
    requiredOption(args, "--registry"),
  );
  const candidate = await readWorkloadRebaselineCandidateEvidence(
    requiredOption(args, "--candidate"),
  );
  const canary1 = await readCanaryActivationPolicy(
    requiredOption(args, "--canary-1-policy"),
  );
  const canary5 = await readCanaryActivationPolicy(
    requiredOption(args, "--canary-5-policy"),
  );
  const canary25 = await readCanaryActivationPolicy(
    requiredOption(args, "--canary-25-policy"),
  );
  const advance1 = await readCanaryAdvanceEvidence(
    requiredOption(args, "--canary-1-advance"),
  );
  const advance5 = await readCanaryAdvanceEvidence(
    requiredOption(args, "--canary-5-advance"),
  );
  const advance25 = await readCanaryAdvanceEvidence(
    requiredOption(args, "--canary-25-advance"),
  );
  const review = await readWorkloadRebaselineAcceptanceReview(
    requiredOption(args, "--review"),
  );

  const result = acceptWorkloadRebaseline(
    registry,
    candidate,
    [canary1, canary5, canary25],
    [advance1, advance5, advance25],
    review,
    {
      limitedActivePolicyId: requiredOption(
        args,
        "--limited-active-policy-id",
      ),
      driftPolicyId: requiredOption(args, "--drift-policy-id"),
      driftWindow: {
        size: requiredNumberOption(args, "--window-size"),
        minCandidateSelected: requiredNumberOption(args, "--min-selected"),
        minComparableQuestions: requiredNumberOption(args, "--min-comparable"),
        minCandidateConfidenceSamples: requiredNumberOption(
          args,
          "--min-confidence-samples",
        ),
      },
      driftThresholds: {
        maxCandidateErrorRate: requiredNumberOption(
          args,
          "--max-candidate-error",
        ),
        maxIncumbentErrorRate: requiredNumberOption(
          args,
          "--max-incumbent-error",
        ),
        maxFallbackRate: requiredNumberOption(args, "--max-fallback"),
        maxDisagreementRate: requiredNumberOption(
          args,
          "--max-disagreement",
        ),
        maxP95LatencyRatio: requiredNumberOption(
          args,
          "--max-latency-ratio",
        ),
        maxMeanCandidateConfidenceDelta: requiredNumberOption(
          args,
          "--max-confidence-delta",
        ),
      },
    },
  );
  const outDir = requiredOption(args, "--out-dir");
  await writeWorkloadRebaselineAcceptanceResult(outDir, result);

  console.log(
    `rebaseline=${result.evidence.rebaselineId} status=${result.evidence.status} action=${result.evidence.action}`,
  );
  console.log(
    `automatic_activation=false old_baseline_replaced=false recovery_chain=${result.evidence.recoveryCanaryPolicyIds.join("->")}`,
  );
  if (result.limitedActivePolicy && result.driftPolicy) {
    console.log(
      `limited_active_policy=${result.limitedActivePolicy.policyId} drift_policy=${result.driftPolicy.policyId} baseline_source=${result.driftPolicy.baseline.sourcePolicyId}`,
    );
  }
  console.log(`out_dir=${outDir}`);
};


const runBaselineLineageInit = async (
  args: readonly string[],
): Promise<void> => {
  const path = requiredOption(args, "--registry");
  const registry = createBaselineLineageRegistry(
    requiredOption(args, "--registry-id"),
    requiredOption(args, "--surface"),
  );
  await createBaselineLineageRegistryFile(path, registry);
  console.log(
    `registry=${registry.registryId} surface=${registry.decisionSurface} epochs=0`,
  );
  console.log(`path=${path}`);
};

const runBaselineRegisterInitial = async (
  args: readonly string[],
): Promise<void> => {
  const registryPath = requiredOption(args, "--registry");
  const checkpointRegistry = await readCheckpointLineageRegistry(
    requiredOption(args, "--checkpoint-registry"),
  );
  const activationPolicy = await readCanaryActivationPolicy(
    requiredOption(args, "--activation-policy"),
  );
  const driftPolicy = await readActiveLimitedDriftPolicy(
    requiredOption(args, "--drift-policy"),
  );

  const next = await mutateBaselineLineageRegistry(
    registryPath,
    (registry) =>
      registerInitialDistributionEpoch(
        registry,
        checkpointRegistry,
        activationPolicy,
        driftPolicy,
        {
          epochId: requiredOption(args, "--epoch-id"),
          distributionSummary: requiredOption(
            args,
            "--distribution-summary",
          ),
          sourceEvidenceRefs: [
            requiredOption(args, "--source-evidence-ref"),
          ],
          bindingEvidenceRef: requiredOption(
            args,
            "--binding-evidence-ref",
          ),
        },
      ),
  );
  const state = deriveBaselineLineageState(next);
  console.log(
    `epoch=${state.currentEpochId ?? "none"} ordinal=${state.currentEpochId ? state.epochs[state.currentEpochId]?.ordinal ?? "none" : "none"}`,
  );
  console.log(
    `checkpoint=${activationPolicy.candidateCheckpointId} matrix_epochs=${state.checkpointEpochMatrix[activationPolicy.candidateCheckpointId]?.join(",") ?? ""}`,
  );
};

const runBaselineRegisterRebaseline = async (
  args: readonly string[],
): Promise<void> => {
  const registryPath = requiredOption(args, "--registry");
  const checkpointRegistry = await readCheckpointLineageRegistry(
    requiredOption(args, "--checkpoint-registry"),
  );
  const acceptancePath = requiredOption(args, "--acceptance");
  const acceptance = await readWorkloadRebaselineAcceptanceEvidence(
    acceptancePath,
  );
  const activationPolicy = await readCanaryActivationPolicy(
    requiredOption(args, "--activation-policy"),
  );
  const driftPolicy = await readActiveLimitedDriftPolicy(
    requiredOption(args, "--drift-policy"),
  );

  const next = await mutateBaselineLineageRegistry(
    registryPath,
    (registry) =>
      registerRebaselineDistributionEpoch(
        registry,
        checkpointRegistry,
        acceptance,
        activationPolicy,
        driftPolicy,
        {
          epochId: requiredOption(args, "--epoch-id"),
          acceptanceEvidenceRef: acceptancePath,
          bindingEvidenceRef: requiredOption(
            args,
            "--binding-evidence-ref",
          ),
        },
      ),
  );
  const state = deriveBaselineLineageState(next);
  const current = state.currentEpochId
    ? state.epochs[state.currentEpochId]
    : undefined;
  console.log(
    `epoch=${current?.epochId ?? "none"} ordinal=${current?.ordinal ?? "none"} parent=${current?.parentEpochId ?? "none"} origin=${current?.origin ?? "none"}`,
  );
  console.log(
    `checkpoint=${activationPolicy.candidateCheckpointId} matrix_epochs=${state.checkpointEpochMatrix[activationPolicy.candidateCheckpointId]?.join(",") ?? ""}`,
  );
};

const runBaselineBindCheckpoint = async (
  args: readonly string[],
): Promise<void> => {
  const registryPath = requiredOption(args, "--registry");
  const checkpointRegistry = await readCheckpointLineageRegistry(
    requiredOption(args, "--checkpoint-registry"),
  );
  const activationPolicy = await readCanaryActivationPolicy(
    requiredOption(args, "--activation-policy"),
  );
  const driftPolicy = await readActiveLimitedDriftPolicy(
    requiredOption(args, "--drift-policy"),
  );
  const epochId = optionValue(args, "--epoch-id");
  const next = await mutateBaselineLineageRegistry(
    registryPath,
    (registry) =>
      bindCheckpointToDistributionEpoch(
        registry,
        checkpointRegistry,
        activationPolicy,
        driftPolicy,
        {
          ...(epochId ? { epochId } : {}),
          evidenceRef: requiredOption(args, "--evidence-ref"),
        },
      ),
  );
  const state = deriveBaselineLineageState(next);
  console.log(
    `epoch=${state.currentEpochId ?? "none"} checkpoint=${activationPolicy.candidateCheckpointId} binding_count=${state.currentEpochId ? state.epochs[state.currentEpochId]?.bindingIds.length ?? 0 : 0}`,
  );
};

const runBaselineShow = async (
  args: readonly string[],
): Promise<void> => {
  const registry = await readBaselineLineageRegistry(
    requiredOption(args, "--registry"),
  );
  console.log(JSON.stringify(deriveBaselineLineageState(registry), null, 2));
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "baseline-lineage-init") {
    await runBaselineLineageInit(args);
    return;
  }

  if (command === "baseline-register-initial") {
    await runBaselineRegisterInitial(args);
    return;
  }

  if (command === "baseline-register-rebaseline") {
    await runBaselineRegisterRebaseline(args);
    return;
  }

  if (command === "baseline-bind-checkpoint") {
    await runBaselineBindCheckpoint(args);
    return;
  }

  if (command === "baseline-show") {
    await runBaselineShow(args);
    return;
  }

  if (command === "lineage-init") {
    await runLineageInit(args);
    return;
  }

  if (command === "lineage-register") {
    await runLineageRegister(args);
    return;
  }

  if (command === "lineage-promote") {
    await runLineagePromote(args);
    return;
  }

  if (command === "lineage-set-rollback-safety") {
    await runLineageSetRollbackSafety(args);
    return;
  }

  if (command === "rollback-plan") {
    await runRollbackPlanCli(args);
    return;
  }

  if (command === "lineage-record-rollback") {
    await runLineageRecordRollback(args);
    return;
  }

  if (command === "lineage-show") {
    await runLineageShow(args);
    return;
  }

  if (command === "canary-plan") {
    await runCanaryPlan(args);
    return;
  }

  if (command === "canary-evaluate") {
    await runCanaryEvaluate(args);
    return;
  }

  if (command === "canary-drill") {
    await runCanaryDrillCli(args);
    return;
  }

  if (command === "drift-plan") {
    await runDriftPlan(args);
    return;
  }

  if (command === "drift-evaluate") {
    await runDriftEvaluate(args);
    return;
  }

  if (command === "hold-requalify") {
    await runHoldRequalify(args);
    return;
  }

  if (command === "rebaseline-plan") {
    await runRebaselinePlan(args);
    return;
  }

  if (command === "rebaseline-accept") {
    await runRebaselineAccept(args);
    return;
  }

  if (command === "promotion-check") {
    await runPromotionCheck(args);
    return;
  }

  if (command === "finetune-pack") {
    await runFineTunePack(args);
    return;
  }

  if (command === "candidate-reeval") {
    await runCandidateReevalCli(args);
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

  if (command === "dm-bakeoff") {
    const providerNames = (optionValue(args, "--providers") ?? "replay,laya")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (providerNames.length < 2) {
      throw new Error("--providers requires at least two comma-separated providers");
    }

    const incumbentProviderId = requiredOption(args, "--incumbent");
    if (!providerNames.includes(incumbentProviderId)) {
      throw new Error("--incumbent must be included in --providers");
    }

    const policy = parseShadowBakeoffPolicy(
      await readJson(requiredOption(args, "--policy")),
    );
    const providers: SystemOneProvider[] = [];
    for (const name of providerNames) {
      providers.push(await createProvider(name, loaded.cases, args));
    }

    const scoreAgreementTolerance = numericOption(args, "--score-tolerance");
    const evidence = await runCrossProviderBakeoff(
      providers,
      loaded.cases,
      {
        datasetId,
        incumbentProviderId,
        policy,
        ...(scoreAgreementTolerance === undefined
          ? {}
          : { scoreAgreementTolerance }),
      },
    );
    const outPath =
      optionValue(args, "--out") ??
      `evidence/dm/${evidence.bakeoffId}.json`;
    await writeCrossProviderBakeoffEvidence(outPath, evidence);

    for (const assessment of evidence.assessments) {
      console.log(
        `provider=${assessment.providerId} readiness=${assessment.readiness} accuracy=${(assessment.offline.accuracy * 100).toFixed(1)}% ece10=${assessment.offline.calibration.ece10.toFixed(4)} coverage=${(assessment.offline.calibration.coverage * 100).toFixed(1)}% errors=${assessment.offline.providerErrors}`,
      );
    }
    console.log(
      `shadow_candidates=${evidence.shadowCandidates.join(",") || "none"} automatic_selection=false runtime_authority_change=false`,
    );
    console.log(`evidence=${outPath}`);
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
