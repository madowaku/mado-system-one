import type { DisagreementRecord } from "../eval/disagreement.js";
import type { FineTuneAnnotation, SoftTarget } from "./candidate.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const probability = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a probability in [0,1]`);
  }
  return value;
};

const parseSoftTarget = (value: unknown, label: string): SoftTarget => {
  if (!record(value)) throw new Error(`${label} must be an object`);
  const type = text(value.type, `${label}.type`);
  const source = text(value.source, `${label}.source`);
  if (
    source !== "teacher" &&
    source !== "human" &&
    source !== "verified_outcome" &&
    source !== "deterministic_invariant"
  ) {
    throw new Error(`${label}.source unsupported: ${source}`);
  }

  const sourceRef =
    typeof value.sourceRef === "string" && value.sourceRef
      ? value.sourceRef
      : undefined;

  if (type === "choice") {
    if (!record(value.probabilities)) {
      throw new Error(`${label}.probabilities must be an object`);
    }
    const probabilities: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value.probabilities)) {
      probabilities[key] = probability(raw, `${label}.probabilities.${key}`);
    }
    return {
      type,
      probabilities,
      source,
      ...(sourceRef ? { sourceRef } : {}),
    };
  }

  if (type === "noul") {
    if (!record(value.probabilities)) {
      throw new Error(`${label}.probabilities must be an object`);
    }
    return {
      type,
      probabilities: {
        false: probability(value.probabilities.false, `${label}.probabilities.false`),
        true: probability(value.probabilities.true, `${label}.probabilities.true`),
      },
      source,
      ...(sourceRef ? { sourceRef } : {}),
    };
  }

  if (type === "score") {
    if (!Array.isArray(value.distribution)) {
      throw new Error(`${label}.distribution must be an array`);
    }
    return {
      type,
      distribution: value.distribution.map((item, index) =>
        probability(item, `${label}.distribution[${index}]`),
      ),
      source,
      ...(sourceRef ? { sourceRef } : {}),
    };
  }

  throw new Error(`${label}.type unsupported: ${type}`);
};

export const parseFineTuneAnnotationsJsonl = (
  input: string,
): FineTuneAnnotation[] => {
  const rows: FineTuneAnnotation[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of input.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`annotation line ${index + 1} is invalid JSON`);
    }
    if (!record(value) || value.schemaVersion !== "mso.finetune-annotation.v0") {
      throw new Error(
        `annotation line ${index + 1} must use schemaVersion mso.finetune-annotation.v0`,
      );
    }

    const recordId = text(value.recordId, `annotation line ${index + 1}.recordId`);
    if (seen.has(recordId)) {
      throw new Error(`duplicate fine-tune annotation: ${recordId}`);
    }
    seen.add(recordId);

    const decision = value.decision;
    if (decision !== "include" && decision !== "exclude") {
      throw new Error(
        `annotation line ${index + 1}.decision must be include|exclude`,
      );
    }

    const labelSource = value.labelSource;
    if (
      labelSource !== undefined &&
      labelSource !== "human" &&
      labelSource !== "verified_outcome" &&
      labelSource !== "deterministic_invariant"
    ) {
      throw new Error(`annotation line ${index + 1}.labelSource unsupported`);
    }

    const reviewedLabel = value.reviewedLabel;
    if (
      reviewedLabel !== undefined &&
      typeof reviewedLabel !== "string" &&
      typeof reviewedLabel !== "boolean" &&
      typeof reviewedLabel !== "number"
    ) {
      throw new Error(`annotation line ${index + 1}.reviewedLabel unsupported`);
    }

    rows.push({
      schemaVersion: "mso.finetune-annotation.v0",
      recordId,
      decision,
      ...(reviewedLabel === undefined ? {} : { reviewedLabel }),
      ...(labelSource === undefined ? {} : { labelSource }),
      ...(typeof value.reviewedAt === "string" && value.reviewedAt
        ? { reviewedAt: value.reviewedAt }
        : {}),
      ...(typeof value.reviewer === "string" && value.reviewer
        ? { reviewer: value.reviewer }
        : {}),
      ...(value.softTarget === undefined
        ? {}
        : {
            softTarget: parseSoftTarget(
              value.softTarget,
              `annotation line ${index + 1}.softTarget`,
            ),
          }),
      ...(typeof value.note === "string" && value.note ? { note: value.note } : {}),
    });
  }

  return rows;
};

export const parseDisagreementQueueJsonl = (
  input: string,
): DisagreementRecord[] => {
  const rows: DisagreementRecord[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of input.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`disagreement line ${index + 1} is invalid JSON`);
    }
    if (!record(value)) {
      throw new Error(`disagreement line ${index + 1} must be an object`);
    }

    const recordId = text(value.recordId, `disagreement line ${index + 1}.recordId`);
    if (seen.has(recordId)) {
      throw new Error(`duplicate disagreement record: ${recordId}`);
    }
    seen.add(recordId);

    text(value.caseId, `disagreement line ${index + 1}.caseId`);
    text(value.taskFamily, `disagreement line ${index + 1}.taskFamily`);
    text(value.questionId, `disagreement line ${index + 1}.questionId`);
    text(value.state, `disagreement line ${index + 1}.state`);
    if (!record(value.question) || !record(value.expected)) {
      throw new Error(
        `disagreement line ${index + 1} must contain question and expected objects`,
      );
    }
    if (typeof value.fineTuneCandidate !== "boolean") {
      throw new Error(
        `disagreement line ${index + 1}.fineTuneCandidate must be boolean`,
      );
    }

    rows.push(value as unknown as DisagreementRecord);
  }

  return rows;
};
