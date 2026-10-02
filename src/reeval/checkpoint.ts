import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface CheckpointArtifactDigest {
  path: string;
  sha256: string;
  bytes: number;
}

export interface LayaCheckpointFingerprint {
  schemaVersion: "mso.laya-checkpoint.v0";
  ref: string;
  format: "laya-ts-onnx";
  fingerprint: string;
  artifacts: readonly CheckpointArtifactDigest[];
}

const digestFile = async (
  dir: string,
  rel: string,
): Promise<CheckpointArtifactDigest> => {
  const path = join(dir, ...rel.split("/"));
  const data = await readFile(path);
  const info = await stat(path);
  return {
    path: rel,
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: info.size,
  };
};

const exists = async (dir: string, rel: string): Promise<boolean> => {
  try {
    const info = await stat(join(dir, ...rel.split("/")));
    return info.isFile();
  } catch {
    return false;
  }
};

export const fingerprintLayaOnnxCheckpoint = async (
  dir: string,
  ref: string,
): Promise<LayaCheckpointFingerprint> => {
  if (!ref.trim()) throw new Error("checkpoint ref must be non-empty");

  const required = [
    "rl_agent_config.json",
    "encoder.onnx",
    "head.onnx",
  ];
  for (const rel of required) {
    if (!(await exists(dir, rel))) {
      throw new Error(
        `Laya ONNX checkpoint ${ref} is missing required artifact: ${rel}`,
      );
    }
  }

  const tokenizer =
    (await exists(dir, "tokenizer.json"))
      ? "tokenizer.json"
      : (await exists(dir, "tokenizer/tokenizer.json"))
        ? "tokenizer/tokenizer.json"
        : null;
  if (!tokenizer) {
    throw new Error(
      `Laya ONNX checkpoint ${ref} is missing tokenizer.json or tokenizer/tokenizer.json`,
    );
  }

  const optional = ["encoder.onnx.data", "head.onnx.data"];
  const rels = [...required, tokenizer];
  for (const rel of optional) {
    if (await exists(dir, rel)) rels.push(rel);
  }

  const artifacts: CheckpointArtifactDigest[] = [];
  for (const rel of rels.sort()) {
    artifacts.push(await digestFile(dir, rel));
  }

  const fingerprint = createHash("sha256")
    .update(
      artifacts
        .map((item) => `${item.path}\0${item.sha256}\0${item.bytes}`)
        .join("\n"),
    )
    .digest("hex");

  return {
    schemaVersion: "mso.laya-checkpoint.v0",
    ref,
    format: "laya-ts-onnx",
    fingerprint,
    artifacts,
  };
};
