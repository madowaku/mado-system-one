import { createHash } from "node:crypto";
import type { SystemOnePattern } from "../core/types.js";
import type { PromotionReviewRecord } from "../promotion/gate.js";
import type {
  MultiShadowSessionRecord,
} from "../shadow/multi.js";

export type EvidencePattern = SystemOnePattern | "unknown";
export type ProviderObservationRole = "incumbent" | "shadow";

export interface ProviderQuestionObservation {
  questionId: string;
  type: "choice" | "noul" | "score";
  comparable: boolean;
  agreement?: boolean;
  answerDelta?: number;
  confidenceDelta?: number;
  providerConfidence?: number;
  incumbentConfidence?: number;
}

export interface ProviderObservation {
  sessionId: string;
  traceId: string;
  observedAt: string;
  providerId: string;
  role: ProviderObservationRole;
  pattern: EvidencePattern;
  taskFamily: string;
  status: "ok" | "error";
  modelId?: string;
  wallLatencyMs: number;
  responseLatencyMs?: number;
  estimatedCost?: number;
  error?: string;
  comparableQuestions: number;
  agreements: number;
  disagreements: number;
  reviewNeeded: boolean;
  reviewReasons: readonly string[];
  confidenceSamples: number;
  meanConfidence?: number;
  questions: readonly ProviderQuestionObservation[];
}

export interface ProviderReviewObservation {
  traceId: string;
  questionId: string;
  providerId: string;
  label: PromotionReviewRecord["label"];
  source: PromotionReviewRecord["source"];
  reviewedAt: string;
  reviewer?: string;
}

export interface SessionsIngestedPayload {
  sourceRef: string;
  sessions: number;
  observations: readonly ProviderObservation[];
}

export interface ReviewsIngestedPayload {
  sourceRef: string;
  reviews: readonly ProviderReviewObservation[];
}

export type ProviderEvidenceEventPayload =
  | {
      type: "sessions_ingested";
      data: SessionsIngestedPayload;
    }
  | {
      type: "reviews_ingested";
      data: ReviewsIngestedPayload;
    };

export interface ProviderEvidenceEvent {
  eventId: string;
  occurredAt: string;
  prevEventHash: string | null;
  eventHash: string;
  payload: ProviderEvidenceEventPayload;
}

export interface ProviderEvidenceLedger {
  schemaVersion: "mso.provider-evidence-ledger.v0";
  registryId: string;
  decisionSurface: string;
  runtimeAuthorityManaged: false;
  createdAt: string;
  events: readonly ProviderEvidenceEvent[];
}

export interface ProviderEvidenceMetrics {
  observations: number;
  incumbentObservations: number;
  shadowObservations: number;
  successes: number;
  errors: number;
  errorRate: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  costSamples: number;
  totalEstimatedCost: number;
  averageEstimatedCost: number;
  comparableQuestions: number;
  agreements: number;
  disagreements: number;
  agreementRate: number;
  reviewNeededObservations: number;
  confidenceSamples: number;
  meanConfidence: number;
  reviewedQuestions: number;
  reviewedCorrect: number;
  reviewedIncorrect: number;
  reviewedAccuracy: number;
}

export interface ProviderEvidenceSlice {
  key: string;
  pattern?: EvidencePattern;
  taskFamily?: string;
  metrics: ProviderEvidenceMetrics;
}

export interface ProviderDisagreementCluster {
  key: string;
  pattern: EvidencePattern;
  questionId: string;
  questionType: "choice" | "noul" | "score";
  observations: number;
  disagreements: number;
  disagreementRate: number;
  reviewedQuestions: number;
  shadowCorrect: number;
  incumbentCorrect: number;
  bothAcceptable: number;
  neither: number;
}

export interface ProviderEvidenceWindow {
  eventId: string;
  occurredAt: string;
  sourceRef: string;
  metrics: ProviderEvidenceMetrics;
}

export interface DerivedProviderEvidence {
  providerId: string;
  firstObservedAt: string;
  lastObservedAt: string;
  metrics: ProviderEvidenceMetrics;
  byPattern: readonly ProviderEvidenceSlice[];
  byTaskFamily: readonly ProviderEvidenceSlice[];
  disagreementClusters: readonly ProviderDisagreementCluster[];
  timeline: readonly ProviderEvidenceWindow[];
}

export interface DerivedProviderEvidenceState {
  registryId: string;
  decisionSurface: string;
  eventCount: number;
  headEventHash: string | null;
  sessionCount: number;
  reviewCount: number;
  providers: Readonly<Record<string, DerivedProviderEvidence>>;
  runtimeAuthorityManaged: false;
  automaticRoutingDecision: false;
}

export interface IngestSessionOptions {
  sourceRef: string;
  taskFamilyFallback?: string;
  eventId?: string;
  now?: Date;
}

export interface IngestReviewOptions {
  sourceRef: string;
  eventId?: string;
  now?: Date;
}

const nonEmpty = (value: string, label: string): string => {
  if (!value.trim()) throw new Error(`${label} must be non-empty`);
  return value;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
};

const hashEvent = (
  event: Omit<ProviderEvidenceEvent, "eventHash">,
): string =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(event)))
    .digest("hex");

const pct = (values: readonly number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0;
};

const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const finiteNonNegative = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and non-negative`);
  }
  return value;
};

const patternFromSession = (
  session: MultiShadowSessionRecord,
): EvidencePattern => session.request?.pattern ?? "unknown";

const taskFamilyFromSession = (
  session: MultiShadowSessionRecord,
  fallback?: string,
): string => {
  const fromMetadata = session.request?.metadata?.taskFamily;
  if (typeof fromMetadata === "string" && fromMetadata.trim()) {
    return fromMetadata;
  }
  return fallback?.trim() || "unknown";
};

const providerConfidence = (
  values: readonly (number | undefined)[],
): { samples: number; mean?: number } => {
  const points = values.filter(
    (value): value is number =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1,
  );
  if (points.length === 0) return { samples: 0 };
  return {
    samples: points.length,
    mean: points.reduce((sum, value) => sum + value, 0) / points.length,
  };
};

const shadowObservation = (
  session: MultiShadowSessionRecord,
  shadowProviderId: string,
  taskFamilyFallback?: string,
): ProviderObservation => {
  const pair = session.pairTraces.find(
    (trace) => trace.shadowProviderId === shadowProviderId,
  );
  if (!pair) {
    throw new Error(
      `session ${session.sessionId} missing pair trace for ${shadowProviderId}`,
    );
  }
  const snapshot = session.shadows[shadowProviderId];
  if (!snapshot) {
    throw new Error(
      `session ${session.sessionId} missing shadow snapshot for ${shadowProviderId}`,
    );
  }

  const questions: ProviderQuestionObservation[] = pair.questions.map(
    (question) => ({
      questionId: question.questionId,
      type: question.type,
      comparable: question.comparable,
      ...(question.agreement === undefined
        ? {}
        : { agreement: question.agreement }),
      ...(question.answerDelta === undefined
        ? {}
        : { answerDelta: question.answerDelta }),
      ...(question.confidenceDelta === undefined
        ? {}
        : { confidenceDelta: question.confidenceDelta }),
      ...(question.shadow.confidence === undefined
        ? {}
        : { providerConfidence: question.shadow.confidence }),
      ...(question.incumbent.confidence === undefined
        ? {}
        : { incumbentConfidence: question.incumbent.confidence }),
    }),
  );
  const confidence = providerConfidence(
    questions.map((question) => question.providerConfidence),
  );

  return {
    sessionId: session.sessionId,
    traceId: session.traceId,
    observedAt: session.capturedAt,
    providerId: shadowProviderId,
    role: "shadow",
    pattern: patternFromSession(session),
    taskFamily: taskFamilyFromSession(session, taskFamilyFallback),
    status: snapshot.status,
    ...(snapshot.modelId ? { modelId: snapshot.modelId } : {}),
    wallLatencyMs: finiteNonNegative(
      snapshot.wallLatencyMs,
      `${session.sessionId}/${shadowProviderId}.wallLatencyMs`,
    ),
    ...(snapshot.responseLatencyMs === undefined
      ? {}
      : {
          responseLatencyMs: finiteNonNegative(
            snapshot.responseLatencyMs,
            `${session.sessionId}/${shadowProviderId}.responseLatencyMs`,
          ),
        }),
    ...(snapshot.estimatedCost === undefined
      ? {}
      : {
          estimatedCost: finiteNonNegative(
            snapshot.estimatedCost,
            `${session.sessionId}/${shadowProviderId}.estimatedCost`,
          ),
        }),
    ...(snapshot.error ? { error: snapshot.error } : {}),
    comparableQuestions: pair.comparableQuestions,
    agreements: pair.agreements,
    disagreements: pair.disagreements,
    reviewNeeded: pair.review.needed,
    reviewReasons: pair.review.reasons,
    confidenceSamples: confidence.samples,
    ...(confidence.mean === undefined ? {} : { meanConfidence: confidence.mean }),
    questions,
  };
};

const incumbentObservation = (
  session: MultiShadowSessionRecord,
  taskFamilyFallback?: string,
): ProviderObservation => {
  const snapshot = session.incumbent;
  const incumbentConfidenceByQuestion = new Map<string, number>();
  for (const pair of session.pairTraces) {
    for (const question of pair.questions) {
      if (
        question.incumbent.confidence !== undefined &&
        !incumbentConfidenceByQuestion.has(question.questionId)
      ) {
        incumbentConfidenceByQuestion.set(
          question.questionId,
          question.incumbent.confidence,
        );
      }
    }
  }
  const confidence = providerConfidence(
    [...incumbentConfidenceByQuestion.values()],
  );

  return {
    sessionId: session.sessionId,
    traceId: session.traceId,
    observedAt: session.capturedAt,
    providerId: session.authoritativeProviderId,
    role: "incumbent",
    pattern: patternFromSession(session),
    taskFamily: taskFamilyFromSession(session, taskFamilyFallback),
    status: snapshot.status,
    ...(snapshot.modelId ? { modelId: snapshot.modelId } : {}),
    wallLatencyMs: finiteNonNegative(
      snapshot.wallLatencyMs,
      `${session.sessionId}/incumbent.wallLatencyMs`,
    ),
    ...(snapshot.responseLatencyMs === undefined
      ? {}
      : {
          responseLatencyMs: finiteNonNegative(
            snapshot.responseLatencyMs,
            `${session.sessionId}/incumbent.responseLatencyMs`,
          ),
        }),
    ...(snapshot.estimatedCost === undefined
      ? {}
      : {
          estimatedCost: finiteNonNegative(
            snapshot.estimatedCost,
            `${session.sessionId}/incumbent.estimatedCost`,
          ),
        }),
    ...(snapshot.error ? { error: snapshot.error } : {}),
    comparableQuestions: 0,
    agreements: 0,
    disagreements: 0,
    reviewNeeded: snapshot.status === "error",
    reviewReasons:
      snapshot.status === "error" ? ["incumbent_provider_error"] : [],
    confidenceSamples: confidence.samples,
    ...(confidence.mean === undefined ? {} : { meanConfidence: confidence.mean }),
    questions: [],
  };
};

const observationsFromSessions = (
  sessions: readonly MultiShadowSessionRecord[],
  taskFamilyFallback?: string,
): ProviderObservation[] =>
  sessions.flatMap((session) => [
    incumbentObservation(session, taskFamilyFallback),
    ...session.shadowProviderIds.map((providerId) =>
      shadowObservation(session, providerId, taskFamilyFallback),
    ),
  ]);

const reviewKey = (
  traceId: string,
  questionId: string,
  providerId: string,
): string => `${traceId}::${questionId}::${providerId}`;

export const observationsInLedger = (
  ledger: ProviderEvidenceLedger,
): ProviderObservation[] =>
  ledger.events.flatMap((event) =>
    event.payload.type === "sessions_ingested"
      ? [...event.payload.data.observations]
      : [],
  );

export const reviewsInLedger = (
  ledger: ProviderEvidenceLedger,
): ProviderReviewObservation[] =>
  ledger.events.flatMap((event) =>
    event.payload.type === "reviews_ingested"
      ? [...event.payload.data.reviews]
      : [],
  );

const sessionIdsInLedger = (
  ledger: ProviderEvidenceLedger,
): Set<string> =>
  new Set(observationsInLedger(ledger).map((observation) => observation.sessionId));

const appendEvent = (
  ledger: ProviderEvidenceLedger,
  payload: ProviderEvidenceEventPayload,
  options: { eventId?: string; now?: Date } = {},
): ProviderEvidenceLedger => {
  verifyProviderEvidenceLedger(ledger);
  const previous =
    ledger.events.length === 0
      ? null
      : ledger.events[ledger.events.length - 1]?.eventHash ?? null;
  const occurredAt = (options.now ?? new Date()).toISOString();
  const eventId =
    options.eventId ??
    `${payload.type}-${String(ledger.events.length + 1).padStart(6, "0")}-${occurredAt.replace(/[:.]/g, "-")}`;
  const unsigned = {
    eventId,
    occurredAt,
    prevEventHash: previous,
    payload,
  };
  const event: ProviderEvidenceEvent = {
    ...unsigned,
    eventHash: hashEvent(unsigned),
  };
  const next: ProviderEvidenceLedger = {
    ...ledger,
    events: [...ledger.events, event],
  };
  verifyProviderEvidenceLedger(next);
  return next;
};

export const createProviderEvidenceLedger = (
  registryId: string,
  decisionSurface: string,
  now: Date = new Date(),
): ProviderEvidenceLedger => ({
  schemaVersion: "mso.provider-evidence-ledger.v0",
  registryId: nonEmpty(registryId, "registryId"),
  decisionSurface: nonEmpty(decisionSurface, "decisionSurface"),
  runtimeAuthorityManaged: false,
  createdAt: now.toISOString(),
  events: [],
});

export const verifyProviderEvidenceLedger = (
  ledger: ProviderEvidenceLedger,
): void => {
  if (ledger.schemaVersion !== "mso.provider-evidence-ledger.v0") {
    throw new Error("unsupported provider evidence ledger schema");
  }
  nonEmpty(ledger.registryId, "registryId");
  nonEmpty(ledger.decisionSurface, "decisionSurface");
  if (ledger.runtimeAuthorityManaged !== false) {
    throw new Error("provider evidence ledger must not manage runtime authority");
  }

  let previousHash: string | null = null;
  const eventIds = new Set<string>();
  const sessions = new Set<string>();
  const reviewKeys = new Set<string>();

  for (const [index, event] of ledger.events.entries()) {
    if (eventIds.has(event.eventId)) {
      throw new Error(`duplicate provider evidence eventId: ${event.eventId}`);
    }
    eventIds.add(event.eventId);
    if (event.prevEventHash !== previousHash) {
      throw new Error(
        `provider evidence event ${index} prevEventHash does not match chain head`,
      );
    }
    const expected = hashEvent({
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      prevEventHash: event.prevEventHash,
      payload: event.payload,
    });
    if (event.eventHash !== expected) {
      throw new Error(`provider evidence event ${event.eventId} hash mismatch`);
    }

    if (event.payload.type === "sessions_ingested") {
      nonEmpty(event.payload.data.sourceRef, "sessions sourceRef");
      const eventSessions = new Set<string>();
      for (const observation of event.payload.data.observations) {
        nonEmpty(observation.providerId, "observation providerId");
        nonEmpty(observation.sessionId, "observation sessionId");
        nonEmpty(observation.traceId, "observation traceId");
        finiteNonNegative(observation.wallLatencyMs, "observation wallLatencyMs");
        if (
          observation.meanConfidence !== undefined &&
          (observation.meanConfidence < 0 || observation.meanConfidence > 1)
        ) {
          throw new Error("observation meanConfidence must be in [0, 1]");
        }
        eventSessions.add(observation.sessionId);
      }
      if (event.payload.data.sessions !== eventSessions.size) {
        throw new Error(
          `sessions_ingested count ${event.payload.data.sessions} does not match unique observations ${eventSessions.size}`,
        );
      }
      for (const sessionId of eventSessions) {
        if (sessions.has(sessionId)) {
          throw new Error(`provider evidence session already ingested: ${sessionId}`);
        }
        sessions.add(sessionId);
      }
    } else if (event.payload.type === "reviews_ingested") {
      nonEmpty(event.payload.data.sourceRef, "reviews sourceRef");
      for (const review of event.payload.data.reviews) {
        const key = reviewKey(
          review.traceId,
          review.questionId,
          review.providerId,
        );
        if (reviewKeys.has(key)) {
          throw new Error(`provider evidence review already ingested: ${key}`);
        }
        reviewKeys.add(key);
      }
    } else {
      throw new Error("unsupported provider evidence event type");
    }

    previousHash = event.eventHash;
  }

  const observedQuestions = new Set<string>();
  for (const observation of observationsInLedger(ledger)) {
    if (observation.role !== "shadow") continue;
    for (const question of observation.questions) {
      observedQuestions.add(
        reviewKey(
          observation.traceId,
          question.questionId,
          observation.providerId,
        ),
      );
    }
  }
  for (const review of reviewsInLedger(ledger)) {
    const key = reviewKey(review.traceId, review.questionId, review.providerId);
    if (!observedQuestions.has(key)) {
      throw new Error(`review has no matching shadow observation: ${key}`);
    }
  }
};

export const ingestMultiShadowSessions = (
  ledger: ProviderEvidenceLedger,
  sessions: readonly MultiShadowSessionRecord[],
  options: IngestSessionOptions,
): ProviderEvidenceLedger => {
  verifyProviderEvidenceLedger(ledger);
  nonEmpty(options.sourceRef, "sourceRef");
  if (sessions.length === 0) {
    throw new Error("session ingestion requires at least one session");
  }

  const existing = sessionIdsInLedger(ledger);
  const incoming = new Set<string>();
  for (const session of sessions) {
    if (incoming.has(session.sessionId)) {
      throw new Error(`duplicate incoming sessionId: ${session.sessionId}`);
    }
    incoming.add(session.sessionId);
    if (existing.has(session.sessionId)) {
      throw new Error(`provider evidence session already ingested: ${session.sessionId}`);
    }
    if (session.shadowInfluencedExecution !== false || session.labelsKnown !== false) {
      throw new Error(
        `session ${session.sessionId} violates non-authoritative shadow contract`,
      );
    }
  }

  return appendEvent(
    ledger,
    {
      type: "sessions_ingested",
      data: {
        sourceRef: options.sourceRef,
        sessions: sessions.length,
        observations: observationsFromSessions(
          sessions,
          options.taskFamilyFallback,
        ),
      },
    },
    {
      ...(options.eventId ? { eventId: options.eventId } : {}),
      ...(options.now ? { now: options.now } : {}),
    },
  );
};

export const ingestProviderReviews = (
  ledger: ProviderEvidenceLedger,
  reviews: readonly PromotionReviewRecord[],
  options: IngestReviewOptions,
): ProviderEvidenceLedger => {
  verifyProviderEvidenceLedger(ledger);
  nonEmpty(options.sourceRef, "sourceRef");
  if (reviews.length === 0) {
    throw new Error("review ingestion requires at least one review");
  }

  const existing = new Set(
    reviewsInLedger(ledger).map((review) =>
      reviewKey(review.traceId, review.questionId, review.providerId),
    ),
  );
  const incoming = new Set<string>();
  const compact: ProviderReviewObservation[] = reviews.map((review) => {
    const key = reviewKey(
      review.traceId,
      review.questionId,
      review.shadowProviderId,
    );
    if (existing.has(key) || incoming.has(key)) {
      throw new Error(`provider evidence review already ingested: ${key}`);
    }
    incoming.add(key);
    return {
      traceId: review.traceId,
      questionId: review.questionId,
      providerId: review.shadowProviderId,
      label: review.label,
      source: review.source,
      reviewedAt: review.reviewedAt,
      ...(review.reviewer ? { reviewer: review.reviewer } : {}),
    };
  });

  return appendEvent(
    ledger,
    {
      type: "reviews_ingested",
      data: {
        sourceRef: options.sourceRef,
        reviews: compact,
      },
    },
    {
      ...(options.eventId ? { eventId: options.eventId } : {}),
      ...(options.now ? { now: options.now } : {}),
    },
  );
};

interface MetricAccumulator {
  observations: ProviderObservation[];
  reviews: ProviderReviewObservation[];
}

const emptyMetrics = (): ProviderEvidenceMetrics => ({
  observations: 0,
  incumbentObservations: 0,
  shadowObservations: 0,
  successes: 0,
  errors: 0,
  errorRate: 0,
  latencyP50Ms: 0,
  latencyP95Ms: 0,
  costSamples: 0,
  totalEstimatedCost: 0,
  averageEstimatedCost: 0,
  comparableQuestions: 0,
  agreements: 0,
  disagreements: 0,
  agreementRate: 0,
  reviewNeededObservations: 0,
  confidenceSamples: 0,
  meanConfidence: 0,
  reviewedQuestions: 0,
  reviewedCorrect: 0,
  reviewedIncorrect: 0,
  reviewedAccuracy: 0,
});

export const metricsFrom = (input: MetricAccumulator): ProviderEvidenceMetrics => {
  if (input.observations.length === 0 && input.reviews.length === 0) {
    return emptyMetrics();
  }
  const latencies = input.observations.map((item) => item.wallLatencyMs);
  const costs = input.observations.flatMap((item) =>
    item.estimatedCost === undefined ? [] : [item.estimatedCost],
  );
  const weightedConfidence = input.observations.reduce(
    (sum, item) =>
      sum + (item.meanConfidence ?? 0) * item.confidenceSamples,
    0,
  );
  const confidenceSamples = input.observations.reduce(
    (sum, item) => sum + item.confidenceSamples,
    0,
  );
  const comparableQuestions = input.observations.reduce(
    (sum, item) => sum + item.comparableQuestions,
    0,
  );
  const agreements = input.observations.reduce(
    (sum, item) => sum + item.agreements,
    0,
  );
  const disagreements = input.observations.reduce(
    (sum, item) => sum + item.disagreements,
    0,
  );
  const reviewedCorrect = input.reviews.filter(
    (review) =>
      review.label === "shadow_correct" ||
      review.label === "both_acceptable",
  ).length;
  const reviewedIncorrect = input.reviews.filter(
    (review) =>
      review.label === "incumbent_correct" ||
      review.label === "neither",
  ).length;

  return {
    observations: input.observations.length,
    incumbentObservations: input.observations.filter(
      (item) => item.role === "incumbent",
    ).length,
    shadowObservations: input.observations.filter(
      (item) => item.role === "shadow",
    ).length,
    successes: input.observations.filter((item) => item.status === "ok").length,
    errors: input.observations.filter((item) => item.status === "error").length,
    errorRate: rate(
      input.observations.filter((item) => item.status === "error").length,
      input.observations.length,
    ),
    latencyP50Ms: pct(latencies, 0.5),
    latencyP95Ms: pct(latencies, 0.95),
    costSamples: costs.length,
    totalEstimatedCost: costs.reduce((sum, value) => sum + value, 0),
    averageEstimatedCost:
      costs.length === 0
        ? 0
        : costs.reduce((sum, value) => sum + value, 0) / costs.length,
    comparableQuestions,
    agreements,
    disagreements,
    agreementRate: rate(agreements, comparableQuestions),
    reviewNeededObservations: input.observations.filter(
      (item) => item.reviewNeeded,
    ).length,
    confidenceSamples,
    meanConfidence:
      confidenceSamples === 0 ? 0 : weightedConfidence / confidenceSamples,
    reviewedQuestions: input.reviews.length,
    reviewedCorrect,
    reviewedIncorrect,
    reviewedAccuracy: rate(reviewedCorrect, input.reviews.length),
  };
};

export const reviewsForObservations = (
  observations: readonly ProviderObservation[],
  allReviews: readonly ProviderReviewObservation[],
): ProviderReviewObservation[] => {
  const keys = new Set(
    observations.flatMap((observation) =>
      observation.questions.map((question) =>
        reviewKey(
          observation.traceId,
          question.questionId,
          observation.providerId,
        ),
      ),
    ),
  );
  return allReviews.filter((review) =>
    keys.has(reviewKey(review.traceId, review.questionId, review.providerId)),
  );
};

const slicesFor = (
  dimension: "pattern" | "taskFamily",
  observations: readonly ProviderObservation[],
  reviews: readonly ProviderReviewObservation[],
): ProviderEvidenceSlice[] => {
  const values = [
    ...new Set(
      observations.map((item) =>
        dimension === "pattern" ? item.pattern : item.taskFamily,
      ),
    ),
  ].sort();

  return values.map((value) => {
    const selected = observations.filter((item) =>
      dimension === "pattern"
        ? item.pattern === value
        : item.taskFamily === value,
    );
    return {
      key: value,
      ...(dimension === "pattern"
        ? { pattern: value as EvidencePattern }
        : { taskFamily: value }),
      metrics: metricsFrom({
        observations: selected,
        reviews: reviewsForObservations(selected, reviews),
      }),
    };
  });
};

const clustersFor = (
  observations: readonly ProviderObservation[],
  reviews: readonly ProviderReviewObservation[],
): ProviderDisagreementCluster[] => {
  const clusters = new Map<
    string,
    {
      pattern: EvidencePattern;
      questionId: string;
      questionType: "choice" | "noul" | "score";
      observations: number;
      disagreements: number;
      reviewKeys: Set<string>;
    }
  >();

  for (const observation of observations.filter(
    (item) => item.role === "shadow",
  )) {
    for (const question of observation.questions) {
      if (!question.comparable) continue;
      const key = `${observation.pattern}::${question.questionId}::${question.type}`;
      const existing = clusters.get(key) ?? {
        pattern: observation.pattern,
        questionId: question.questionId,
        questionType: question.type,
        observations: 0,
        disagreements: 0,
        reviewKeys: new Set<string>(),
      };
      existing.observations += 1;
      if (question.agreement === false) existing.disagreements += 1;
      existing.reviewKeys.add(
        reviewKey(
          observation.traceId,
          question.questionId,
          observation.providerId,
        ),
      );
      clusters.set(key, existing);
    }
  }

  return [...clusters.entries()]
    .map(([key, cluster]): ProviderDisagreementCluster => {
      const reviewed = reviews.filter((review) =>
        cluster.reviewKeys.has(
          reviewKey(review.traceId, review.questionId, review.providerId),
        ),
      );
      return {
        key,
        pattern: cluster.pattern,
        questionId: cluster.questionId,
        questionType: cluster.questionType,
        observations: cluster.observations,
        disagreements: cluster.disagreements,
        disagreementRate: rate(
          cluster.disagreements,
          cluster.observations,
        ),
        reviewedQuestions: reviewed.length,
        shadowCorrect: reviewed.filter(
          (review) => review.label === "shadow_correct",
        ).length,
        incumbentCorrect: reviewed.filter(
          (review) => review.label === "incumbent_correct",
        ).length,
        bothAcceptable: reviewed.filter(
          (review) => review.label === "both_acceptable",
        ).length,
        neither: reviewed.filter((review) => review.label === "neither").length,
      };
    })
    .sort(
      (left, right) =>
        right.disagreements - left.disagreements ||
        left.key.localeCompare(right.key),
    );
};

const windowsFor = (
  providerId: string,
  ledger: ProviderEvidenceLedger,
): ProviderEvidenceWindow[] => {
  const allReviews = reviewsInLedger(ledger);
  return ledger.events.flatMap((event) => {
    if (event.payload.type !== "sessions_ingested") return [];
    const observations = event.payload.data.observations.filter(
      (item) => item.providerId === providerId,
    );
    if (observations.length === 0) return [];
    return [
      {
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        sourceRef: event.payload.data.sourceRef,
        metrics: metricsFrom({
          observations,
          reviews: reviewsForObservations(observations, allReviews),
        }),
      },
    ];
  });
};

export const deriveProviderEvidenceState = (
  ledger: ProviderEvidenceLedger,
): DerivedProviderEvidenceState => {
  verifyProviderEvidenceLedger(ledger);
  const observations = observationsInLedger(ledger);
  const reviews = reviewsInLedger(ledger);
  const providerIds = [
    ...new Set([
      ...observations.map((item) => item.providerId),
      ...reviews.map((item) => item.providerId),
    ]),
  ].sort();
  const providers: Record<string, DerivedProviderEvidence> = {};

  for (const providerId of providerIds) {
    const providerObservations = observations.filter(
      (item) => item.providerId === providerId,
    );
    const providerReviews = reviews.filter(
      (item) => item.providerId === providerId,
    );
    const times = providerObservations
      .map((item) => item.observedAt)
      .sort((a, b) => a.localeCompare(b));

    providers[providerId] = {
      providerId,
      firstObservedAt: times[0] ?? ledger.createdAt,
      lastObservedAt: times[times.length - 1] ?? ledger.createdAt,
      metrics: metricsFrom({
        observations: providerObservations,
        reviews: providerReviews,
      }),
      byPattern: slicesFor(
        "pattern",
        providerObservations,
        providerReviews,
      ),
      byTaskFamily: slicesFor(
        "taskFamily",
        providerObservations,
        providerReviews,
      ),
      disagreementClusters: clustersFor(
        providerObservations,
        providerReviews,
      ),
      timeline: windowsFor(providerId, ledger),
    };
  }

  const sessionCount = new Set(
    observations.map((observation) => observation.sessionId),
  ).size;
  const headEventHash =
    ledger.events.length === 0
      ? null
      : ledger.events[ledger.events.length - 1]?.eventHash ?? null;

  return {
    registryId: ledger.registryId,
    decisionSurface: ledger.decisionSurface,
    eventCount: ledger.events.length,
    headEventHash,
    sessionCount,
    reviewCount: reviews.length,
    providers,
    runtimeAuthorityManaged: false,
    automaticRoutingDecision: false,
  };
};
