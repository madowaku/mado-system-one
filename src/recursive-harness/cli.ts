import {readFileSync,writeFileSync} from "node:fs";
import {evaluateTrial,appendHistory,type Trial,type LedgerEntry} from "./lab.js";
const [input,output,ledger]=process.argv.slice(2);
if(!input||!output||!ledger||new Set([input,output,ledger]).size!==3){console.error("Usage: node dist/src/recursive-harness/cli.js trial.json outcome.json history.json");process.exitCode=2}
else try{
 const trial=JSON.parse(readFileSync(input,"utf8")) as Trial;const outcome=evaluateTrial(trial);
 const previous=JSON.parse(readFileSync(ledger,"utf8")) as LedgerEntry[];
 const next=appendHistory(previous,outcome,new Date().toISOString());
 writeFileSync(output,JSON.stringify(outcome,null,2)+"\n",{flag:"wx"});
 writeFileSync(ledger,JSON.stringify(next,null,2)+"\n");
 console.log(outcome.decision+" (no automatic activation)");
}catch(e){console.error(e);process.exitCode=1}
