import type { SystemOneProvider } from "../core/provider.js";
import { validateDecisionResponse } from "../core/provider.js";
import type {
  ChoiceQuestion,
  DecisionRequest,
  DecisionResponse,
  NoulQuestion,
  ProviderCapabilities,
  ScoreQuestion,
  TypedQuestion,
  TypedResult,
} from "../core/types.js";

export type ClefModel = "clef" | "clef-flash";

export interface ClefQuestionDef {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: Record<string, string> | readonly string[];
}

export interface ClefSystemOneInput {
  model: ClefModel;
  state: unknown;
  questions: Readonly<Record<string, ClefQuestionDef>>;
}

export interface ClefChoiceAnswer {
  type?: "choice";
  choice: string;
  probabilities: Readonly<Record<string, number>>;
  confidence?: number;
}

export interface ClefScoreAnswer {
  type?: "score";
  score: number;
  probabilities?: Readonly<Record<string, number>>;
  confidence?: number;
  legend?: Readonly<Record<string, string>>;
}

export interface ClefNoulAnswer {
  type?: "noul";
  noul: number;
}

export type ClefAnswer = ClefChoiceAnswer | ClefScoreAnswer | ClefNoulAnswer;

export interface ClefSystemOneResult {
  model?: string;
  answers: Readonly<Record<string, ClefAnswer>>;
  usage?: Readonly<Record<string, unknown>>;
}

export interface ClefRunner {
  run(input: ClefSystemOneInput): Promise<ClefSystemOneResult>;
}

export interface ClefProviderOptions {
  runner: ClefRunner;
  model: ClefModel;
  id?: string;
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

const choiceQuestion = (question: ChoiceQuestion): ClefQuestionDef => ({
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
      `Clef score adapter requires integer bounds; got [${question.min}, ${question.max}]`,
    );
  }
  if (question.max < question.min) {
    throw new Error("Clef score adapter requires max >= min");
  }
  const count = question.max - question.min + 1;
  if (count < 2) {
    throw new Error("Clef score adapter requires at least two levels");
  }

  return Array.from({ length: count }, (_, index) => {
    const value = question.min + index;
    return question.labels?.[value] ?? String(value);
  });
};

const scoreQuestion = (question: ScoreQuestion): ClefQuestionDef => ({
  type: "score",
  instructions: question.prompt,
  criteria: scoreLevels(question),
});

const noulQuestion = (question: NoulQuestion): ClefQuestionDef => ({
  type: "noul",
  instructions: question.prompt,
});

const assertQuestionEnvelope = (
  questions: Readonly<Record<string, TypedQuestion>>,
): void => {
  const entries = Object.entries(questions);
  if (entries.length < 1 || entries.length > 64) {
    throw new Error(`Clef requires 1..64 questions; got ${entries.length}`);
  }

  for (const [id] of entries) {
    if (id.length > 100 || !/^[A-Za-z0-9_.-]+$/.test(id)) {
      throw new Error(
        `Clef question id must be <=100 chars using letters, digits, _, ., or -: ${id}`,
      );
    }
  }
};

export const toClefQuestions = (
  questions: Readonly<Record<string, TypedQuestion>>,
): Record<string, ClefQuestionDef> => {
  assertQuestionEnvelope(questions);
  const out: Record<string, ClefQuestionDef> = {};
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

const assertOptionalType = (
  actual: string | undefined,
  expected: TypedQuestion["type"],
  id: string,
): void => {
  if (actual !== undefined && actual !== expected) {
    throw new Error(
      `Clef answer type mismatch for ${id}: expected ${expected}, got ${actual}`,
    );
  }
};

const fromChoice = (
  question: ChoiceQuestion,
  answer: ClefChoiceAnswer,
  id: string,
): TypedResult => {
  assertOptionalType(answer.type, "choice", id);
  const allowed = new Set(question.options.map((option) => option.id));
  if (!allowed.has(answer.choice)) {
    throw new Error(`Clef answer for ${id} selected unknown option: ${answer.choice}`);
  }

  const distribution = normalizeDistribution(
    answer.probabilities,
    `${id}.probabilities`,
  );
  for (const key of Object.keys(distribution)) {
    if (!allowed.has(key)) {
      throw new Error(
        `Clef answer for ${id} contains unknown probability key: ${key}`,
      );
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
    ...(answer.confidence === undefined
      ? {}
      : { confidence: probability(answer.confidence, `${id}.confidence`) }),
  };
};

const fromScore = (
  question: ScoreQuestion,
  answer: ClefScoreAnswer,
  id: string,
): TypedResult => {
  assertOptionalType(answer.type, "score", id);
  const expectedScore = question.min + finite(answer.score, `${id}.score`);
  if (expectedScore < question.min || expectedScore > question.max) {
    throw new Error(
      `Clef score for ${id} maps outside [${question.min}, ${question.max}]: ${expectedScore}`,
    );
  }

  let distribution: number[] | undefined;
  if (answer.probabilities) {
    const normalized = normalizeDistribution(
      answer.probabilities,
      `${id}.probabilities`,
    );
    distribution = Array.from(
      { length: question.max - question.min + 1 },
      (_, index) => normalized[String(index)] ?? 0,
    );
  }

  return {
    type: "score",
    expectedScore,
    ...(distribution ? { distribution } : {}),
    ...(answer.confidence === undefined
      ? {}
      : { confidence: probability(answer.confidence, `${id}.confidence`) }),
  };
};

const fromNoul = (
  answer: ClefNoulAnswer,
  id: string,
): TypedResult => {
  assertOptionalType(answer.type, "noul", id);
  return {
    type: "noul",
    probabilityYes: probability(answer.noul, `${id}.noul`),
  };
};

export const fromClefAnswers = (
  questions: Readonly<Record<string, TypedQuestion>>,
  answers: Readonly<Record<string, ClefAnswer>>,
): Record<string, TypedResult> => {
  const out: Record<string, TypedResult> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = answers[id];
    if (!answer) {
      throw new Error(`Clef result missing answer for question: ${id}`);
    }

    switch (question.type) {
      case "choice":
        if (!("choice" in answer) || !("probabilities" in answer)) {
          throw new Error(`Clef choice answer for ${id} is malformed`);
        }
        out[id] = fromChoice(question, answer as ClefChoiceAnswer, id);
        break;
      case "score":
        if (!("score" in answer)) {
          throw new Error(`Clef score answer for ${id} is malformed`);
        }
        out[id] = fromScore(question, answer as ClefScoreAnswer, id);
        break;
      case "noul":
        if (!("noul" in answer)) {
          throw new Error(`Clef noul answer for ${id} is malformed`);
        }
        out[id] = fromNoul(answer as ClefNoulAnswer, id);
        break;
    }
  }
  return out;
};

const costFromUsage = (
  usage: Readonly<Record<string, unknown>> | undefined,
): number | undefined => {
  const cost = usage?.cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? cost
    : undefined;
};

export class ClefSystemOneProvider implements SystemOneProvider {
  readonly id: string;
  readonly #runner: ClefRunner;
  readonly #model: ClefModel;

  constructor(options: ClefProviderOptions) {
    this.id = options.id ?? options.model;
    this.#runner = options.runner;
    this.#model = options.model;
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    if (request.modality !== undefined && request.modality !== "text") {
      throw new Error(
        "Clef adapter intake currently enables text only; vision requires a reviewed media bridge",
      );
    }

    const started = performance.now();
    const raw = await this.#runner.run({
      model: this.#model,
      state: request.state,
      questions: toClefQuestions(request.questions),
    });

    const estimatedCost = costFromUsage(raw.usage);
    const response: DecisionResponse = {
      traceId: request.traceId,
      providerId: this.id,
      modelId: raw.model ?? this.#model,
      probabilitySemantics: "direct_logits",
      confidenceSemantics: "provider_defined",
      calibrationStatus: "unknown",
      results: fromClefAnswers(request.questions, raw.answers),
      latencyMs: performance.now() - started,
      ...(estimatedCost === undefined ? {} : { estimatedCost }),
      metadata: {
        transport: "systemone",
        requestedModel: this.#model,
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
      inferenceFamily: "hybrid",
      specialization: "general",
      probabilitySemantics: "direct_logits",
      confidenceSemantics: "provider_defined",
      calibration: {
        status: "unknown",
        notes:
          "Clef emits schema-bound probabilities, but MADO workload calibration is required before authority or threshold transfer.",
      },
      supportsBatch: true,
      supportsAdaptiveReads: false,
      patternSupport: {
        route: { status: "experimental" },
        rank: { status: "experimental" },
        gate: { status: "experimental" },
        score: { status: "experimental" },
        sieve: { status: "experimental" },
        verify: { status: "experimental" },
      },
    };
  }
}

export interface CloudflareClefRunnerOptions {
  accountId: string;
  apiToken: string;
  model: ClefModel;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseSystemOneResult = (value: unknown): ClefSystemOneResult => {
  if (!isRecord(value) || !isRecord(value.answers)) {
    throw new Error("Cloudflare Clef response is missing answers");
  }

  const answers = value.answers as Record<string, ClefAnswer>;
  const usage = isRecord(value.usage)
    ? (value.usage as Readonly<Record<string, unknown>>)
    : undefined;

  return {
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    answers,
    ...(usage ? { usage } : {}),
  };
};

export class CloudflareWorkersAiClefRunner implements ClefRunner {
  readonly #accountId: string;
  readonly #apiToken: string;
  readonly #model: ClefModel;
  readonly #fetch: typeof fetch;
  readonly #apiBaseUrl: string;

  constructor(options: CloudflareClefRunnerOptions) {
    if (!options.accountId) {
      throw new Error("Cloudflare accountId is required");
    }
    if (!options.apiToken) {
      throw new Error("Cloudflare apiToken is required");
    }
    this.#accountId = options.accountId;
    this.#apiToken = options.apiToken;
    this.#model = options.model;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#apiBaseUrl =
      options.apiBaseUrl ?? "https://api.cloudflare.com/client/v4";
  }

  async run(input: ClefSystemOneInput): Promise<ClefSystemOneResult> {
    if (input.model !== this.#model) {
      throw new Error(
        `Clef runner model mismatch: configured ${this.#model}, got ${input.model}`,
      );
    }

    const slug =
      this.#model === "clef"
        ? "@cf/cloudflare/clef"
        : "@cf/cloudflare/clef-flash";
    const url =
      `${this.#apiBaseUrl}/accounts/${encodeURIComponent(this.#accountId)}/ai/run/${slug}`;

    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        `Cloudflare Clef returned non-JSON response (HTTP ${response.status})`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Cloudflare Clef request failed (HTTP ${response.status}): ${text.slice(0, 500)}`,
      );
    }

    if (isRecord(parsed) && parsed.success === false) {
      throw new Error(
        `Cloudflare Clef API reported failure: ${JSON.stringify(parsed.errors ?? [])}`,
      );
    }

    const result =
      isRecord(parsed) && "result" in parsed ? parsed.result : parsed;
    return parseSystemOneResult(result);
  }
}

export interface CreateCloudflareClefProviderOptions {
  accountId: string;
  apiToken: string;
  model: ClefModel;
  id?: string;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export const createCloudflareClefProvider = (
  options: CreateCloudflareClefProviderOptions,
): ClefSystemOneProvider => {
  const runner = new CloudflareWorkersAiClefRunner({
    accountId: options.accountId,
    apiToken: options.apiToken,
    model: options.model,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.apiBaseUrl ? { apiBaseUrl: options.apiBaseUrl } : {}),
  });

  return new ClefSystemOneProvider({
    runner,
    model: options.model,
    ...(options.id ? { id: options.id } : {}),
  });
};
