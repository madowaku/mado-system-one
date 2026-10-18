import {createHash} from "node:crypto";
export type Executor="codex"|"free-agent";
export type Probe={taskId:string;executor:Executor;variant:"baseline"|"candidate";fixtureDigest:string;policyDigest:string;testPlanDigest:string;budgetDigest:string;seed:number;success:boolean;independentVerified:boolean;regressions:number;latencyMs:number;costUsd:number;provenance:"synthetic"|"observed";sandboxed:boolean;networkRestricted:boolean;sideEffects:boolean;evidenceDigest:string};
export type Trial={trialId:string;candidateDigest:string;baselineDigest:string;probes:Probe[];operatorApproved:boolean;lesson:string};
export type Outcome={schemaVersion:1;trialId:string;decision:"reject"|"insufficient_evidence"|"review_required";reasons:string[];metrics:{pairs:number;successesBaseline:number;successesCandidate:number;latencyDeltaMs:number;costDeltaUsd:number};lessonDigest:string;candidatesNeverAutoActivated:true};
const digest=(s:unknown):s is string=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
export function evaluateTrial(t:Trial):Outcome{
 if(!t||!/^[a-zA-Z0-9_.-]{1,100}$/.test(t.trialId)||!digest(t.candidateDigest)||!digest(t.baselineDigest)||t.candidateDigest===t.baselineDigest||typeof t.lesson!=="string"||t.lesson.length>4000||typeof t.operatorApproved!=="boolean"||!Array.isArray(t.probes)||t.probes.length>400)throw Error("invalid trial");
 const seen=new Set<string>();for(const p of t.probes){
 if(!p||!/^[a-zA-Z0-9_.-]{1,100}$/.test(p.taskId)||!["codex","free-agent"].includes(p.executor)||!["baseline","candidate"].includes(p.variant)||![p.fixtureDigest,p.policyDigest,p.testPlanDigest,p.budgetDigest,p.evidenceDigest].every(digest)||!Number.isSafeInteger(p.seed)||p.seed<0||![p.success,p.independentVerified,p.sandboxed,p.networkRestricted,p.sideEffects].every(v=>typeof v==="boolean")||!["synthetic","observed"].includes(p.provenance)||![p.regressions,p.latencyMs,p.costUsd].every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0)||!Number.isSafeInteger(p.regressions))throw Error("invalid probe");
 const key=p.taskId+"/"+p.executor+"/"+p.variant;if(seen.has(key))throw Error("duplicate probe");seen.add(key);
 }
 let bad=false,missing=t.probes.length===0,pairs=0,s0=0,s1=0,latency=0,cost=0;const reasons:string[]=[];
 for(const taskId of new Set(t.probes.map(p=>p.taskId)))for(const executor of ["codex","free-agent"] as const){
 const a=t.probes.find(p=>p.taskId===taskId&&p.executor===executor&&p.variant==="baseline"),b=t.probes.find(p=>p.taskId===taskId&&p.executor===executor&&p.variant==="candidate");
 if(!a||!b){missing=true;continue}
 if(a.fixtureDigest!==b.fixtureDigest||a.policyDigest!==b.policyDigest||a.testPlanDigest!==b.testPlanDigest||a.budgetDigest!==b.budgetDigest||a.seed!==b.seed){bad=true;reasons.push("unpaired_constraints:"+taskId+":"+executor);continue}
 pairs++;s0+=Number(a.success&&a.independentVerified);s1+=Number(b.success&&b.independentVerified);latency+=b.latencyMs-a.latencyMs;cost+=b.costUsd-a.costUsd;
 for(const p of [a,b]){if(!p.sandboxed||!p.networkRestricted||p.sideEffects){bad=true;reasons.push("unsafe_probe")}if(p.regressions>0){bad=true;reasons.push("regression")}if(p.success&&!p.independentVerified){missing=true;reasons.push("missing_independent_verification")}if(p.provenance!=="observed")missing=true}
 }
 if(pairs<2)missing=true;if(s1<s0){bad=true;reasons.push("success_regression")}if(missing)reasons.push("missing_or_synthetic_evidence");if(!t.operatorApproved)reasons.push("operator_approval_required");
 return {schemaVersion:1,trialId:t.trialId,decision:bad?"reject":missing?"insufficient_evidence":"review_required",reasons:[...new Set(reasons)].sort(),metrics:{pairs,successesBaseline:s0,successesCandidate:s1,latencyDeltaMs:latency,costDeltaUsd:Math.round(cost*1e6)/1e6},lessonDigest:hash(t.lesson),candidatesNeverAutoActivated:true};
}
export type LedgerEntry={seq:number;prevHash:string;hash:string;outcome:Outcome;createdAt:string};
export function validateHistory(history:readonly LedgerEntry[]):void{
 let prev="0".repeat(64);for(let i=0;i<history.length;i++){const e=history[i]!;if(e.seq!==i+1||e.prevHash!==prev||e.hash!==hash(JSON.stringify({seq:e.seq,prevHash:e.prevHash,outcome:e.outcome,createdAt:e.createdAt})))throw Error("tampered history");prev=e.hash}
}
export function appendHistory(history:readonly LedgerEntry[],outcome:Outcome,createdAt:string):LedgerEntry[]{
 validateHistory(history);if(history.some(e=>e.outcome.trialId===outcome.trialId)||!Number.isFinite(Date.parse(createdAt)))throw Error("duplicate trial or bad timestamp");
 const seq=history.length+1,prevHash=history.at(-1)?.hash??"0".repeat(64);return [...history,{seq,prevHash,outcome,createdAt,hash:hash(JSON.stringify({seq,prevHash,outcome,createdAt}))}];
}