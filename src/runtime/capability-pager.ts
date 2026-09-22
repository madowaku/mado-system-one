import { CapabilityRegistry } from "../capability/registry.js";
import { CapabilityResolver } from "../capability/resolver.js";
import type { CapabilityDescriptor } from "../capability/types.js";
import type { RuntimeCapabilityRef } from "./types.js";

export interface CapabilityRequirement {
  id: string;
  request: string;
  reason: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface CapabilityPage {
  capabilityId: string;
  descriptor: CapabilityDescriptor;
  requirementIds: readonly string[];
  alternatives: readonly string[];
  wideTraceIds: readonly string[];
  deepTraceIds: readonly string[];
}

export interface UnresolvedCapabilityRequirement {
  id: string;
  request: string;
  reason: string;
  reasonCodes: readonly string[];
  wideTraceId: string;
  deepTraceId?: string;
}

export interface CapabilityPagerResult {
  capabilities: readonly RuntimeCapabilityRef[];
  pages: readonly CapabilityPage[];
  unresolved: readonly UnresolvedCapabilityRequirement[];
}

interface MutablePage {
  descriptor: CapabilityDescriptor;
  requirementIds: string[];
  alternatives: Set<string>;
  wideTraceIds: string[];
  deepTraceIds: string[];
}

export class CapabilityPager {
  readonly #resolver: CapabilityResolver;
  readonly #registry: CapabilityRegistry;

  constructor(options: {
    resolver: CapabilityResolver;
    registry: CapabilityRegistry;
  }) {
    this.#resolver = options.resolver;
    this.#registry = options.registry;
  }

  async resolve(options: {
    traceId: string;
    requirements: readonly CapabilityRequirement[];
  }): Promise<CapabilityPagerResult> {
    const selected = new Map<string, MutablePage>();
    const unresolved: UnresolvedCapabilityRequirement[] = [];

    for (const requirement of options.requirements) {
      const suggestion = await this.#resolver.resolve({
        traceId: `${options.traceId}:${requirement.id}`,
        request: requirement.request,
        ...(requirement.metadata ? { metadata: requirement.metadata } : {}),
      });

      if (!suggestion.suggestedCapability) {
        unresolved.push({
          id: requirement.id,
          request: requirement.request,
          reason: requirement.reason,
          reasonCodes: suggestion.reasonCodes,
          wideTraceId: suggestion.wideTraceId,
          ...(suggestion.deepTraceId
            ? { deepTraceId: suggestion.deepTraceId }
            : {}),
        });
        continue;
      }

      const descriptor = this.#registry.get(suggestion.suggestedCapability);

      if (!descriptor || descriptor.availability !== "available") {
        unresolved.push({
          id: requirement.id,
          request: requirement.request,
          reason: requirement.reason,
          reasonCodes: [
            ...suggestion.reasonCodes,
            "selected_capability_not_available",
          ],
          wideTraceId: suggestion.wideTraceId,
          ...(suggestion.deepTraceId
            ? { deepTraceId: suggestion.deepTraceId }
            : {}),
        });
        continue;
      }

      const existing = selected.get(descriptor.id);

      if (existing) {
        existing.requirementIds.push(requirement.id);
        existing.wideTraceIds.push(suggestion.wideTraceId);
        if (suggestion.deepTraceId) {
          existing.deepTraceIds.push(suggestion.deepTraceId);
        }
        for (const alternative of suggestion.alternatives) {
          existing.alternatives.add(alternative);
        }
        continue;
      }

      selected.set(descriptor.id, {
        descriptor,
        requirementIds: [requirement.id],
        alternatives: new Set(suggestion.alternatives),
        wideTraceIds: [suggestion.wideTraceId],
        deepTraceIds: suggestion.deepTraceId ? [suggestion.deepTraceId] : [],
      });
    }

    const pages: CapabilityPage[] = [...selected.entries()].map(
      ([capabilityId, page]) => ({
        capabilityId,
        descriptor: page.descriptor,
        requirementIds: page.requirementIds,
        alternatives: [...page.alternatives],
        wideTraceIds: page.wideTraceIds,
        deepTraceIds: page.deepTraceIds,
      }),
    );

    const capabilities: RuntimeCapabilityRef[] = pages.map((page) => ({
      id: page.capabilityId,
      reason: `required by capability requirement(s): ${page.requirementIds.join(", ")}`,
    }));

    return {
      capabilities,
      pages,
      unresolved,
    };
  }
}
