import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  dockerInvocation, executeDogfoodJob, hashPublicFixture, parseDogfoodJob,
  preflightDogfoodJob, type DogfoodJob, type DogfoodEvidence,
  type CommandRunner,
} from "../src/coding/sandbox-execution.js";
import { parseBillingAttestation, reconcileDogfoodProof } from "../src/coding/billing-reconciliation.js";
import type { PairedCodingCase } from "../src/coding/multi-free-bakeoff.js";

const image = "ghcr.io/anomalyco/opencode@sha256:" + "a".repeat(64);
const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "mso-test-"));
  const fixture = join(root,"repo","fixtures","dogfood","public-task");
  await mkdir(fixture, { recursive: true });
  await writeFile(join(fixture,"TASK.md"),"Fix main.txt. Only public fixture data.\n");
  await writeFile(join(fixture,"main.txt"),"incorrect\n");
  const auth = join(root,"auth");
  await mkdir(auth, { mode: 0o700 });
  await chmod(auth, 0o700);
  await writeFile(join(auth,"auth.json"),"{}\n",{ mode: 0o600 });
  await chmod(join(auth,"auth.json"),0o600);
  const sha = await hashPublicFixture(fixture);
  const job: DogfoodJob = {
    schemaVersion:"mso.coding-dogfood-job.v0",runId:"public-001",caseId:"public-task",
    taskFamily:"typescript",providerId:"opencode/glm-5.3-flash-free",
    fixtureDir:"fixtures/dogfood/public-task",promptFile:"TASK.md",
    expectedFixtureSha256:sha,image,egressNetwork:"mso-free-egress-approved",
    limits:{ timeoutSeconds:30,memoryMb:512,cpus:1 },
    approval:{
      publicFixture:true,externalTransmission:true,spendingRisk:true,
      networkEgressControlled:true,approvalRef:"operator:public:2026-10-16",
    },
  };
  return {root,fixture,auth,sha,job,repo:join(root,"repo"),artifacts:join(root,"artifacts")};
};

test("preflight is offline, confirms digest and emits no prompt or credentials",async t=>{
  const fx=await setup();
  t.after(()=>rm(fx.root,{recursive:true,force:true}));
  const {plan}=await preflightDogfoodJob(fx.job,fx.repo);
  assert.equal(plan.externalCallsMade,false);
  assert.equal(plan.fixtureSha256,fx.sha);
  assert.equal(plan.secretsAccessed,false);
  assert.ok(!JSON.stringify(plan).includes("Fix main.txt"));
});
test("only exact free model and digest-pinned image pass manifest",async t=>{
  const fx=await setup();t.after(()=>rm(fx.root,{recursive:true,force:true}));
  assert.equal(parseDogfoodJob(fx.job).providerId,"opencode/glm-5.3-flash-free");
  assert.throws(()=>parseDogfoodJob({...fx.job,providerId:"opencode/glm-5.3-flash"}),/non-free/);
  assert.throws(()=>parseDogfoodJob({...fx.job,image:"ghcr.io/anomalyco/opencode:latest"}),/digest-pinned/);
  assert.throws(()=>parseDogfoodJob({...fx.job,egressNetwork:"bridge"}),/egress/);
  assert.throws(()=>parseDogfoodJob({...fx.job,fixtureDir:"../../secret"}),/relative/);
  assert.equal(parseDogfoodJob({...fx.job,approval:{...fx.job.approval,publicFixture:false}}).approval.publicFixture,false);
  await assert.rejects(preflightDogfoodJob({...fx.job,expectedFixtureSha256:"0".repeat(64)},fx.repo),/SHA mismatch/);
});
test("forbid secret files, symlinks, hardlinks and project-supplied OpenCode config",async t=>{
  const fx=await setup();t.after(()=>rm(fx.root,{recursive:true,force:true}));
  await writeFile(join(fx.fixture,"opencode.json"),'{}');
  await assert.rejects(hashPublicFixture(fx.fixture),/private or executable configuration/);
  await rm(join(fx.fixture,"opencode.json"));
  await symlink("/etc/hosts",join(fx.fixture,"escape"));
  await assert.rejects(hashPublicFixture(fx.fixture),/unsafe file type/);
});
test("Docker job is bounded, no shell, no host home and deny-by-default tool permissions",async t=>{
  const fx=await setup();t.after(()=>rm(fx.root,{recursive:true,force:true}));
  const cmd=dockerInvocation(fx.job,"/tmp/safe-work","/tmp/dedicated-auth","public prompt","mso-dogfood-fixed");
  assert.ok(cmd.args.includes("--cap-drop=ALL"));
  assert.ok(cmd.args.includes("--read-only"));
  assert.ok(cmd.args.includes("--security-opt=no-new-privileges"));
  assert.ok(cmd.args.includes("--entrypoint=opencode"));
  assert.ok(cmd.args.includes("opencode/glm-5.3-flash-free"));
  assert.ok(cmd.args.includes("--network"));
  assert.equal(cmd.args[cmd.args.indexOf("--network")+1],"mso-free-egress-approved");
  const config=cmd.args.find(x=>x.startsWith("--env=OPENCODE_CONFIG_CONTENT="))!;
  assert.equal(JSON.parse(config.slice("--env=OPENCODE_CONFIG_CONTENT=".length)).permission.bash,"deny");
  assert.ok(!cmd.args.includes("--privileged"));
  assert.ok(!cmd.args.some(a=>a.includes("docker.sock")));
});
test("mocked launch still records unverified cost/review and hashes copied public artifact",async t=>{
  const fx=await setup();t.after(()=>rm(fx.root,{recursive:true,force:true}));
  const runner:CommandRunner=async (_,args)=>{
    const mount=args.find((a)=>a.includes("dst=/workspace"))!;
    const path=mount.match(/src=([^,]+),dst=\/workspace/)?.[1];
    assert.ok(path);
    await writeFile(join(path,"main.txt"),"correct\n");
    return {exitCode:0,timedOut:false,elapsedMs:1800,outputSha256:"f".repeat(64),outputBytes:100};
  };
  const result=await executeDogfoodJob(fx.job,fx.repo,fx.auth,fx.artifacts,runner);
  assert.equal(result.status,"succeeded");
  assert.notEqual(result.artifactSha256,fx.sha);
  assert.equal(result.testStatus,"not_run");
  assert.equal(result.reviewStatus,"not_run");
  assert.equal(result.billedUsd,null);
  assert.equal(result.automaticallyQualified,false);
  assert.equal(await readFile(join(fx.artifacts,"public-001","main.txt"),"utf8"),"correct\n");
});
test("cannot mount host repo as credential directory; failed run cannot look independently verified",async t=>{
  const fx=await setup();t.after(()=>rm(fx.root,{recursive:true,force:true}));
  const runner:CommandRunner=async()=>({exitCode:1,timedOut:false,elapsedMs:1000,outputSha256:"f".repeat(64),outputBytes:10});
  await assert.rejects(executeDogfoodJob(fx.job,fx.repo,fx.repo,fx.artifacts,runner),/overlap/);
  await assert.rejects(executeDogfoodJob({...fx.job,approval:{...fx.job.approval,spendingRisk:false}},fx.repo,fx.auth,fx.artifacts,runner),/approvals/);
  const failed=await executeDogfoodJob(fx.job,fx.repo,fx.auth,fx.artifacts,runner);
  assert.equal(failed.status,"failed");
  assert.equal(failed.testStatus,"not_run");
});
const fakeEvidence=(sha:string):DogfoodEvidence=>({
  schemaVersion:"mso.coding-dogfood-run.v0",runId:"public-001",caseId:"public-task",taskFamily:"typescript",
  providerId:"opencode/glm-5.3-flash-free",provenance:"live",status:"succeeded",exitCode:0,
  elapsedMs:1300,fixtureSha256:sha,artifactSha256:"f".repeat(64),outputSha256:"e".repeat(64),
  outputBytes:10,artifactRef:"public-dogfood:public-001",approvalRef:"operator:test",
  testStatus:"not_run",reviewStatus:"not_run",billedUsd:null,billingEvidenceRef:null,
  rawTranscriptPersisted:false,automaticallyQualified:false,automaticRoutingDecision:false,
});
const task=(sha:string):PairedCodingCase=>({
  id:"public-task",taskFamily:"typescript",exposure:"approved_public",artifactRef:"fixture:public-task",
  snapshotRef:"sha256:"+sha,instructionRef:"sha256:prompt",testPlanRef:"sha256:tests",budgetRef:"budget:identical",
});
const receipt=(run:DogfoodEvidence)=>({
  schemaVersion:"mso.coding-billing-attestation.v0",runId:run.runId,providerId:run.providerId,
  currency:"USD",billedUsd:0,invoiceLineRef:"ledger:line:0001",
  sourceRef:"operator:ledger-export:001",verifiedAt:"2026-10-16T13:00:00.000Z",
  verifiedBy:"human-operator",attribution:"individual_run",
  sourceKind:"provider_billing_ledger",independentlyReviewed:true,
});
const verification=(run:DogfoodEvidence)=>({
  schemaVersion:"mso.coding-independent-verification.v0",runId:run.runId,caseId:run.caseId,providerId:run.providerId,
  testStatus:"pass",reviewStatus:"pass",testEvidenceRef:"test:sha256:public",
  reviewEvidenceRef:"review:operator-001",verifiedBy:"human",verificationRef:"review:001",
});
test("billing is unknown until exact-run external ledger attestation, never OpenCode estimated cost",()=>{
  const run=fakeEvidence("a".repeat(64));
  const missing=reconcileDogfoodProof(run,task(run.fixtureSha256),null,verification(run));
  assert.equal(missing.billedUsd,null);
  assert.equal(missing.qualificationRun.billedUsd,null);
  const complete=reconcileDogfoodProof(run,task(run.fixtureSha256),receipt(run),verification(run));
  assert.equal(complete.billedUsd,0);
  assert.equal(complete.independentlyVerified,true);
  assert.equal(complete.qualificationRun.testStatus,"pass");
  assert.ok(complete.qualificationRun.billingEvidenceRef?.startsWith("ledger-proof:sha256:"));
  assert.equal(complete.automaticRoutingDecision,false);
});
test("billing proof rejects aggregate invoice, estimated cost and cross-model attribution",()=>{
  const run=fakeEvidence("a".repeat(64));
  const aggregate={...receipt(run),attribution:"aggregate_period"};
  assert.throws(()=>parseBillingAttestation(aggregate),/individual-run/);
  const wrong={...receipt(run),providerId:"opencode/deepseek-v4.1-flash-free"};
  assert.throws(()=>reconcileDogfoodProof(run,task(run.fixtureSha256),wrong,verification(run)),/cross-run/);
  const missingSource={...receipt(run),sourceRef:""};
  assert.throws(()=>parseBillingAttestation(missingSource),/required/);
  const reported={...receipt(run),sourceKind:"opencode_session_estimate"};
  assert.throws(()=>parseBillingAttestation(reported),/ledger attestation/);
});
test("independent success cannot be claimed for a failed container or wrong fixture",()=>{
  const run=fakeEvidence("a".repeat(64));
  const fail={...run,status:"failed" as const};
  const evidence=reconcileDogfoodProof(fail,task(run.fixtureSha256),receipt(run),verification(run));
  assert.equal(evidence.independentlyVerified,false);
  assert.equal(evidence.qualificationRun.testStatus,"not_run");
  assert.throws(()=>reconcileDogfoodProof(run,task("b".repeat(64)),receipt(run),verification(run)),/digest/);
});
