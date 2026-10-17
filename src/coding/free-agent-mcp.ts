#!/usr/bin/env node
/**
 * Small dependency-free MCP stdio server. Uses newline-delimited JSON-RPC,
 * never writes protocol diagnostics to stdout. Default: dry-run only.
 */
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DelegationRouter, loadOperatorAuthorization } from "./free-agent-delegation.js";
import type { DogfoodJob } from "./sandbox-execution.js";

const VERSION = "2025-06-18";
const TOOLS = [
  {
    name:"delegate_free_agent",
    description:"Delegate a pre-registered approved-public task to DeepSeek (implement), GLM (review), or Beam (long_context). Dry-run is default. Live execution is only possible when the operator has privately armed exactly one task/model/snapshot at server startup. Returns evidence, never an automatic quality verdict.",
    inputSchema:{
      type:"object", additionalProperties:false,
      required:["role","taskRef","privacy"],
      properties:{
        role:{type:"string",enum:["implement","review","long_context"]},
        taskRef:{type:"string",description:"Operator-registered public fixture reference, not raw source or prompt"},
        privacy:{type:"string",enum:["approved_public"]},
        mode:{type:"string",enum:["dry_run","execute"],default:"dry_run"},
      },
    },
  },
  {
    name:"list_free_agent_roles",
    description:"Return static role descriptions and privacy limitations. No model API calls or file access.",
    inputSchema:{type:"object",additionalProperties:false,properties:{}},
  },
];
const success = (id: unknown, result: unknown) => ({jsonrpc:"2.0",id,result});
const error = (id: unknown, code: number, message: string) => ({jsonrpc:"2.0",id,error:{code,message}});
const toolContent = (value: unknown, isError = false) =>
  ({content:[{type:"text",text:JSON.stringify(value)}],isError});
export const processMcpRequest = async (
  raw: unknown, router: DelegationRouter,
): Promise<unknown | null> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return error(null,-32600,"invalid request");
  const req = raw as Record<string, unknown>;
  const id = req.id;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return error(id ?? null,-32600,"invalid JSON-RPC");
  if (id === undefined) return null; // notifications are not answered
  if (typeof id !== "number" && typeof id !== "string") return error(null,-32600,"invalid id");
  switch(req.method){
    case "initialize":
      return success(id, {protocolVersion:VERSION,capabilities:{tools:{listChanged:false}},serverInfo:{name:"mso-free-agent-router",version:"0.6.2c"}});
    case "ping": return success(id, {});
    case "tools/list": return success(id,{tools:TOOLS});
    case "tools/call": {
      const p = req.params;
      if (!p || typeof p !== "object" || Array.isArray(p)) return error(id,-32602,"invalid tool call params");
      const args = p as Record<string,unknown>;
      if (args.name === "list_free_agent_roles") {
        return success(id,toolContent({
          implement:{model:"opencode/deepseek-v4.1-flash-free",maxExposure:"approved_public"},
          review:{model:"opencode/glm-5.3-flash-free",maxExposure:"approved_public"},
          long_context:{model:"opencode/beam-free",retention:"30_days",maxExposure:"approved_public"},
          note:"Role routing is experimental; free pricing must be verified immediately before any live invocation.",
        }));
      }
      if (args.name !== "delegate_free_agent") return error(id,-32602,"unknown tool");
      try { return success(id,toolContent(await router.delegate(args.arguments))); }
      catch (e) { return success(id,toolContent({error:e instanceof Error?e.message:"delegation failed",externalCallsMade:false},true)); }
    }
    default: return error(id,-32601,"method not found");
  }
};
const main = async ():Promise<void> => {
  const repoRoot = resolve(process.env.MSO_DELEGATION_REPO_ROOT ?? ".");
  const file = process.env.MSO_DELEGATION_REGISTRY;
  if (!file) throw new Error("MSO_DELEGATION_REGISTRY must name a trusted operator-maintained task manifest");
  const value = JSON.parse(await readFile(file,"utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid registry");
  const registry = value as Record<string,DogfoodJob>;
  const approval = process.env.MSO_DELEGATION_AUTHORIZATION
    ? await loadOperatorAuthorization(process.env.MSO_DELEGATION_AUTHORIZATION)
    : undefined;
  const router = new DelegationRouter({repoRoot,registry,...(approval?{authorization:approval}:{})});
  const input = createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of input){
    try{
      if(Buffer.byteLength(line)>65536) throw new Error("MCP message exceeds 64KiB");
      const msg=JSON.parse(line) as unknown;
      const response=await processMcpRequest(msg,router);
      if(response !== null) process.stdout.write(JSON.stringify(response)+"\n");
    }catch(e){
      process.stdout.write(JSON.stringify(error(null,-32700,e instanceof Error?e.message:"parse error"))+"\n");
    }
  }
};
if (process.argv[1]?.endsWith("free-agent-mcp.js")) {
  main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
}
