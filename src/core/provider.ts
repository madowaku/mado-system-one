import type {
  DecisionRequest,
  DecisionResponse,
  ProviderCapabilities,
  ProviderHealth,
  TypedQuestion,
  TypedResult,
} from "./types.js";

export interface SystemOneProvider {
  readonly id: string;

  decide(request: DecisionRequest): Promise<DecisionResponse>;

  capabilities(): ProviderCapabilities;

  health?(): Promise<ProviderHealth>;
}

export class ProviderContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderContractError";
  }
}

const assertProbability = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ProviderContractError(`${label} must be a finite probability in [0, 1]`);
  }
};

const validateChoice = (
  question: Extract<TypedQuestion, { type: "choice" }>,
  result: Extract<TypedResult, { type: "choice" }>,
): void => {
  const allowed = new Set(question.options.map((option) => option.id));

  for (const [optionId, probability] of Object.entries(result.distribution)) {
    if (!allowed.has(optionId)) {
      throw new ProviderContractError(`choice distribution contains unknown option: ${optionId}`);
    }
    assertProbability(probability, `choice probability for ${optionId}`);
  }

  if (result.selected !== null && !allowed.has(result.selected)) {
    throw new ProviderContractError(`choice selected unknown option: ${result.selected}`);
  }

  if (result.confidence !== undefined) {
    assertProbability(result.confidence, "choice confidence");
  }

  const candidateTotal = Object.values(result.distribution).reduce((sum, value) => sum + value, 0);
  const abstainProbability = result.abstainProbability ?? 0;
  assertProbability(abstainProbability, "choice abstainProbability");

  const total = candidateTotal + abstainProbability;
  if (Object.keys(result.distribution).length > 0 && Math.abs(total - 1) > 1e-6) {
    throw new ProviderContractError(
      `choice distribution plus abstainProbability must sum to 1; got ${total}`,
    );
  }

  if (result.abstained === true && result.selected !== null) {
    throw new ProviderContractError("abstained choice result must have selected = null");
  }
};

const validateResult = (question: TypedQuestion, result: TypedResult): void => {
  if (question.type !== result.type) {
    throw new ProviderContractError(
      `question/result type mismatch: expected ${question.type}, got ${result.type}`,
    );
  }

  switch (result.type) {
    case "choice":
      if (question.type !== "choice") {
        throw new ProviderContractError("choice result requires choice question");
      }
      validateChoice(question, result);
      return;

    case "noul":
      assertProbability(result.probabilityYes, "noul probabilityYes");
      return;

    case "score":
      if (question.type !== "score") {
        throw new ProviderContractError("score result requires score question");
      }
      if (
        !Number.isFinite(result.expectedScore) ||
        result.expectedScore < question.min ||
        result.expectedScore > question.max
      ) {
        throw new ProviderContractError(
          `score expectedScore must be within [${question.min}, ${question.max}]`,
        );
      }
      return;
  }
};

export const validateDecisionResponse = (
  request: DecisionRequest,
  response: DecisionResponse,
): void => {
  if (response.traceId !== request.traceId) {
    throw new ProviderContractError("response traceId must match request traceId");
  }

  for (const [questionId, question] of Object.entries(request.questions)) {
    const result = response.results[questionId];
    if (!result) {
      throw new ProviderContractError(`missing result for question: ${questionId}`);
    }
    validateResult(question, result);
  }

  for (const resultId of Object.keys(response.results)) {
    if (!(resultId in request.questions)) {
      throw new ProviderContractError(`response contains unknown result: ${resultId}`);
    }
  }

  if (response.latencyMs !== undefined && response.latencyMs < 0) {
    throw new ProviderContractError("latencyMs must be non-negative");
  }

  if (response.estimatedCost !== undefined && response.estimatedCost < 0) {
    throw new ProviderContractError("estimatedCost must be non-negative");
  }
};
