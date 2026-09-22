import type {
  OutcomeContract,
  RuntimeEvidenceItem,
  RuntimeVerificationResult,
} from "./types.js";

export const verifyOutcome = (
  outcome: OutcomeContract,
  evidence: readonly RuntimeEvidenceItem[],
): RuntimeVerificationResult => {
  const observed = new Set(
    evidence.flatMap((item) => item.requirementIds),
  );

  const requiredIds = outcome.requiredEvidence.map((requirement) => requirement.id);
  const satisfied = requiredIds.filter((id) => observed.has(id));
  const missing = requiredIds.filter((id) => !observed.has(id));

  return {
    success: missing.length === 0,
    satisfied,
    missing,
    notes:
      missing.length === 0
        ? ["all required evidence is present"]
        : ["run cannot complete while required evidence is missing"],
  };
};
