import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPublicFixture, type DogfoodJob, type DogfoodEvidence } from "../src/coding/sandbox-execution.js";
import { DelegationRouter, MODEL_ROLES, parseDelegationRequest, loadOperatorAuthorization, type ExecutionAuthorization } from "../src/coding/free-agent-delegation.js";
import { processMcpRequest } from "../src/coding/free-agent-mcp.js";

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),"mso-delegate-"));
 const dir=join(root,"fixtures","dogfood","public");
 await mkdir(dir,{recursive:true});
 await writeFile(join(dir,"TASK.md"),"Solve this public test case");
 const sha=await hashPublicFixture(dir);
 const registry:Record<string,DogfoodJob>={};
 for(const [role,providerId] of Object.entries(MODEL_ROLES)){
  const runId="trial-"+role;
  registry["public:"+role]={
    schemaVersion:"mso.coding-dogfood-job.v0",runId,caseId:"public",
    taskFamily:"typescript",providerId,fixtureDir:"fixtures/dogfood/public",
    promptFile:"TASK.md",expectedFixtureSha256:sha,
    image:"ghcr.io/example/opencode@sha256:"+"a".repeat(64),
    egressNetwork:"mso-free-egress-operator",
    limits:{timeoutSeconds:30,memoryMb:512,cpus:1},
    approval:{publicFixture:true,externalTransmission:true,spendingRisk:true,networkEgressControlled:true,approvalRef:"operator:test"},
  };
 }
 const auth:ExecutionAuthorization={
  schemaVersion:"mso.delegation-authorization.v0",taskRef:"public:implement",
  providerId:MODEL_ROLES.implement,fixtureSha256:sha,
  expiresAt:"2099-01-01T00:00:00Z",
  authDir:join(root,"auth"),artifactsRoot:join(root,"artifacts"),
  operatorRef:"operator:one-shot",allowOneLiveExecution:true,
 };
 return {root,registry,sha,auth};
}
test("each role resolves to a different free model without executing anything",async t=>{
 const fx=await fixture();t.after(()=>rm(fx.root,{force:true,recursive:true}));
 const router=new DelegationRouter({repoRoot:fx.root,registry:fx.registry});
 for(const [role,id] of Object.entries(MODEL_ROLES)){
  const result=await router.delegate({role,taskRef:"public:"+role,privacy:"approved_public"});
  assert.equal(result.providerId,id);
  assert.equal(result.mode,"dry_run");
  assert.equal(result.externalCallsMade,false);
  assert.equal(result.billingVerified,false);
  assert.equal(result.automaticRoutingDecision,false);
 }
});
test("unregistered task, model mismatch, private data and raw prompt are rejected",async t=>{
 const fx=await fixture();t.after(()=>rm(fx.root,{force:true,recursive:true}));
 const router=new DelegationRouter({repoRoot:fx.root,registry:fx.registry});
 await assert.rejects(router.delegate({role:"review",taskRef:"public:implement",privacy:"approved_public"}),/not approved/);
 await assert.rejects(router.delegate({role:"review",taskRef:"not-registered",privacy:"approved_public"}),/not registered/);
 assert.throws(()=>parseDelegationRequest({role:"long_context",taskRef:"public:long_context",privacy:"private"}),/private or confidential/);
 assert.throws(()=>parseDelegationRequest({role:"implement",taskRef:"public:implement",privacy:"approved_public",prompt:"secrets"}),/unrecognized/);
 await assert.rejects(router.delegate({role:"implement",taskRef:"public:implement",privacy:"approved_public",mode:"execute"}),/authorization is absent/);
});
test("operator one-time authorization is locked to run/model/digest and cannot be reused",async t=>{
 const fx=await fixture();t.after(()=>rm(fx.root,{force:true,recursive:true}));
 let invocations=0;
 const executor=async (job:DogfoodJob):Promise<DogfoodEvidence>=>{
  invocations++;
  return {
    schemaVersion:"mso.coding-dogfood-run.v0",runId:job.runId,caseId:job.caseId,
    taskFamily:job.taskFamily,providerId:job.providerId,provenance:"live",status:"succeeded",
    exitCode:0,elapsedMs:100,fixtureSha256:fx.sha,artifactSha256:fx.sha,
    outputSha256:fx.sha,outputBytes:0,artifactRef:"mock:public",
    approvalRef:"operator:test",testStatus:"not_run",reviewStatus:"not_run",
    billedUsd:null,billingEvidenceRef:null,rawTranscriptPersisted:false,
    automaticallyQualified:false,automaticRoutingDecision:false,
  };
 };
 const router=new DelegationRouter({repoRoot:fx.root,registry:fx.registry,authorization:fx.auth,executor});
 const req={role:"implement",taskRef:"public:implement",privacy:"approved_public",mode:"execute"};
 const out=await router.delegate(req);assert.equal(out.status,"executed");
 assert.equal(out.run?.billingEvidenceRef,null);
 assert.equal(invocations,1);
 await assert.rejects(router.delegate(req),/already consumed/);
 const wrong=new DelegationRouter({repoRoot:fx.root,registry:fx.registry,authorization:{...fx.auth,fixtureSha256:"b".repeat(64)},executor});
 await assert.rejects(wrong.delegate(req),/does not match/);
 assert.equal(invocations,1);
});
test("MCP handshake, tool list and tools/call are JSON-RPC compliant",async t=>{
 const fx=await fixture();t.after(()=>rm(fx.root,{force:true,recursive:true}));
 const router=new DelegationRouter({repoRoot:fx.root,registry:fx.registry});
 const m=(id:number,method:string,params:unknown={})=>({jsonrpc:"2.0",id,method,params});
 const init=await processMcpRequest(m(1,"initialize"),router) as Record<string,any>;
 assert.equal(init.result.protocolVersion,"2025-06-18");
 const list=await processMcpRequest(m(2,"tools/list"),router) as Record<string,any>;
 assert.ok(list.result.tools.some((item:{name:string})=>item.name==="delegate_free_agent"));
 const call=await processMcpRequest(m(3,"tools/call",{name:"delegate_free_agent",arguments:{role:"review",taskRef:"public:review",privacy:"approved_public"}}),router) as Record<string,any>;
 const result=JSON.parse(call.result.content[0].text);
 assert.equal(result.providerId,MODEL_ROLES.review);
 const blocked=await processMcpRequest(m(4,"tools/call",{name:"delegate_free_agent",arguments:{role:"long_context",taskRef:"public:long_context",privacy:"confidential"}}),router) as Record<string,any>;
 assert.equal(blocked.result.isError,true);
 const roles=await processMcpRequest(m(5,"tools/call",{name:"list_free_agent_roles",arguments:{}}),router) as Record<string,any>;
 assert.equal(JSON.parse(roles.result.content[0].text).long_context.retention,"30_days");
});
test("authorization file requires owner-only permissions",async t=>{
 const fx=await fixture();t.after(()=>rm(fx.root,{force:true,recursive:true}));
 const path=join(fx.root,"approval.json");
 await writeFile(path,JSON.stringify(fx.auth),{mode:0o644});
 await assert.rejects(loadOperatorAuthorization(path),/mode 0600/);
 await chmod(path,0o600);
 assert.equal((await loadOperatorAuthorization(path)).providerId,MODEL_ROLES.implement);
});
