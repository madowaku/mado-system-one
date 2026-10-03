import type { SystemOnePattern } from "../core/types.js";
import {
  metricsFrom,
  observationsInLedger,
  reviewsForObservations,
  reviewsInLedger,
  verifyProviderEvidenceLedger,
  type ProviderDisagreementCluster,
  type ProviderEvidenceLedger,
  type ProviderEvidenceMetrics,
  type ProviderEvidenceWindow,
  type ProviderObservation,
  type ProviderReviewObservation,
} from "./provider-ledger.js";

export type ProviderContextEvidenceStatus =
  | "no_matching_evidence"
  | "observed_unreviewed"
  | "observed_reviewed";

export type ProviderContextMatchScope =
  | "pattern_and_task_family"
  | "pattern_only"
  | "task_family_only"
  | "overall_only"
  | "no_evidence";

export interface ProviderSuitabilityQuery {
  pattern: SystemOnePattern;
  taskFamily?: string;
  providerIds?: readonly string[];
  maxProviders?: number;
  maxRecentWindowsPerProvider?: number;
  maxDisagreementClustersPerProvider?: number;
}

export interface ProviderContextSlice {
  scope: "overall" | "pattern" | "task_family" | "exact";
  pattern?: SystemOnePattern;
  taskFamily?: string;
  metrics: ProviderEvidenceMetrics;
}

export type ProviderContextDisagreementCluster =
  ProviderDisagreementCluster;

export interface ProviderSuitabilityEntry {
  providerId: string;
  evidenceStatus: ProviderContextEvidenceStatus;
  matchScope: ProviderContextMatchScope;
  exactContext: ProviderContextSlice;
  patternContext: ProviderContextSlice;
  taskFamilyContext?: ProviderContextSlice;
  overallContext: ProviderContextSlice;
  reviewedQuestionCoverage: number;
  recentWindows: readonly ProviderEvidenceWindow[];
  disagreementClusters: readonly ProviderContextDisagreementCluster[];
  sourceRefs: readonly string[];
}

export interface ProviderSuitabilityContextPack {
  schemaVersion: "mso.provider-suitability-context.v0";
  packId: string;
  createdAt: string;
  registryId: string;
  decisionSurface: string;
  ledgerHeadEventHash: string | null;
  query: {
    pattern: SystemOnePattern;
    taskFamily?: string;
    providerIds: readonly string[];
  };
  bounds: {
    maxProviders: number;
    maxRecentWindowsPerProvider: number;
    maxDisagreementClustersPerProvider: number;
  };
  providers: readonly ProviderSuitabilityEntry[];
  omittedProviderIds: readonly string[];
  evidenceOnly: true;
  providerOrder: "lexicographic";
  automaticProviderRanking: false;
  automaticRoutingDecision: false;
  runtimeAuthorityManaged: false;
  requiresPolicyDecision: true;
}

export interface BuildProviderSuitabilityContextOptions
  extends ProviderSuitabilityQuery {
  packId?: string;
  now?: Date;
}

const DEFAULT_MAX_PROVIDERS = 8;
const DEFAULT_MAX_WINDOWS = 3;
const DEFAULT_MAX_CLUSTERS = 5;

const positiveInteger = (
  value: number | undefined,
  fallback: number,
  label: string,
): number => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return resolved;
};

const nonNegativeInteger = (
  value: number | undefined,
  fallback: number,
  label: string,
): number => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return resolved;
};

const nonEmpty = (value: string, label: string): string => {
  if (!value.trim()) throw new Error(`${label} must be non-empty`);
  return value;
};

const reviewKey = (
  traceId: string,
  questionId: string,
  providerId: string,
): string => `${traceId}::${questionId}::${providerId}`;

const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const observationsFor = (
  observations: readonly ProviderObservation[],
  providerId: string,
  options: {
    pattern?: SystemOnePattern;
    taskFamily?: string;
  },
): ProviderObservation[] =>
  observations.filter(
    (observation) =>
      observation.providerId === providerId &&
      (options.pattern === undefined ||
        observation.pattern === options.pattern) &&
      (options.taskFamily === undefined ||
        observation.taskFamily === options.taskFamily),
  );

const contextSlice = (
  scope: ProviderContextSlice["scope"],
  observations: readonly ProviderObservation[],
  allReviews: readonly ProviderReviewObservation[],
  options: {
    pattern?: SystemOnePattern;
    taskFamily?: string;
  } = {},
): ProviderContextSlice => ({
  scope,
  ...(options.pattern ? { pattern: options.pattern } : {}),
  ...(options.taskFamily ? { taskFamily: options.taskFamily } : {}),
  metrics: metricsFrom({
    observations: [...observations],
    reviews: reviewsForObservations(observations, allReviews),
  }),
});

const evidenceStatus = (
  metrics: ProviderEvidenceMetrics,
): ProviderContextEvidenceStatus => {
  if (metrics.observations === 0) return "no_matching_evidence";
  return metrics.reviewedQuestions > 0
    ? "observed_reviewed"
    : "observed_unreviewed";
};

const matchScope = (
  overall: ProviderEvidenceMetrics,
  pattern: ProviderEvidenceMetrics,
  taskFamily: ProviderEvidenceMetrics | undefined,
  exact: ProviderEvidenceMetrics,
  hasTaskFamily: boolean,
): ProviderContextMatchScope => {
  if (hasTaskFamily && exact.observations > 0) {
    return "pattern_and_task_family";
  }
  if (pattern.observations > 0) return "pattern_only";
  if (taskFamily && taskFamily.observations > 0) return "task_family_only";
  if (overall.observations > 0) return "overall_only";
  return "no_evidence";
};

const recentWindows = (
  ledger: ProviderEvidenceLedger,
  providerId: string,
  query: { pattern: SystemOnePattern; taskFamily?: string },
  allReviews: readonly ProviderReviewObservation[],
  maxWindows: number,
): ProviderEvidenceWindow[] => {
  if (maxWindows === 0) return [];

  const windows = ledger.events.flatMap((event) => {
    if (event.payload.type !== "sessions_ingested") return [];
    const selected = event.payload.data.observations.filter(
      (observation) =>
        observation.providerId === providerId &&
        observation.pattern === query.pattern &&
        (query.taskFamily === undefined ||
          observation.taskFamily === query.taskFamily),
    );
    if (selected.length === 0) return [];

    return [
      {
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        sourceRef: event.payload.data.sourceRef,
        metrics: metricsFrom({
          observations: selected,
          reviews: reviewsForObservations(selected, allReviews),
        }),
      },
    ];
  });

  return windows
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, maxWindows);
};

const disagreementClusters = (
  observations: readonly ProviderObservation[],
  reviews: readonly ProviderReviewObservation[],
  maxClusters: number,
): ProviderContextDisagreementCluster[] => {
  if (maxClusters === 0) return [];

  const reviewByKey = new Map(
    reviews.map((review) => [
      reviewKey(review.traceId, review.questionId, review.providerId),
      review,
    ]),
  );
  const clusters = new Map<
    string,
    {
      pattern: SystemOnePattern | "unknown";
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
      const current = clusters.get(key) ?? {
        pattern: observation.pattern,
        questionId: question.questionId,
        questionType: question.type,
        observations: 0,
        disagreements: 0,
        reviewKeys: new Set<string>(),
      };
      current.observations += 1;
      if (question.agreement === false) current.disagreements += 1;
      current.reviewKeys.add(
        reviewKey(
          observation.traceId,
          question.questionId,
          observation.providerId,
        ),
      );
      clusters.set(key, current);
    }
  }

  return [...clusters.entries()]
    .map(([key, cluster]): ProviderContextDisagreementCluster => {
      const reviewed = [...cluster.reviewKeys]
        .map((reviewId) => reviewByKey.get(reviewId))
        .filter((value): value is ProviderReviewObservation => value !== undefined);
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
        right.observations - left.observations ||
        left.key.localeCompare(right.key),
    )
    .slice(0, maxClusters);
};

const sourceRefsFor = (
  ledger: ProviderEvidenceLedger,
  observations: readonly ProviderObservation[],
  reviews: readonly ProviderReviewObservation[],
): string[] => {
  const sessionIds = new Set(observations.map((item) => item.sessionId));
  const reviewKeys = new Set(
    reviews.map((review) =>
      reviewKey(review.traceId, review.questionId, review.providerId),
    ),
  );
  const refs = new Set<string>();

  for (const event of ledger.events) {
    if (event.payload.type === "sessions_ingested") {
      if (
        event.payload.data.observations.some((observation) =>
          sessionIds.has(observation.sessionId),
        )
      ) {
        refs.add(event.payload.data.sourceRef);
      }
      continue;
    }

    if (
      event.payload.data.reviews.some((review) =>
        reviewKeys.has(
          reviewKey(review.traceId, review.questionId, review.providerId),
        ),
      )
    ) {
      refs.add(event.payload.data.sourceRef);
    }
  }

  return [...refs].sort();
};

const selectedProviderIds = (
  observations: readonly ProviderObservation[],
  queryProviderIds: readonly string[] | undefined,
  maxProviders: number,
): { selected: string[]; omitted: string[] } => {
  const available = [...new Set(observations.map((item) => item.providerId))].sort();
  const requested = queryProviderIds
    ? [...new Set(queryProviderIds.map((item) => nonEmpty(item, "providerId")))].sort()
    : available;

  if (!queryProviderIds && available.length > maxProviders) {
    throw new Error(
      `ledger contains ${available.length} providers but maxProviders=${maxProviders}; pass providerIds explicitly to avoid implicit truncation or ranking`,
    );
  }
  if (requested.length > maxProviders) {
    throw new Error(
      `provider context request contains ${requested.length} providers but maxProviders=${maxProviders}; pass a smaller explicit provider set`,
    );
  }

  const requestedSet = new Set(requested);
  return {
    selected: requested,
    omitted: available.filter((providerId) => !requestedSet.has(providerId)),
  };
};

export const buildProviderSuitabilityContextPack = (
  ledger: ProviderEvidenceLedger,
  options: BuildProviderSuitabilityContextOptions,
): ProviderSuitabilityContextPack => {
  verifyProviderEvidenceLedger(ledger);

  const maxProviders = positiveInteger(
    options.maxProviders,
    DEFAULT_MAX_PROVIDERS,
    "maxProviders",
  );
  const maxRecentWindowsPerProvider = nonNegativeInteger(
    options.maxRecentWindowsPerProvider,
    DEFAULT_MAX_WINDOWS,
    "maxRecentWindowsPerProvider",
  );
  const maxDisagreementClustersPerProvider = nonNegativeInteger(
    options.maxDisagreementClustersPerProvider,
    DEFAULT_MAX_CLUSTERS,
    "maxDisagreementClustersPerProvider",
  );
  const taskFamily = options.taskFamily?.trim() || undefined;
  const observations = observationsInLedger(ledger);
  const reviews = reviewsInLedger(ledger);
  const providers = selectedProviderIds(
    observations,
    options.providerIds,
    maxProviders,
  );

  const entries = providers.selected.map(
    (providerId): ProviderSuitabilityEntry => {
      const overallObservations = observationsFor(
        observations,
        providerId,
        {},
      );
      const patternObservations = observationsFor(
        observations,
        providerId,
        { pattern: options.pattern },
      );
      const taskFamilyObservations = taskFamily
        ? observationsFor(observations, providerId, { taskFamily })
        : undefined;
      const exactObservations = observationsFor(
        observations,
        providerId,
        {
          pattern: options.pattern,
          ...(taskFamily ? { taskFamily } : {}),
        },
      );

      const overall = contextSlice(
        "overall",
        overallObservations,
        reviews,
      );
      const pattern = contextSlice(
        "pattern",
        patternObservations,
        reviews,
        { pattern: options.pattern },
      );
      const task =
        taskFamily !== undefined && taskFamilyObservations
          ? contextSlice(
              "task_family",
              taskFamilyObservations,
              reviews,
              { taskFamily },
            )
          : undefined;
      const exact = contextSlice(
        "exact",
        exactObservations,
        reviews,
        {
          pattern: options.pattern,
          ...(taskFamily ? { taskFamily } : {}),
        },
      );
      const exactReviews = reviewsForObservations(exactObservations, reviews);
      const observedShadowQuestions = exactObservations
        .filter((observation) => observation.role === "shadow")
        .reduce((sum, observation) => sum + observation.questions.length, 0);

      return {
        providerId,
        evidenceStatus: evidenceStatus(exact.metrics),
        matchScope: matchScope(
          overall.metrics,
          pattern.metrics,
          task?.metrics,
          exact.metrics,
          taskFamily !== undefined,
        ),
        exactContext: exact,
        patternContext: pattern,
        ...(task ? { taskFamilyContext: task } : {}),
        overallContext: overall,
        reviewedQuestionCoverage: rate(
          exactReviews.length,
          observedShadowQuestions,
        ),
        recentWindows: recentWindows(
          ledger,
          providerId,
          {
            pattern: options.pattern,
            ...(taskFamily ? { taskFamily } : {}),
          },
          reviews,
          maxRecentWindowsPerProvider,
        ),
        disagreementClusters: disagreementClusters(
          exactObservations,
          exactReviews,
          maxDisagreementClustersPerProvider,
        ),
        sourceRefs: sourceRefsFor(
          ledger,
          exactObservations,
          exactReviews,
        ),
      };
    },
  );

  const createdAt = (options.now ?? new Date()).toISOString();
  const ledgerHeadEventHash =
    ledger.events.length === 0
      ? null
      : ledger.events[ledger.events.length - 1]?.eventHash ?? null;

  return {
    schemaVersion: "mso.provider-suitability-context.v0",
    packId:
      options.packId ??
      `provider-context-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt,
    registryId: ledger.registryId,
    decisionSurface: ledger.decisionSurface,
    ledgerHeadEventHash,
    query: {
      pattern: options.pattern,
      ...(taskFamily ? { taskFamily } : {}),
      providerIds: providers.selected,
    },
    bounds: {
      maxProviders,
      maxRecentWindowsPerProvider,
      maxDisagreementClustersPerProvider,
    },
    providers: entries,
    omittedProviderIds: providers.omitted,
    evidenceOnly: true,
    providerOrder: "lexicographic",
    automaticProviderRanking: false,
    automaticRoutingDecision: false,
    runtimeAuthorityManaged: false,
    requiresPolicyDecision: true,
  };
};
