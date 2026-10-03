import type {
  CalibrationStatus,
  ConfidenceSemantics,
  DecisionModality,
  InferenceFamily,
  ProbabilitySemantics,
} from "../core/types.js";

export type ProviderAdapterStatus = "implemented" | "planned";

export interface DecisionModelProviderMatrixEntry {
  id: string;
  vendor: string;
  model: string;
  adapterStatus: ProviderAdapterStatus;
  transport: string;
  inferenceFamily: InferenceFamily;
  probabilitySemantics: ProbabilitySemantics;
  confidenceSemantics: ConfidenceSemantics;
  calibrationStatus: CalibrationStatus;
  upstreamModalities: readonly DecisionModality[];
  adapterModalities: readonly DecisionModality[];
  contextTokens?: number;
  maxQuestions?: number;
  maxImages?: number;
  inputUsdPerMillionTokens?: number;
  license?: string;
  sourceRefs: readonly string[];
  notes?: readonly string[];
}

export const DECISION_MODEL_PROVIDER_MATRIX: readonly DecisionModelProviderMatrixEntry[] = [
  {
    id: "laya",
    vendor: "TypeSafe ecosystem",
    model: "laya-ts",
    adapterStatus: "implemented",
    transport: "local laya-ts runtime",
    inferenceFamily: "encoder_scoring",
    probabilitySemantics: "direct_logits",
    confidenceSemantics: "selected_probability",
    calibrationStatus: "unknown",
    upstreamModalities: ["text"],
    adapterModalities: ["text"],
    sourceRefs: ["src/providers/laya.ts"],
    notes: [
      "Local zero-API-cost adapter.",
      "MADO thresholds remain task-family specific.",
    ],
  },
  {
    id: "clef",
    vendor: "Cloudflare",
    model: "@cf/cloudflare/clef",
    adapterStatus: "implemented",
    transport: "Cloudflare Workers AI REST / System One",
    inferenceFamily: "hybrid",
    probabilitySemantics: "direct_logits",
    confidenceSemantics: "provider_defined",
    calibrationStatus: "unknown",
    upstreamModalities: ["text", "vision", "text+vision"],
    adapterModalities: ["text"],
    contextTokens: 65_536,
    maxQuestions: 64,
    maxImages: 4,
    inputUsdPerMillionTokens: 0.24,
    license: "Apache-2.0 (open weights)",
    sourceRefs: [
      "https://developers.cloudflare.com/workers-ai/models/clef/",
      "https://developers.cloudflare.com/workers-ai/platform/pricing/",
      "https://huggingface.co/Cloudflare/clef",
    ],
    notes: [
      "Upstream model supports vision, but MSO-DM-M0.0 intentionally enables text only.",
      "No thresholds or calibration status are inherited from Jev despite wire compatibility.",
    ],
  },
  {
    id: "clef-flash",
    vendor: "Cloudflare",
    model: "@cf/cloudflare/clef-flash",
    adapterStatus: "implemented",
    transport: "Cloudflare Workers AI REST / System One",
    inferenceFamily: "hybrid",
    probabilitySemantics: "direct_logits",
    confidenceSemantics: "provider_defined",
    calibrationStatus: "unknown",
    upstreamModalities: ["text", "vision", "text+vision"],
    adapterModalities: ["text"],
    contextTokens: 65_536,
    maxQuestions: 64,
    maxImages: 4,
    inputUsdPerMillionTokens: 0.09,
    license: "Apache-2.0 (open weights)",
    sourceRefs: [
      "https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/",
      "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    ],
    notes: [
      "Latency-oriented Clef variant.",
      "Treat quality and threshold suitability as pattern-specific until MADO eval evidence exists.",
    ],
  },
  {
    id: "jev",
    vendor: "TypeSafe AI",
    model: "jev System One",
    adapterStatus: "planned",
    transport: "System One API",
    inferenceFamily: "hosted_proprietary",
    probabilitySemantics: "provider_defined",
    confidenceSemantics: "provider_defined",
    calibrationStatus: "unknown",
    upstreamModalities: ["text"],
    adapterModalities: [],
    sourceRefs: [
      "https://blog.cloudflare.com/clef-decision-models/",
    ],
    notes: [
      "Kept in the matrix as a comparison target; no MADO Jev adapter is active yet.",
      "Wire compatibility with Clef is not semantic or calibration compatibility.",
    ],
  },
] as const;

export const decisionModelProvider = (
  id: string,
): DecisionModelProviderMatrixEntry | undefined =>
  DECISION_MODEL_PROVIDER_MATRIX.find((entry) => entry.id === id);
