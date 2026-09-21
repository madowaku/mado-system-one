import {
  TypeSafeClient,
  choice as typesafeChoice,
  noul as typesafeNoul,
  score as typesafeScore,
} from "@typesafe-ai/sdk";

import type { SystemOneProvider } from "../core/provider.js";
import { validateDecisionResponse } from "../core/provider.js";
import type {
  ChoiceQuestion,
  ChoiceResult,
  DecisionRequest,
  DecisionResponse,
  NoulQuestion,
  NoulResult,
  ProviderCapabilities,
  ScoreQuestion,
  ScoreResult,
  TypedQuestion,
  TypedResult,
} from "../core/types.js";

export const MADO_ABSTAIN_OPTION_ID = "__MADO_ABSTAIN__";

interface TypeSafeRawNoulAnswer {
  type: "noul";
  noul: number;
}

interface TypeSafeRawChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Readonly<Record<string, number>>;
}

interface TypeSafeRawScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  probabilities: Readonly<Record<string, number>>;
}

type TypeSafeRawAnswer =
  | TypeSafeRawNoulAnswer
  | TypeSafeRawChoiceAnswer
  | TypeSafeRawScoreAnswer;

export interface TypeSafeSystemOneResponse {
  model: string;
  answers: Readonly<Record<string, TypeSafeRawAnswer>>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface TypeSafeSystemOneClient {
  systemOne(
    request: {
      state: string;
      questions: Readonly<Record<string, unknown>>;
      model?: string;
    },
    options?: {
      timeout?: number;
    },
  ): Promise<TypeSafeSystemOneResponse>;
}

export interface TypeSafeJevProviderOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
  client?: TypeSafeSystemOneClient;
}

export class TypeSafeJevProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TypeSafeJevProviderError";
  }
}

const assertSupportedChoice = (questionId: string, question: ChoiceQuestion): void => {
  if (question.options.length === 0) {
    throw new TypeSafeJevProviderError(
      `choice question "${questionId}" must contain at least one option`,
    );
  }

  if (question.maxSelections !== undefined && question.maxSelections !== 1) {
    throw new TypeSafeJevProviderError(
      `choice question "${questionId}" requests maxSelections=${question.maxSelections}; TypeSafe Jev adapter currently supports exactly one selection`,
    );
  }

  if (question.options.some((option) => option.id === MADO_ABSTAIN_OPTION_ID)) {
    throw new TypeSafeJevProviderError(
      `choice question "${questionId}" uses reserved option id ${MADO_ABSTAIN_OPTION_ID}`,
    );
  }
};

const toTypeSafeChoice = (questionId: string, question: ChoiceQuestion): unknown => {
  assertSupportedChoice(questionId, question);

  const criteria: Record<string, string | null> = Object.fromEntries(
    question.options.map((option) => [option.id, option.description ?? option.label]),
  );

  if (question.allowAbstain) {
    criteria[MADO_ABSTAIN_OPTION_ID] =
      "None of the listed options is a sufficiently good fit. Choose this instead of forcing a weak candidate.";
  }

  return typesafeChoice(question.prompt, criteria);
};

const toTypeSafeNoul = (question: NoulQuestion): unknown =>
  typesafeNoul(question.prompt);

const toTypeSafeScore = (questionId: string, question: ScoreQuestion): unknown => {
  if (!Number.isInteger(question.min) || !Number.isInteger(question.max)) {
    throw new TypeSafeJevProviderError(
      `score question "${questionId}" requires integer min/max for the TypeSafe adapter`,
    );
  }

  if (question.max <= question.min) {
    throw new TypeSafeJevProviderError(
      `score question "${questionId}" requires max > min for the TypeSafe adapter`,
    );
  }

  const criteria = Array.from(
    { length: question.max - question.min + 1 },
    (_, index) => {
      const scoreValue = question.min + index;
      return question.labels?.[scoreValue] ?? `Score ${scoreValue}`;
    },
  ) as [string, string, ...string[]];

  return typesafeScore(question.prompt, criteria);
};

const toTypeSafeQuestion = (questionId: string, question: TypedQuestion): unknown => {
  switch (question.type) {
    case "choice":
      return toTypeSafeChoice(questionId, question);
    case "noul":
      return toTypeSafeNoul(question);
    case "score":
      return toTypeSafeScore(questionId, question);
  }
};

const assertAnswerType = (
  questionId: string,
  question: TypedQuestion,
  answer: TypeSafeRawAnswer | undefined,
): TypeSafeRawAnswer => {
  if (!answer) {
    throw new TypeSafeJevProviderError(`missing TypeSafe answer for question: ${questionId}`);
  }

  if (answer.type !== question.type) {
    throw new TypeSafeJevProviderError(
      `TypeSafe answer type mismatch for "${questionId}": expected ${question.type}, got ${answer.type}`,
    );
  }

  return answer;
};

const fromTypeSafeChoice = (
  question: ChoiceQuestion,
  answer: TypeSafeRawChoiceAnswer,
): ChoiceResult => {
  const distribution: Record<string, number> = Object.fromEntries(
    question.options.map((option) => [option.id, answer.probabilities[option.id] ?? 0]),
  );

  const abstainProbability = question.allowAbstain
    ? answer.probabilities[MADO_ABSTAIN_OPTION_ID] ?? 0
    : undefined;

  const abstained = question.allowAbstain && answer.choice === MADO_ABSTAIN_OPTION_ID;

  return {
    type: "choice",
    selected: abstained ? null : answer.choice,
    distribution,
    confidence: answer.confidence,
    ...(question.allowAbstain
      ? {
          abstained,
          abstainProbability,
        }
      : {}),
  };
};

const fromTypeSafeNoul = (answer: TypeSafeRawNoulAnswer): NoulResult => ({
  type: "noul",
  probabilityYes: answer.noul,
});

const fromTypeSafeScore = (
  question: ScoreQuestion,
  answer: TypeSafeRawScoreAnswer,
): ScoreResult => {
  const distribution = Array.from(
    { length: question.max - question.min + 1 },
    (_, index) => answer.probabilities[String(index)] ?? 0,
  );

  return {
    type: "score",
    expectedScore: question.min + answer.score,
    distribution,
  };
};

const fromTypeSafeAnswer = (
  questionId: string,
  question: TypedQuestion,
  answer: TypeSafeRawAnswer | undefined,
): TypedResult => {
  const typed = assertAnswerType(questionId, question, answer);

  switch (question.type) {
    case "choice":
      return fromTypeSafeChoice(question, typed as TypeSafeRawChoiceAnswer);
    case "noul":
      return fromTypeSafeNoul(typed as TypeSafeRawNoulAnswer);
    case "score":
      return fromTypeSafeScore(question, typed as TypeSafeRawScoreAnswer);
  }
};

const makeDefaultClient = (options: TypeSafeJevProviderOptions): TypeSafeSystemOneClient => {
  const config: ConstructorParameters<typeof TypeSafeClient>[0] = {
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.model ? { defaultModel: options.model } : {}),
  };

  return new TypeSafeClient(config) as unknown as TypeSafeSystemOneClient;
};

export class TypeSafeJevProvider implements SystemOneProvider {
  readonly id = "typesafe-jev";

  readonly #client: TypeSafeSystemOneClient;
  readonly #model?: string;
  readonly #timeoutMs?: number;

  constructor(options: TypeSafeJevProviderOptions = {}) {
    this.#client = options.client ?? makeDefaultClient(options);
    this.#model = options.model;
    this.#timeoutMs = options.timeoutMs;
  }

  capabilities(): ProviderCapabilities {
    return {
      primitives: ["choice", "noul", "score"],
      modalities: ["text"],
      probabilitySemantics: "provider_defined",
      supportsBatch: true,
      supportsAdaptiveReads: false,
    };
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    if (request.modality !== undefined && request.modality !== "text") {
      throw new TypeSafeJevProviderError(
        `TypeSafeJevProvider currently supports text modality only; got ${request.modality}`,
      );
    }

    const questions = Object.fromEntries(
      Object.entries(request.questions).map(([questionId, question]) => [
        questionId,
        toTypeSafeQuestion(questionId, question),
      ]),
    );

    const timeout = request.budget?.maxLatencyMs ?? this.#timeoutMs;
    const started = Date.now();

    const response = await this.#client.systemOne(
      {
        state: request.state,
        questions,
        ...(this.#model ? { model: this.#model } : {}),
      },
      ...(timeout !== undefined ? [{ timeout }] : []),
    );

    const results = Object.fromEntries(
      Object.entries(request.questions).map(([questionId, question]) => [
        questionId,
        fromTypeSafeAnswer(questionId, question, response.answers[questionId]),
      ]),
    );

    const decisionResponse: DecisionResponse = {
      traceId: request.traceId,
      providerId: this.id,
      modelId: response.model,
      probabilitySemantics: "provider_defined",
      results,
      latencyMs: Date.now() - started,
      metadata: {
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      },
    };

    validateDecisionResponse(request, decisionResponse);
    return decisionResponse;
  }
}
