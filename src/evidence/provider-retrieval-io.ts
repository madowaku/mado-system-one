import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ProviderSuitabilityContextPack,
} from "./provider-retrieval.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseProviderSuitabilityContextPack = (
  value: unknown,
): ProviderSuitabilityContextPack => {
  if (
    !record(value) ||
    value.schemaVersion !== "mso.provider-suitability-context.v0"
  ) {
    throw new Error(
      "provider suitability context must use schemaVersion mso.provider-suitability-context.v0",
    );
  }
  if (
    value.evidenceOnly !== true ||
    value.automaticProviderRanking !== false ||
    value.automaticRoutingDecision !== false ||
    value.runtimeAuthorityManaged !== false ||
    value.requiresPolicyDecision !== true
  ) {
    throw new Error(
      "provider suitability context violates evidence-only authority invariants",
    );
  }
  if (value.providerOrder !== "lexicographic") {
    throw new Error("provider suitability context providerOrder must be lexicographic");
  }
  if (!Array.isArray(value.providers) || !record(value.query)) {
    throw new Error("provider suitability context must include providers and query");
  }
  return value as unknown as ProviderSuitabilityContextPack;
};

export const readProviderSuitabilityContextPack = async (
  path: string,
): Promise<ProviderSuitabilityContextPack> =>
  parseProviderSuitabilityContextPack(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );

export const writeProviderSuitabilityContextPack = async (
  path: string,
  pack: ProviderSuitabilityContextPack,
): Promise<void> => {
  parseProviderSuitabilityContextPack(pack);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
};
