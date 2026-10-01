import type { SystemOneProvider } from "../core/provider.js";
import { validateDecisionResponse } from "../core/provider.js";
import type {
  ChoiceQuestion,
  DecisionRequest,
  DecisionResponse,
  NoulQuestion,
  ProviderCapabilities,
  ProviderHealth,
  ScoreQuestion,
  TypedQuestion,
  TypedResult,
} from "../core/types.js";

export interface LayaQuestionDef {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: Record<string, string> | readonly string[];
}

export interface LayaChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Readonly<Record<string, number>>;
  answer_confidence: number;
  confidence?: number;
  low_confidence?: boolean;
}

export interface LayaScoreAnswer {
  type: "score";
  score: number;
  probabilities?: Readonly<Record<string, number>>;
  answer_confidence: number;
  confidence?: number;
  low_confidence?: boolean;
}

export interface LayaNoulAnswer {
  type: "noul";
  noul: number;
  answer_confidence: number;
  confidence?: number;
  low_confidence?: boolean;
}

export type LayaAnswer = LayaChoiceAnswer | LayaScoreAnswer | LayaNoulAnswer;

export interface LayaPredictResult {
  model?: string;
  answers: Readonly<Record<string, LayaAnswer>>;
  routing?: Readonly<Record<string, unknown>>;
  usage?: Readonly<Record<string, unknown>>;
}

export interface LayaRunner {
  predict(
    state: unknown,
    questions: Readonly<Record<string, LayaQuestionDef>>,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<LayaPredictResult>;
}

export interface LayaProviderOptions {
  runner: LayaRunner;
  id?: string;
  model?: string;
  language?: string;
  minConfidence?: number;
}

const finite = (value: number, label: string): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
};

const probability = (value: number, label: string): number => {
  finite(value, label);
  if (value < 0 || value > 1) {
    throw new Error(`${label} must be in [0, 1]`);
  }
  return value;
};

const choiceQuestion = (question: ChoiceQuestion): LayaQuestionDef => ({
  type: "choice",
  instructions: question.prompt,
  criteria: Object.fromEntries(
    question.options.map((option) => [
      option.id,
      option.description ?? option.label,
    ]),
  ),
});

const scoreLevels = (question: ScoreQuestion): string[] => {
  if (!Number.isInteger(question.min) || !Number.isInteger(question.max)) {
    throw new Error(
      `Laya score adapter requires integer bounds; got [${question.min}, ${question.max}]`,
    );
  }
  if (question.max < question.min) {
    throw new Error("Laya score adapter requires max >= min");
  }
  const count = question.max - question.min + 1;
  if (count < 2) {
    throw new Error("Laya score adapter requires at least two levels");
  }
  if (count > 64) {
    throw new Error(`Laya score adapter refuses ${count} levels; max is 64`);
  }

  return Array.from({ length: count }, (_, index) => {
    const value = question.min + index;
    return question.labels?.[value] ?? String(value);
  });
};

const scoreQuestion = (question: ScoreQuestion): LayaQuestionDef => ({
  type: "score",
  instructions: question.prompt,
  criteria: scoreLevels(question),
});

const noulQuestion = (question: NoulQuestion): LayaQuestionDef => ({
  type: "noul",
  instructions: question.prompt,
});

export const toLayaQuestions = (
  questions: Readonly<Record<string, TypedQuestion>>,
): Record<string, LayaQuestionDef> => {
  const out: Record<string, LayaQuestionDef> = {};
  for (const [id, question] of Object.entries(questions)) {
    switch (question.type) {
      case "choice":
        out[id] = choiceQuestion(question);
        break;
      case "score":
        out[id] = scoreQuestion(question);
        break;
      case "noul":
        out[id] = noulQuestion(question);
        break;
    }
  }
  return out;
};

const normalizeDistribution = (
  values: Readonly<Record<string, number>>,
  label: string,
): Record<string, number> => {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    throw new Error(`${label} probabilities must not be empty`);
  }
  let total = 0;
  const out: Record<string, number> = {};
  for (const [key, raw] of entries) {
    const value = probability(raw, `${label}.${key}`);
    out[key] = value;
    total += value;
  }
  if (total <= 0) {
    throw new Error(`${label} probabilities must have positive mass`);
  }
  for (const key of Object.keys(out)) {
    out[key] = (out[key] ?? 0) / total;
  }
  return out;
};

const fromChoice = (
  question: ChoiceQuestion,
  answer: LayaChoiceAnswer,
  id: string,
): TypedResult => {
  const allowed = new Set(question.options.map((option) => option.id));
  if (!allowed.has(answer.choice)) {
    throw new Error(`Laya answer for ${id} selected unknown option: ${answer.choice}`);
  }
  const distribution = normalizeDistribution(answer.probabilities, `${id}.probabilities`);
  for (const key of Object.keys(distribution)) {
    if (!allowed.has(key)) {
      throw new Error(`Laya answer for ${id} contains unknown probability key: ${key}`);
    }
  }
  for (const option of question.options) {
    if (!(option.id in distribution)) {
      distribution[option.id] = 0;
    }
  }
  return {
    type: "choice",
    selected: answer.choice,
    distribution,
    confidence: probability(answer.answer_confidence, `${id}.answer_confidence`),
    ...(answer.low_confidence === undefined ? {} : { abstained: answer.low_confidence }),
  };
};

const fromScore = (
  question: ScoreQuestion,
  answer: LayaScoreAnswer,
  id: string,
): TypedResult => {
  const rawScore = finite(answer.score, `${id}.score`);
  const expectedScore = question.min + rawScore;
  if (expectedScore < question.min || expectedScore > question.max) {
    throw new Error(
      `Laya score for ${id} maps outside [${question.min}, ${question.max}]: ${expectedScore}`,
    );
  }

  const distribution = answer.probabilities
    ? Array.from({ length: question.max - question.min + 1 }, (_, index) => {
        const value = answer.probabilities?.[String(index)] ?? 0;
        return probability(value, `${id}.probabilities.${index}`);
      })
    : undefined;

  return {
    type: "score",
    expectedScore,
    ...(distribution ? { distribution } : {}),
  };
};

const fromNoul = (answer: LayaNoulAnswer, id: string): TypedResult => ({
  type: "noul",
  probabilityYes: probability(answer.noul, `${id}.noul`),
});

export const fromLayaAnswers = (
  questions: Readonly<Record<string, TypedQuestion>>,
  answers: Readonly<Record<string, LayaAnswer>>,
): Record<string, TypedResult> => {
  const out: Record<string, TypedResult> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = answers[id];
    if (!answer) {
      throw new Error(`Laya result missing answer for question: ${id}`);
    }
    if (answer.type !== question.type) {
      throw new Error(
        `Laya answer type mismatch for ${id}: expected ${question.type}, got ${answer.type}`,
      );
    }

    switch (question.type) {
      case "choice":
        out[id] = fromChoice(question, answer as LayaChoiceAnswer, id);
        break;
      case "score":
        out[id] = fromScore(question, answer as LayaScoreAnswer, id);
        break;
      case "noul":
        out[id] = fromNoul(answer as LayaNoulAnswer, id);
        break;
    }
  }
  return out;
};

export class LayaSystemOneProvider implements SystemOneProvider {
  readonly id: string;
  readonly #runner: LayaRunner;
  readonly #model: string | undefined;
  readonly #language: string | undefined;
  readonly #minConfidence: number | undefined;

  constructor(options: LayaProviderOptions) {
    this.id = options.id ?? "laya";
    this.#runner = options.runner;
    this.#model = options.model;
    this.#language = options.language;
    this.#minConfidence = options.minConfidence;
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    const started = performance.now();
    const options: Record<string, unknown> = {};
    if (this.#model) options.model = this.#model;
    if (this.#language) options.lang = this.#language;
    if (this.#minConfidence !== undefined) {
      options.minConfidence = probability(this.#minConfidence, "minConfidence");
    }

    const raw = await this.#runner.predict(
      request.state,
      toLayaQuestions(request.questions),
      options,
    );
    const response: DecisionResponse = {
      traceId: request.traceId,
      providerId: this.id,
      ...(raw.model ? { modelId: raw.model } : {}),
      probabilitySemantics: "direct_logits",
      confidenceSemantics: "selected_probability",
      calibrationStatus: "unknown",
      results: fromLayaAnswers(request.questions, raw.answers),
      latencyMs: performance.now() - started,
      estimatedCost: 0,
      metadata: {
        ...(raw.routing ? { routing: raw.routing } : {}),
        ...(raw.usage ? { usage: raw.usage } : {}),
      },
    };
    validateDecisionResponse(request, response);
    return response;
  }

  capabilities(): ProviderCapabilities {
    return {
      primitives: ["choice", "noul", "score"],
      modalities: ["text"],
      inferenceFamily: "encoder_scoring",
      specialization: "general",
      probabilitySemantics: "direct_logits",
      confidenceSemantics: "selected_probability",
      calibration: {
        status: "unknown",
        notes:
          "Laya answer_confidence is preserved as selected probability; calibrate on MADO workload before gating.",
      },
      supportsBatch: true,
      supportsAdaptiveReads: false,
      patternSupport: {
        route: { status: "experimental" },
        rank: { status: "experimental" },
        gate: { status: "experimental" },
        score: { status: "experimental" },
        verify: { status: "experimental" },
      },
    };
  }

  async health(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      detail: "Laya runner injected; first live predict performs model load if needed",
    };
  }
}

export interface LayaTsRouterOptions {
  model?: string;
  language?: string;
  minConfidence?: number;
  routerOptions?: Readonly<Record<string, unknown>>;
}

export const createLayaTsProvider = async (
  options: LayaTsRouterOptions = {},
): Promise<LayaSystemOneProvider> => {
  const specifier = "laya-ts";
  let module: unknown;
  try {
    module = await import(specifier);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `laya-ts is not installed. Install it in the project before live Laya eval. Import failed: ${detail}`,
    );
  }

  if (
    typeof module !== "object" ||
    module === null ||
    !("Router" in module) ||
    typeof (module as { Router?: unknown }).Router !== "function"
  ) {
    throw new Error("laya-ts module does not export Router");
  }

  const RouterCtor = (module as {
    Router: new (opts?: Record<string, unknown>) => LayaRunner;
  }).Router;
  const runner = new RouterCtor({ ...(options.routerOptions ?? {}) });

  return new LayaSystemOneProvider({
    runner,
    ...(options.model ? { model: options.model } : {}),
    ...(options.language ? { language: options.language } : {}),
    ...(options.minConfidence === undefined
      ? {}
      : { minConfidence: options.minConfidence }),
  });
};
