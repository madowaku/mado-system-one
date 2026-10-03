import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import type { SystemOneProvider } from "../core/provider.js";
import { validateDecisionResponse } from "../core/provider.js";
import type {
  DecisionRequest,
  DecisionResponse,
  TypedQuestion,
  TypedResult,
} from "../core/types.js";
import type {
  ShadowAnswerSnapshot,
  ShadowCaptureMode,
  ShadowProviderSnapshot,
  ShadowQuestionComparison,
  ShadowRequestSnapshot,
  ShadowTrace,
} from "./bridge.js";

export interface MultiShadowEvidenceSink {
  write(record: MultiShadowSessionRecord): Promise<void>;
  flush?(): Promise<void>;
}

export interface MultiShadowSessionOptions {
  incumbent: SystemOneProvider;
  shadows: readonly SystemOneProvider[];
  sink: MultiShadowEvidenceSink;
  capture?: ShadowCaptureMode;
  scoreAgreementTolerance?: number;
  redactRequest?: (request: DecisionRequest) => DecisionRequest;
  onObserverError?: (error: unknown) => void;
}

export interface MultiShadowReviewItem {
  shadowProviderId: string;
  reasons: ShadowTrace["review"]["reasons"];
  candidateUse: ShadowTrace["review"]["candidateUse"];
}

export interface MultiShadowSessionRecord {
  schemaVersion: "mso.multi-shadow.v0";
  sessionId: string;
  traceId: string;
  capturedAt: string;
  mode: "multi_shadow";
  authoritativeProviderId: string;
  shadowProviderIds: readonly string[];
  shadowInfluencedExecution: false;
  labelsKnown: false;
  request?: ShadowRequestSnapshot;
  incumbent: ShadowProviderSnapshot;
  shadows: Readonly<Record<string, ShadowProviderSnapshot>>;
  pairTraces: readonly ShadowTrace[];
  summary: {
    shadowProviders: number;
    successfulShadows: number;
    failedShadows: number;
    comparableQuestions: number;
    agreements: number;
    disagreements: number;
    providersNeedingReview: number;
  };
  review: {
    needed: boolean;
    providerIds: readonly string[];
    items: readonly MultiShadowReviewItem[];
  };
}

interface ProviderRun {
  providerId: string;
  wallStartedAt: number;
  wallFinishedAt: number;
  wallLatencyMs: number;
  response?: DecisionResponse;
  error?: string;
  cause?: unknown;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const runProvider = async (
  provider: SystemOneProvider,
  request: DecisionRequest,
): Promise<ProviderRun> => {
  const started = performance.now();
  try {
    const response = await provider.decide(request);
    validateDecisionResponse(request, response);
    const finished = performance.now();
    return {
      providerId: provider.id,
      wallStartedAt: started,
      wallFinishedAt: finished,
      wallLatencyMs: finished - started,
      response,
    };
  } catch (error) {
    const finished = performance.now();
    return {
      providerId: provider.id,
      wallStartedAt: started,
      wallFinishedAt: finished,
      wallLatencyMs: finished - started,
      error: errorMessage(error),
      cause: error,
    };
  }
};

const providerSnapshot = (run: ProviderRun): ShadowProviderSnapshot => ({
  providerId: run.providerId,
  status: run.response ? "ok" : "error",
  wallLatencyMs: run.wallLatencyMs,
  ...(run.response?.modelId ? { modelId: run.response.modelId } : {}),
  ...(run.response?.latencyMs === undefined
    ? {}
    : { responseLatencyMs: run.response.latencyMs }),
  ...(run.response?.estimatedCost === undefined
    ? {}
    : { estimatedCost: run.response.estimatedCost }),
  ...(run.error ? { error: run.error } : {}),
});

const answerSnapshot = (
  result: TypedResult | undefined,
  providerError?: string,
): ShadowAnswerSnapshot => {
  if (providerError) return { status: "error", error: providerError };
  if (!result) return { status: "error", error: "missing result" };

  switch (result.type) {
    case "choice":
      return {
        status: "ok",
        answer: result.selected,
        ...(result.confidence === undefined
          ? {}
          : { confidence: result.confidence }),
      };
    case "noul":
      return {
        status: "ok",
        answer: result.probabilityYes >= 0.5,
        rawValue: result.probabilityYes,
        ...(result.confidence === undefined
          ? {}
          : { confidence: result.confidence }),
      };
    case "score":
      return {
        status: "ok",
        answer: result.expectedScore,
        rawValue: result.expectedScore,
        ...(result.confidence === undefined
          ? {}
          : { confidence: result.confidence }),
      };
  }
};

const compareQuestion = (
  questionId: string,
  question: TypedQuestion,
  incumbentRun: ProviderRun,
  shadowRun: ProviderRun,
  scoreAgreementTolerance: number,
): ShadowQuestionComparison => {
  const incumbent = answerSnapshot(
    incumbentRun.response?.results[questionId],
    incumbentRun.error,
  );
  const shadow = answerSnapshot(
    shadowRun.response?.results[questionId],
    shadowRun.error,
  );

  if (incumbent.status !== "ok" || shadow.status !== "ok") {
    return {
      questionId,
      type: question.type,
      comparable: false,
      incumbent,
      shadow,
    };
  }

  let agreement: boolean;
  let answerDelta: number | undefined;
  if (question.type === "score") {
    const incumbentValue = Number(incumbent.answer);
    const shadowValue = Number(shadow.answer);
    answerDelta = Math.abs(incumbentValue - shadowValue);
    agreement = answerDelta <= scoreAgreementTolerance;
  } else if (question.type === "noul") {
    agreement = incumbent.answer === shadow.answer;
    if (incumbent.rawValue !== undefined && shadow.rawValue !== undefined) {
      answerDelta = Math.abs(incumbent.rawValue - shadow.rawValue);
    }
  } else {
    agreement = incumbent.answer === shadow.answer;
  }

  const confidenceDelta =
    incumbent.confidence !== undefined && shadow.confidence !== undefined
      ? Math.abs(incumbent.confidence - shadow.confidence)
      : undefined;

  return {
    questionId,
    type: question.type,
    comparable: true,
    agreement,
    ...(answerDelta === undefined ? {} : { answerDelta }),
    ...(confidenceDelta === undefined ? {} : { confidenceDelta }),
    incumbent,
    shadow,
  };
};

const captureRequest = (
  request: DecisionRequest,
  mode: ShadowCaptureMode,
  redactRequest?: (request: DecisionRequest) => DecisionRequest,
): ShadowRequestSnapshot | undefined => {
  if (mode === "none") return undefined;
  const base: ShadowRequestSnapshot = {
    traceId: request.traceId,
    pattern: request.pattern,
    questionIds: Object.keys(request.questions),
    ...(request.observationId ? { observationId: request.observationId } : {}),
    ...(request.freshnessToken ? { freshnessToken: request.freshnessToken } : {}),
  };
  if (mode === "minimal") return base;

  const source = redactRequest ? redactRequest(request) : request;
  return {
    ...base,
    state: source.state,
    questions: source.questions,
    ...(source.metadata ? { metadata: source.metadata } : {}),
  };
};

const pairTrace = (
  request: DecisionRequest,
  incumbentRun: ProviderRun,
  shadowRun: ProviderRun,
  options: {
    capturedAt: string;
    capture: ShadowCaptureMode;
    scoreAgreementTolerance: number;
    requestSnapshot?: ShadowRequestSnapshot;
  },
): ShadowTrace => {
  const questions = Object.entries(request.questions).map(
    ([questionId, question]) =>
      compareQuestion(
        questionId,
        question,
        incumbentRun,
        shadowRun,
        options.scoreAgreementTolerance,
      ),
  );
  const comparable = questions.filter((item) => item.comparable);
  const agreements = comparable.filter((item) => item.agreement === true).length;
  const disagreements = comparable.length - agreements;

  const reasons: Array<
    "disagreement" | "shadow_provider_error" | "incumbent_provider_error"
  > = [];
  if (disagreements > 0) reasons.push("disagreement");
  if (shadowRun.error) reasons.push("shadow_provider_error");
  if (incumbentRun.error) reasons.push("incumbent_provider_error");

  const candidateUse =
    incumbentRun.error || shadowRun.error
      ? "provider_error_review"
      : disagreements > 0
        ? "human_label_required"
        : "none";

  return {
    schemaVersion: "mso.shadow.v0",
    traceId: request.traceId,
    capturedAt: options.capturedAt,
    mode: "shadow",
    authoritativeProviderId: incumbentRun.providerId,
    shadowProviderId: shadowRun.providerId,
    shadowInfluencedExecution: false,
    labelsKnown: false,
    ...(options.requestSnapshot ? { request: options.requestSnapshot } : {}),
    incumbent: providerSnapshot(incumbentRun),
    shadow: providerSnapshot(shadowRun),
    comparableQuestions: comparable.length,
    agreements,
    disagreements,
    agreementRate: comparable.length === 0 ? 0 : agreements / comparable.length,
    shadowLagAfterIncumbentMs: Math.max(
      0,
      shadowRun.wallFinishedAt - incumbentRun.wallFinishedAt,
    ),
    review: {
      needed: reasons.length > 0,
      reasons,
      candidateUse,
    },
    questions,
  };
};

const buildSession = (
  request: DecisionRequest,
  incumbentRun: ProviderRun,
  shadowRuns: readonly ProviderRun[],
  options: {
    capture: ShadowCaptureMode;
    scoreAgreementTolerance: number;
    redactRequest?: (request: DecisionRequest) => DecisionRequest;
  },
): MultiShadowSessionRecord => {
  const capturedAt = new Date().toISOString();
  const requestSnapshot = captureRequest(
    request,
    options.capture,
    options.redactRequest,
  );
  const pairTraces = shadowRuns.map((shadowRun) =>
    pairTrace(request, incumbentRun, shadowRun, {
      capturedAt,
      capture: options.capture,
      scoreAgreementTolerance: options.scoreAgreementTolerance,
      ...(requestSnapshot ? { requestSnapshot } : {}),
    }),
  );
  const shadows = Object.fromEntries(
    shadowRuns.map((run) => [run.providerId, providerSnapshot(run)]),
  );
  const reviewItems: MultiShadowReviewItem[] = pairTraces
    .filter((trace) => trace.review.needed)
    .map((trace) => ({
      shadowProviderId: trace.shadowProviderId,
      reasons: trace.review.reasons,
      candidateUse: trace.review.candidateUse,
    }));

  return {
    schemaVersion: "mso.multi-shadow.v0",
    sessionId: `multi-shadow:${request.traceId}`,
    traceId: request.traceId,
    capturedAt,
    mode: "multi_shadow",
    authoritativeProviderId: incumbentRun.providerId,
    shadowProviderIds: shadowRuns.map((run) => run.providerId),
    shadowInfluencedExecution: false,
    labelsKnown: false,
    ...(requestSnapshot ? { request: requestSnapshot } : {}),
    incumbent: providerSnapshot(incumbentRun),
    shadows,
    pairTraces,
    summary: {
      shadowProviders: shadowRuns.length,
      successfulShadows: shadowRuns.filter((run) => run.response).length,
      failedShadows: shadowRuns.filter((run) => !run.response).length,
      comparableQuestions: pairTraces.reduce(
        (sum, trace) => sum + trace.comparableQuestions,
        0,
      ),
      agreements: pairTraces.reduce((sum, trace) => sum + trace.agreements, 0),
      disagreements: pairTraces.reduce(
        (sum, trace) => sum + trace.disagreements,
        0,
      ),
      providersNeedingReview: reviewItems.length,
    },
    review: {
      needed: reviewItems.length > 0,
      providerIds: reviewItems.map((item) => item.shadowProviderId),
      items: reviewItems,
    },
  };
};

export class MultiShadowSession implements SystemOneProvider {
  readonly id: string;
  readonly #incumbent: SystemOneProvider;
  readonly #shadows: readonly SystemOneProvider[];
  readonly #sink: MultiShadowEvidenceSink;
  readonly #capture: ShadowCaptureMode;
  readonly #scoreAgreementTolerance: number;
  readonly #redactRequest:
    | ((request: DecisionRequest) => DecisionRequest)
    | undefined;
  readonly #onObserverError: ((error: unknown) => void) | undefined;
  readonly #inFlight = new Set<Promise<void>>();

  constructor(options: MultiShadowSessionOptions) {
    if (options.shadows.length < 2) {
      throw new Error("multi-shadow session requires at least two shadows");
    }

    const ids = [options.incumbent.id, ...options.shadows.map((item) => item.id)];
    if (new Set(ids).size !== ids.length) {
      throw new Error("multi-shadow provider ids must be unique");
    }

    const tolerance = options.scoreAgreementTolerance ?? 0.5;
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      throw new Error(
        "scoreAgreementTolerance must be a finite non-negative number",
      );
    }

    this.id = options.incumbent.id;
    this.#incumbent = options.incumbent;
    this.#shadows = [...options.shadows];
    this.#sink = options.sink;
    this.#capture = options.capture ?? "minimal";
    this.#scoreAgreementTolerance = tolerance;
    this.#redactRequest = options.redactRequest;
    this.#onObserverError = options.onObserverError;
  }

  capabilities() {
    return this.#incumbent.capabilities();
  }

  health() {
    return this.#incumbent.health
      ? this.#incumbent.health()
      : Promise.resolve({
          status: "healthy" as const,
          checkedAt: new Date().toISOString(),
          detail:
            "incumbent provider does not expose health; multi-shadow observers are non-authoritative",
        });
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    const incumbentPromise = runProvider(this.#incumbent, request);
    const shadowPromises = this.#shadows.map((provider) =>
      runProvider(provider, request),
    );

    const observer = Promise.all(shadowPromises)
      .then(async (shadowRuns) => {
        const incumbentRun = await incumbentPromise;
        const session = buildSession(request, incumbentRun, shadowRuns, {
          capture: this.#capture,
          scoreAgreementTolerance: this.#scoreAgreementTolerance,
          ...(this.#redactRequest ? { redactRequest: this.#redactRequest } : {}),
        });
        await this.#sink.write(session);
      })
      .catch((error: unknown) => {
        this.#onObserverError?.(error);
      });

    this.#track(observer);

    const incumbentRun = await incumbentPromise;
    if (!incumbentRun.response) {
      throw incumbentRun.cause instanceof Error
        ? incumbentRun.cause
        : new Error(incumbentRun.error ?? "incumbent provider failed");
    }
    return incumbentRun.response;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.#inFlight]);
    if (this.#sink.flush) await this.#sink.flush();
  }

  #track(task: Promise<void>): void {
    this.#inFlight.add(task);
    void task.finally(() => {
      this.#inFlight.delete(task);
    });
  }
}

export class MemoryMultiShadowEvidenceSink implements MultiShadowEvidenceSink {
  readonly records: MultiShadowSessionRecord[] = [];

  async write(record: MultiShadowSessionRecord): Promise<void> {
    this.records.push(record);
  }
}

export class JsonlMultiShadowEvidenceSink implements MultiShadowEvidenceSink {
  readonly path: string;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  async write(record: MultiShadowSessionRecord): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
    this.#writeChain = this.#writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, line, "utf8");
    });
    return this.#writeChain;
  }

  async flush(): Promise<void> {
    await this.#writeChain;
  }
}

export interface PartitionedMultiShadowEvidenceOptions {
  sessionPath: string;
  reviewQueuePath: string;
}

export class PartitionedMultiShadowEvidenceSink
  implements MultiShadowEvidenceSink
{
  readonly #sessionSink: JsonlMultiShadowEvidenceSink;
  readonly #reviewSink: JsonlMultiShadowEvidenceSink;

  constructor(options: PartitionedMultiShadowEvidenceOptions) {
    this.#sessionSink = new JsonlMultiShadowEvidenceSink(options.sessionPath);
    this.#reviewSink = new JsonlMultiShadowEvidenceSink(options.reviewQueuePath);
  }

  async write(record: MultiShadowSessionRecord): Promise<void> {
    await this.#sessionSink.write(record);
    if (record.review.needed) {
      await this.#reviewSink.write(record);
    }
  }

  async flush(): Promise<void> {
    await Promise.all([this.#sessionSink.flush(), this.#reviewSink.flush()]);
  }
}

export const parseMultiShadowSessionJsonl = (
  input: string,
): MultiShadowSessionRecord[] => {
  const rows: MultiShadowSessionRecord[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of input.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`multi-shadow line ${index + 1} is invalid JSON`);
    }

    if (!record(value) || value.schemaVersion !== "mso.multi-shadow.v0") {
      throw new Error(
        `multi-shadow line ${index + 1} must use schemaVersion mso.multi-shadow.v0`,
      );
    }

    const sessionId = text(
      value.sessionId,
      `multi-shadow line ${index + 1}.sessionId`,
    );
    if (seen.has(sessionId)) {
      throw new Error(`duplicate multi-shadow sessionId: ${sessionId}`);
    }
    seen.add(sessionId);

    if (!Array.isArray(value.pairTraces)) {
      throw new Error(
        `multi-shadow line ${index + 1}.pairTraces must be an array`,
      );
    }

    rows.push(value as unknown as MultiShadowSessionRecord);
  }

  return rows;
};

export const extractShadowTracesForProvider = (
  sessions: readonly MultiShadowSessionRecord[],
  shadowProviderId: string,
): ShadowTrace[] => {
  if (!shadowProviderId) {
    throw new Error("shadowProviderId must be non-empty");
  }

  const traces: ShadowTrace[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    const pair = session.pairTraces.find(
      (item) => item.shadowProviderId === shadowProviderId,
    );
    if (!pair) continue;
    if (seen.has(pair.traceId)) {
      throw new Error(
        `duplicate traceId for shadow provider ${shadowProviderId}: ${pair.traceId}`,
      );
    }
    seen.add(pair.traceId);
    traces.push(pair);
  }
  return traces;
};

export const writeExtractedShadowTraces = async (
  path: string,
  traces: readonly ShadowTrace[],
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const body =
    traces.length === 0
      ? ""
      : `${traces.map((trace) => JSON.stringify(trace)).join("\n")}\n`;
  await writeFile(path, body, "utf8");
};
