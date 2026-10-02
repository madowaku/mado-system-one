import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import type { SystemOneProvider } from "../core/provider.js";
import { validateDecisionResponse } from "../core/provider.js";
import type { DecisionRequest, DecisionResponse, ProviderCapabilities, SystemOnePattern, TypedQuestion, TypedResult } from "../core/types.js";

export type EvalExpected =
  | { type: "choice"; selected: string | null }
  | { type: "noul"; yes: boolean; threshold?: number }
  | { type: "score"; value: number; tolerance?: number };

export interface EvalReplay { results: Readonly<Record<string, TypedResult>>; modelId?: string; latencyMs?: number; estimatedCost?: number; }
export interface EvalCase { caseId: string; taskFamily: string; pattern: SystemOnePattern; state: string; questions: Readonly<Record<string, TypedQuestion>>; expected: Readonly<Record<string, EvalExpected>>; tags?: readonly string[]; language?: string; replay?: EvalReplay; }
export interface EvalQuestionJudgement { questionId: string; type: EvalExpected["type"]; correct: boolean; detail?: string; }
export interface EvalCaseResult { caseId: string; taskFamily: string; traceId: string; correct: boolean; judgements: readonly EvalQuestionJudgement[]; measuredLatencyMs: number; response?: DecisionResponse; error?: string; }
export interface EvalMetrics { cases: number; correctCases: number; caseAccuracy: number; questions: number; correctQuestions: number; accuracy: number; providerErrors: number; latencyP50Ms: number; latencyP95Ms: number; totalEstimatedCost: number; }
export interface EvalRun { schemaVersion: "mso.eval.v0"; runId: string; datasetId: string; providerId: string; startedAt: string; completedAt: string; providerCapabilities: ProviderCapabilities; metrics: EvalMetrics; cases: readonly EvalCaseResult[]; }
export interface EvalRunOptions { runId?: string; datasetId: string; now?: () => Date; }
export interface ReplayRecord { traceId: string; results: DecisionResponse["results"]; modelId?: string; latencyMs?: number; estimatedCost?: number; }

export class EvalFixtureError extends Error { constructor(message: string) { super(message); this.name = "EvalFixtureError"; } }
const patterns = new Set<SystemOnePattern>(["route","compute","rank","gate","act","score","abstain","sieve","walk","verify"]);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, label: string): string => { if (typeof value !== "string" || !value) throw new EvalFixtureError(`${label} must be a non-empty string`); return value; };
const num = (value: unknown, label: string): number => { if (typeof value !== "number" || !Number.isFinite(value)) throw new EvalFixtureError(`${label} must be finite`); return value; };

const question = (value: unknown, label: string): TypedQuestion => {
  if (!record(value)) throw new EvalFixtureError(`${label} must be an object`);
  const type = str(value.type, `${label}.type`); const prompt = str(value.prompt, `${label}.prompt`);
  if (type === "noul") return { type, prompt };
  if (type === "score") {
    let labels: Record<number, string> | undefined;
    if (value.labels !== undefined) {
      if (!record(value.labels)) {
        throw new EvalFixtureError(`${label}.labels must be an object`);
      }
      labels = {};
      for (const [key, rawLabel] of Object.entries(value.labels)) {
        const numericKey = Number(key);
        if (!Number.isFinite(numericKey)) {
          throw new EvalFixtureError(`${label}.labels key must be numeric: ${key}`);
        }
        labels[numericKey] = str(rawLabel, `${label}.labels.${key}`);
      }
    }
    return {
      type,
      prompt,
      min: num(value.min, `${label}.min`),
      max: num(value.max, `${label}.max`),
      ...(labels ? { labels } : {}),
    };
  }
  if (type === "choice") {
    if (!Array.isArray(value.options) || value.options.length === 0) {
      throw new EvalFixtureError(`${label}.options must be non-empty`);
    }
    return {
      type,
      prompt,
      options: value.options.map((item, index) => {
        if (!record(item)) {
          throw new EvalFixtureError(`${label}.options[${index}] must be an object`);
        }
        return {
          id: str(item.id, `${label}.options[${index}].id`),
          label: str(item.label, `${label}.options[${index}].label`),
          ...(typeof item.description === "string"
            ? { description: item.description }
            : {}),
        };
      }),
    };
  }
  throw new EvalFixtureError(`${label}.type unsupported: ${type}`);
};

const expected = (value: unknown, q: TypedQuestion, label: string): EvalExpected => {
  if (!record(value) || value.type !== q.type) throw new EvalFixtureError(`${label}.type must match ${q.type}`);
  if (q.type === "choice") { const selected = value.selected; if (selected !== null && typeof selected !== "string") throw new EvalFixtureError(`${label}.selected must be string|null`); if (typeof selected === "string" && !q.options.some(o => o.id === selected)) throw new EvalFixtureError(`${label}.selected unknown option`); return { type: "choice", selected }; }
  if (q.type === "noul") { if (typeof value.yes !== "boolean") throw new EvalFixtureError(`${label}.yes must be boolean`); return { type: "noul", yes: value.yes, ...(value.threshold === undefined ? {} : { threshold: num(value.threshold, `${label}.threshold`) }) }; }
  return { type: "score", value: num(value.value, `${label}.value`), ...(value.tolerance === undefined ? {} : { tolerance: num(value.tolerance, `${label}.tolerance`) }) };
};

const result = (value: unknown, q: TypedQuestion, label: string): TypedResult => {
  if (!record(value) || value.type !== q.type) throw new EvalFixtureError(`${label}.type must match ${q.type}`);
  if (q.type === "noul") return {
    type: "noul",
    probabilityYes: num(value.probabilityYes, `${label}.probabilityYes`),
    ...(typeof value.confidence === "number" ? { confidence: value.confidence } : {}),
  };
  if (q.type === "score") return {
    type: "score",
    expectedScore: num(value.expectedScore, `${label}.expectedScore`),
    ...(Array.isArray(value.distribution)
      ? { distribution: value.distribution.map((item, index) => num(item, `${label}.distribution[${index}]`)) }
      : {}),
    ...(typeof value.confidence === "number" ? { confidence: value.confidence } : {}),
  };
  const selected = value.selected; if (selected !== null && typeof selected !== "string") throw new EvalFixtureError(`${label}.selected must be string|null`); if (!record(value.distribution)) throw new EvalFixtureError(`${label}.distribution must be object`);
  const distribution: Record<string, number> = {}; for (const [id, p] of Object.entries(value.distribution)) distribution[id] = num(p, `${label}.distribution.${id}`);
  return { type: "choice", selected, distribution, ...(typeof value.confidence === "number" ? { confidence: value.confidence } : {}) };
};

export const parseEvalJsonl = (text: string): EvalCase[] => {
  const out: EvalCase[] = []; const seen = new Set<string>();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim(); if (!line || line.startsWith("#")) continue;
    let data: unknown; try { data = JSON.parse(line); } catch { throw new EvalFixtureError(`line ${index + 1} is invalid JSON`); }
    if (!record(data)) throw new EvalFixtureError(`line ${index + 1} must be object`);
    const caseId = str(data.caseId, `line ${index + 1}.caseId`); if (seen.has(caseId)) throw new EvalFixtureError(`duplicate caseId: ${caseId}`); seen.add(caseId);
    const pattern = str(data.pattern, `line ${index + 1}.pattern`) as SystemOnePattern; if (!patterns.has(pattern)) throw new EvalFixtureError(`unsupported pattern: ${pattern}`);
    if (!record(data.questions) || !record(data.expected)) throw new EvalFixtureError(`line ${index + 1} questions/expected must be objects`);
    const questions: Record<string, TypedQuestion> = {}; const answers: Record<string, EvalExpected> = {};
    for (const [id, rawQ] of Object.entries(data.questions)) { const q = question(rawQ, `line ${index + 1}.questions.${id}`); questions[id] = q; answers[id] = expected(data.expected[id], q, `line ${index + 1}.expected.${id}`); }
    let replay: EvalReplay | undefined;
    if (data.replay !== undefined) { if (!record(data.replay) || !record(data.replay.results)) throw new EvalFixtureError(`line ${index + 1}.replay.results must be object`); const results: Record<string, TypedResult> = {}; for (const [id, q] of Object.entries(questions)) results[id] = result(data.replay.results[id], q, `line ${index + 1}.replay.results.${id}`); replay = { results, ...(typeof data.replay.modelId === "string" ? { modelId: data.replay.modelId } : {}), ...(typeof data.replay.latencyMs === "number" ? { latencyMs: data.replay.latencyMs } : {}), ...(typeof data.replay.estimatedCost === "number" ? { estimatedCost: data.replay.estimatedCost } : {}) }; }
    out.push({ caseId, taskFamily: str(data.taskFamily, `line ${index + 1}.taskFamily`), pattern, state: str(data.state, `line ${index + 1}.state`), questions, expected: answers, ...(Array.isArray(data.tags) ? { tags: data.tags.map((tag, i) => str(tag, `line ${index + 1}.tags[${i}]`)) } : {}), ...(typeof data.language === "string" ? { language: data.language } : {}), ...(replay ? { replay } : {}) });
  }
  if (out.length === 0) throw new EvalFixtureError("fixture contains no cases"); return out;
};

export const evalTraceId = (caseId: string): string => `eval:${caseId}`;
export const replayRecordsFromCases = (cases: readonly EvalCase[]): ReplayRecord[] => cases.map(c => { if (!c.replay) throw new Error(`eval case ${c.caseId} has no replay payload`); return { traceId: evalTraceId(c.caseId), results: c.replay.results, ...(c.replay.modelId ? { modelId: c.replay.modelId } : {}), ...(c.replay.latencyMs === undefined ? {} : { latencyMs: c.replay.latencyMs }), ...(c.replay.estimatedCost === undefined ? {} : { estimatedCost: c.replay.estimatedCost }) }; });
const requestFor = (c: EvalCase): DecisionRequest => ({ traceId: evalTraceId(c.caseId), pattern: c.pattern, state: c.state, questions: c.questions, metadata: { evalCaseId: c.caseId, taskFamily: c.taskFamily } });

const judge = (id: string, want: EvalExpected, got: TypedResult): EvalQuestionJudgement => {
  if (want.type !== got.type) return { questionId: id, type: want.type, correct: false, detail: `type mismatch ${got.type}` };
  if (want.type === "choice" && got.type === "choice") return { questionId: id, type: "choice", correct: want.selected === got.selected };
  if (want.type === "noul" && got.type === "noul") return { questionId: id, type: "noul", correct: (got.probabilityYes >= (want.threshold ?? 0.5)) === want.yes };
  if (want.type === "score" && got.type === "score") return { questionId: id, type: "score", correct: Math.abs(got.expectedScore - want.value) <= (want.tolerance ?? 0) };
  return { questionId: id, type: want.type, correct: false };
};
const pct = (values: readonly number[], q: number): number => { if (!values.length) return 0; const sorted = [...values].sort((a,b)=>a-b); return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0; };
const metrics = (cases: readonly EvalCaseResult[]): EvalMetrics => { const questions = cases.reduce((n,c)=>n+c.judgements.length,0); const correctQuestions = cases.reduce((n,c)=>n+c.judgements.filter(j=>j.correct).length,0); const correctCases = cases.filter(c=>c.correct).length; return { cases: cases.length, correctCases, caseAccuracy: cases.length ? correctCases/cases.length : 0, questions, correctQuestions, accuracy: questions ? correctQuestions/questions : 0, providerErrors: cases.filter(c=>c.error).length, latencyP50Ms: pct(cases.map(c=>c.measuredLatencyMs),0.5), latencyP95Ms: pct(cases.map(c=>c.measuredLatencyMs),0.95), totalEstimatedCost: cases.reduce((n,c)=>n+(c.response?.estimatedCost ?? 0),0) }; };

export const runEval = async (provider: SystemOneProvider, cases: readonly EvalCase[], options: EvalRunOptions): Promise<EvalRun> => {
  const now = options.now ?? (()=>new Date()); const started = now(); const rows: EvalCaseResult[] = [];
  for (const c of cases) { const request = requestFor(c); const t0 = performance.now(); try { const response = await provider.decide(request); validateDecisionResponse(request,response); const judgements = Object.entries(c.expected).map(([id,want]) => { const got = response.results[id]; return got ? judge(id,want,got) : { questionId:id,type:want.type,correct:false,detail:"missing result" }; }); rows.push({ caseId:c.caseId, taskFamily:c.taskFamily, traceId:request.traceId, correct:judgements.every(j=>j.correct), judgements, measuredLatencyMs:performance.now()-t0, response }); } catch (error) { const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error); rows.push({ caseId:c.caseId, taskFamily:c.taskFamily, traceId:request.traceId, correct:false, judgements:Object.entries(c.expected).map(([id,want])=>({questionId:id,type:want.type,correct:false,detail:`provider error: ${message}`})), measuredLatencyMs:performance.now()-t0, error:message }); } }
  const completed = now(); return { schemaVersion:"mso.eval.v0", runId:options.runId ?? `eval-${started.toISOString().replace(/[:.]/g,"-")}`, datasetId:options.datasetId, providerId:provider.id, startedAt:started.toISOString(), completedAt:completed.toISOString(), providerCapabilities:provider.capabilities(), metrics:metrics(rows), cases:rows };
};
export const writeEvalEvidence = async (path: string, run: EvalRun): Promise<void> => { await mkdir(dirname(path), {recursive:true}); await writeFile(path, `${JSON.stringify(run,null,2)}\n`, "utf8"); };
