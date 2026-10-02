import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  verifyBaselineLineageRegistry,
  type BaselineLineageRegistry,
} from "./registry.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseBaselineLineageRegistry = (
  value: unknown,
): BaselineLineageRegistry => {
  if (!record(value) || value.schemaVersion !== "mso.baseline-lineage.v0") {
    throw new Error(
      "baseline lineage registry must use schemaVersion mso.baseline-lineage.v0",
    );
  }
  if (!Array.isArray(value.events)) {
    throw new Error("baseline lineage registry events must be an array");
  }
  const registry = value as unknown as BaselineLineageRegistry;
  verifyBaselineLineageRegistry(registry);
  return registry;
};

const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
};

export const readBaselineLineageRegistry = async (
  path: string,
): Promise<BaselineLineageRegistry> =>
  parseBaselineLineageRegistry(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );

export const writeBaselineLineageRegistry = async (
  path: string,
  registry: BaselineLineageRegistry,
): Promise<void> => {
  verifyBaselineLineageRegistry(registry);
  await writeJsonAtomic(path, registry);
};

export const mutateBaselineLineageRegistry = async (
  path: string,
  mutate: (
    registry: BaselineLineageRegistry,
  ) => BaselineLineageRegistry | Promise<BaselineLineageRegistry>,
): Promise<BaselineLineageRegistry> => {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    throw new Error(
      `baseline lineage registry is locked by another writer: ${lockPath}`,
      { cause: error },
    );
  }

  try {
    const current = await readBaselineLineageRegistry(path);
    const next = await mutate(current);
    verifyBaselineLineageRegistry(next);
    await writeBaselineLineageRegistry(path, next);
    return next;
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
};

export const createBaselineLineageRegistryFile = async (
  path: string,
  registry: BaselineLineageRegistry,
): Promise<void> => {
  verifyBaselineLineageRegistry(registry);
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(path, "wx");
  } catch (error) {
    throw new Error(
      `baseline lineage registry already exists or cannot be created: ${path}`,
      { cause: error },
    );
  }
  try {
    await handle.writeFile(
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await handle.close();
  }
};
