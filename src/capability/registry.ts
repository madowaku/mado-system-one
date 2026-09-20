import type { CapabilityDescriptor } from "./types.js";

export class CapabilityRegistry {
  readonly #byId: Map<string, CapabilityDescriptor>;

  constructor(capabilities: readonly CapabilityDescriptor[]) {
    this.#byId = new Map();

    for (const capability of capabilities) {
      if (this.#byId.has(capability.id)) {
        throw new Error(`duplicate capability id: ${capability.id}`);
      }
      this.#byId.set(capability.id, capability);
    }
  }

  get(id: string): CapabilityDescriptor | undefined {
    return this.#byId.get(id);
  }

  list(): readonly CapabilityDescriptor[] {
    return [...this.#byId.values()];
  }

  listAvailable(): readonly CapabilityDescriptor[] {
    return this.list().filter((capability) => capability.availability === "available");
  }
}
