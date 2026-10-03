import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import {
  deriveProviderEvidenceState,
  verifyProviderEvidenceLedger,
  type DerivedProviderEvidenceState,
  type ProviderEvidenceLedger,
} from "./provider-ledger.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseProviderEvidenceLedger = (
  value: unknown,
): ProviderEvidenceLedger => {
  if (
    !record(value) ||
    value.schemaVersion !== "mso.provider-evidence-ledger.v0"
  ) {
    throw new Error(
      "provider evidence ledger must use schemaVersion mso.provider-evidence-ledger.v0",
    );
  }
  if (!Array.isArray(value.events)) {
    throw new Error("provider evidence ledger events must be an array");
  }
  const ledger = value as unknown as ProviderEvidenceLedger;
  verifyProviderEvidenceLedger(ledger);
  return ledger;
};

const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
};

export const readProviderEvidenceLedger = async (
  path: string,
): Promise<ProviderEvidenceLedger> =>
  parseProviderEvidenceLedger(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );

export const writeProviderEvidenceLedger = async (
  path: string,
  ledger: ProviderEvidenceLedger,
): Promise<void> => {
  verifyProviderEvidenceLedger(ledger);
  await writeJsonAtomic(path, ledger);
};

export const createProviderEvidenceLedgerFile = async (
  path: string,
  ledger: ProviderEvidenceLedger,
): Promise<void> => {
  verifyProviderEvidenceLedger(ledger);
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(path, "wx");
  } catch (error) {
    throw new Error(
      `provider evidence ledger already exists or cannot be created: ${path}`,
      { cause: error },
    );
  }
  try {
    await handle.writeFile(
      `${JSON.stringify(ledger, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await handle.close();
  }
};

export const mutateProviderEvidenceLedger = async (
  path: string,
  mutate: (
    ledger: ProviderEvidenceLedger,
  ) => ProviderEvidenceLedger | Promise<ProviderEvidenceLedger>,
): Promise<ProviderEvidenceLedger> => {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    throw new Error(
      `provider evidence ledger is locked by another writer: ${lockPath}`,
      { cause: error },
    );
  }

  try {
    const current = await readProviderEvidenceLedger(path);
    const next = await mutate(current);
    verifyProviderEvidenceLedger(next);
    await writeProviderEvidenceLedger(path, next);
    return next;
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
};

export const writeProviderEvidenceSnapshot = async (
  path: string,
  state: DerivedProviderEvidenceState,
): Promise<void> => {
  await writeJsonAtomic(path, state);
};

export const writeDerivedProviderEvidenceSnapshot = async (
  path: string,
  ledger: ProviderEvidenceLedger,
): Promise<void> => {
  await writeProviderEvidenceSnapshot(path, deriveProviderEvidenceState(ledger));
};
