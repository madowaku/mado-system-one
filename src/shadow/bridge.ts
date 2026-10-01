import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import type { SystemOneProvider } from "../core/provider.js";
import { validateDecisionResponse } from "../core/provider.js";
import type {
  DecisionRequest,
  DecisionResponse,
  SystemOnePattern,
  TypedQuestion,
  TypedResult,
} from "../core/types.js";

export type ShadowCaptureMode = "none" | "minimal" | "full";

export interface ShadowEvidenceSink {
  write(record: ShadowTrace): Promise<void>;
  flush?(): Promise<void>;
}

export interface ShadowBridgeOptions {
  incumbent: SystemOneProvider;
  shadow: SystemOneProvider;
  sink: ShadowEvidenceSink;
  capture?: ShadowCaptureMode;
  scoreAgreementTolerance?: number;
  redactRequest?: (request: DecisionRequest) => DecisionRequest;
  onObserverError?: (error: unknown) => void;
}

export interface ShadowRequestSnapshot {
  traceId: string;
  pattern: SystemOnePattern;
  questionIds: readonly string[];
  observationId?: string;
  freshnessToken?: string;
  state?: string;
  questions?: Readonly<Record<string, TypedQuestion>>;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ShadowProviderSnapshot {
  providerId: string;
  status: "ok" | "error";
  modelId?: string;
  responseLatencyMs?: number;
  wallLatencyMs: number;
  estimatedCost?: number;
  error?: string;
}

export interface ShadowAnswerSnapshot {
  status: "ok" | "error";
  answer?: string | boolean | number | null;
  rawValue?: number;
  confidence?: number;
  error?: string;
}

export interface ShadowQuestionComparison {
  questionId: string;
  type: "choice" | "noul" | "score";
  comparable: boolean;
  agreement?: boolean;
  answerDelta?: number;
  confidenceDelta?: number;
  incumbent: ShadowAnswerSnapshot;
  shadow: ShadowAnswerSnapshot;
}

export interface ShadowTrace {
  schemaVersion: "mso.shadow.v0";
  traceId: string;
  capturedAt: string;
  mode: "shadow";
  authoritativeProviderId: string;
  shadowProviderId: string;
  shadowInfluencedExecution: false;
  labelsKnown: false;
  request?: ShadowRequestSnapshot;
  incumbent: ShadowProviderSnapshot;
  shadow: ShadowProviderSnapshot;
  comparableQuestions: number;
  agreements: number;
  disagreements: number;
  agreementRate: number;
  shadowLagAfterIncumbentMs: number;
  review: {
    needed: boolean;
    reasons: readonly (
      | "disagreement"
      | "shadow_provider_error"
      | "incumbent_provider_error"
    )[];
    candidateUse: "human_label_required" | "provider_error_review" | "none";
  };
  questions: readonly ShadowQuestionComparison[];
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

const providerSnapshot = (run: ProviderRun): ShadowProviderSnapshot => {
  const response = run.response;
  return {
    providerId: run.providerId,
    status: response ? "ok" : "error",
    wallLatencyMs: run.wallLatencyMs,
    ...(response?.modelId ? { modelId: response.modelId } : {}),
    ...(response?.latencyMs === undefined
      ? {}
      : { responseLatencyMs: response.latencyMs }),
    ...(response?.estimatedCost === undefined
      ? {}
      : { estimatedCost: response.estimatedCost }),
    ...(run.error ? { error: run.error } : {}),
  };
};

const answerSnapshot = (
  result: TypedResult | undefined,
  providerError?: string,
): ShadowAnswerSnapshot => {
  if (providerError) {
    return { status: "error", error: providerError };
  }
  if (!result) {
    return { status: "error", error: "missing result" };
  }

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

const buildTrace = (
  request: DecisionRequest,
  incumbentRun: ProviderRun,
  shadowRun: ProviderRun,
  options: {
    capture: ShadowCaptureMode;
    scoreAgreementTolerance: number;
    redactRequest?: (request: DecisionRequest) => DecisionRequest;
  },
): ShadowTrace => {
  const questions = Object.entries(request.questions).map(([questionId, question]) =>
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

  const requestSnapshot = captureRequest(
    request,
    options.capture,
    options.redactRequest,
  );

  return {
    schemaVersion: "mso.shadow.v0",
    traceId: request.traceId,
    capturedAt: new Date().toISOString(),
    mode: "shadow",
    authoritativeProviderId: incumbentRun.providerId,
    shadowProviderId: shadowRun.providerId,
    shadowInfluencedExecution: false,
    labelsKnown: false,
    ...(requestSnapshot ? { request: requestSnapshot } : {}),
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

export class ShadowBridge implements SystemOneProvider {
  readonly id: string;
  readonly #incumbent: SystemOneProvider;
  readonly #shadow: SystemOneProvider;
  readonly #sink: ShadowEvidenceSink;
  readonly #capture: ShadowCaptureMode;
  readonly #scoreAgreementTolerance: number;
  readonly #redactRequest:
    | ((request: DecisionRequest) => DecisionRequest)
    | undefined;
  readonly #onObserverError: ((error: unknown) => void) | undefined;
  readonly #inFlight = new Set<Promise<void>>();

  constructor(options: ShadowBridgeOptions) {
    if (options.incumbent.id === options.shadow.id) {
      throw new Error("shadow bridge requires distinct provider ids");
    }
    const tolerance = options.scoreAgreementTolerance ?? 0.5;
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      throw new Error(
        "scoreAgreementTolerance must be a finite non-negative number",
      );
    }

    this.id = options.incumbent.id;
    this.#incumbent = options.incumbent;
    this.#shadow = options.shadow;
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
          detail: "incumbent provider does not expose health; shadow is non-authoritative",
        });
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    const incumbentPromise = runProvider(this.#incumbent, request);
    const shadowPromise = runProvider(this.#shadow, request);

    const observer = Promise.all([incumbentPromise, shadowPromise])
      .then(async ([incumbentRun, shadowRun]) => {
        const trace = buildTrace(request, incumbentRun, shadowRun, {
          capture: this.#capture,
          scoreAgreementTolerance: this.#scoreAgreementTolerance,
          ...(this.#redactRequest ? { redactRequest: this.#redactRequest } : {}),
        });
        await this.#sink.write(trace);
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

export class MemoryShadowEvidenceSink implements ShadowEvidenceSink {
  readonly records: ShadowTrace[] = [];

  async write(record: ShadowTrace): Promise<void> {
    this.records.push(record);
  }
}

export class JsonlShadowEvidenceSink implements ShadowEvidenceSink {
  readonly path: string;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  async write(record: ShadowTrace): Promise<void> {
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


export interface PartitionedShadowEvidenceOptions {
  tracePath: string;
  reviewQueuePath: string;
}

export class PartitionedShadowEvidenceSink implements ShadowEvidenceSink {
  readonly #traceSink: JsonlShadowEvidenceSink;
  readonly #reviewSink: JsonlShadowEvidenceSink;

  constructor(options: PartitionedShadowEvidenceOptions) {
    this.#traceSink = new JsonlShadowEvidenceSink(options.tracePath);
    this.#reviewSink = new JsonlShadowEvidenceSink(options.reviewQueuePath);
  }

  async write(record: ShadowTrace): Promise<void> {
    await this.#traceSink.write(record);
    if (record.review.needed) {
      await this.#reviewSink.write(record);
    }
  }

  async flush(): Promise<void> {
    await Promise.all([this.#traceSink.flush(), this.#reviewSink.flush()]);
  }
}
