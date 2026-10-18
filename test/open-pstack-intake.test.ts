import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  evaluatePstackGate,
  fingerprintPstackIntake,
  parsePstackIntake,
  type PstackGateInput,
} from "../src/open-pstack/intake.js";

const fixture = (): PstackGateInput =>
  JSON.parse(readFileSync("fixtures/open-pstack/paired.synthetic.json", "utf8")) as PstackGateInput;

const observedApproved = (): PstackGateInput => {
  const input = fixture();
  input.intake.audit = { status: "approved", evidenceDigest: "f".repeat(64) };
  input.trial.operatorApproved = true;
  for (const probe of input.trial.probes) probe.provenance = "observed";
  return input;
};

test("source fingerprint is stable, bound to pins and independent of skill order", () => {
  const input = fixture();
  assert.equal(
    fingerprintPstackIntake(input.intake),
    "1844d732d09b013b92117dd398e82cbe73930ced09ea314a858193d83f85df9e",
  );
  input.intake.skills.reverse();
  assert.equal(fingerprintPstackIntake(input.intake), input.trial.candidateDigest);
});

test("synthetic fixture remains quarantined even with passing success numbers", () => {
  const result = evaluatePstackGate(fixture());
  assert.equal(result.decision, "insufficient_evidence");
  assert.equal(result.intakeStatus, "quarantined");
  assert.equal(result.rhoDecision, "insufficient_evidence");
  assert.equal(result.automaticActivation, false);
  assert.equal(result.codeOrPluginExecuted, false);
  assert.equal(result.runtimeAuthorityChange, false);
});

test("fully observed, reviewed pairs stop at independent human review", () => {
  const result = evaluatePstackGate(observedApproved());
  assert.equal(result.decision, "review_required");
  assert.equal(result.measures.pairs, 2);
  assert.equal(result.intakeStatus, "supervised_review_only");
  assert.equal(result.independentVerificationRequired, true);
  assert.equal(result.humanReviewRequired, true);
});

test("source pin, unknown skills and duplicate skills are rejected", () => {
  const input = fixture();
  input.intake.source.commit = "f".repeat(40);
  assert.throws(() => parsePstackIntake(input.intake), /unreviewed/);
  input.intake.source.commit = "9368993ea3d96b491833d53c0964b389e868162c";
  input.intake.skills[0]!.name = "other" as "correct";
  assert.throws(() => parsePstackIntake(input.intake), /unexpected/);
  input.intake.skills[0]!.name = "correct";
  assert.throws(() => parsePstackIntake(input.intake), /duplicate/);
});

test("installed plugin, hook and external execution permissions fail closed", () => {
  for (const key of [
    "installPlugin", "enableHooks", "runExternalCommands",
    "enableNetwork", "modifyGlobalSettings", "automaticActivation",
  ] as const) {
    const input = fixture();
    (input.intake.controls as unknown as Record<string, boolean>)[key] = true;
    assert.throws(() => evaluatePstackGate(input), /unsafe control/);
  }
});

test("review must include a digested attestation and operator approval", () => {
  const input = fixture();
  input.intake.audit = { status: "approved" };
  assert.throws(() => evaluatePstackGate(input), /review evidence/);
  input.intake.audit = { status: "approved", evidenceDigest: "f".repeat(64) };
  for (const probe of input.trial.probes) probe.provenance = "observed";
  assert.equal(evaluatePstackGate(input).decision, "insufficient_evidence");
  assert.ok(evaluatePstackGate(input).reasons.includes("operator_approval_required"));
});

test("pstack candidate fingerprint cannot silently change", () => {
  const input = fixture();
  input.trial.candidateDigest = "a".repeat(64);
  assert.throws(() => evaluatePstackGate(input), /candidate does not match/);
});

test("regressions and mismatched paired constraints are rejected by RHO", () => {
  const regressed = observedApproved();
  regressed.trial.probes[1]!.regressions = 1;
  assert.equal(evaluatePstackGate(regressed).decision, "reject");
  const mismatched = observedApproved();
  mismatched.trial.probes[1]!.budgetDigest = "f".repeat(64);
  assert.equal(evaluatePstackGate(mismatched).decision, "reject");
});

test("added cost and added latency trip independent quality budgets", () => {
  const costly = observedApproved();
  costly.trial.probes[1]!.costUsd = 0.001;
  assert.equal(evaluatePstackGate(costly).decision, "reject");
  assert.ok(evaluatePstackGate(costly).reasons.includes("quality_or_budget_gate_failed"));
  const slow = observedApproved();
  slow.trial.probes[1]!.latencyMs = 101;
  assert.equal(evaluatePstackGate(slow).decision, "reject");
});

test("missing executor pair never qualifies", () => {
  const input = observedApproved();
  input.trial.probes = input.trial.probes.slice(0, 2);
  assert.equal(evaluatePstackGate(input).decision, "insufficient_evidence");
});

test("quality gain threshold is a recorded part of candidate fingerprint", () => {
  const input = observedApproved();
  input.intake.controls.minVerifiedSuccessGain = 1;
  input.trial.candidateDigest = fingerprintPstackIntake(input.intake);
  assert.equal(evaluatePstackGate(input).decision, "reject");
});

test("real CLI creates only a new report and refuses to overwrite it", () => {
  const dir = mkdtempSync(join(tmpdir(), "mso-pstack-"));
  try {
    const out = join(dir, "gate.json");
    const args = ["dist/src/open-pstack/cli.js", "fixtures/open-pstack/paired.synthetic.json", out];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const report = JSON.parse(readFileSync(out, "utf8")) as {
      decision: string; automaticActivation: boolean; codeOrPluginExecuted: boolean;
    };
    assert.equal(report.decision, "insufficient_evidence");
    assert.equal(report.automaticActivation, false);
    assert.equal(report.codeOrPluginExecuted, false);
    const second = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(second.status, 1);
    assert.equal(JSON.parse(readFileSync(out, "utf8")).decision, "insufficient_evidence");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
