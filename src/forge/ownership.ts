import {
  type OwnershipLease,
  ForgeContractError,
} from "./contracts.js";

export interface OwnershipConflict {
  leftSurfaceId: string;
  rightSurfaceId: string;
  leftOwnerAgentId: string;
  rightOwnerAgentId: string;
  leftWriteScope: string;
  rightWriteScope: string;
}

const normalizeScope = (scope: string): string => {
  let normalized = scope.trim().replaceAll("\\", "/");

  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }

  normalized = normalized.replace(/\/+/g, "/");

  if (normalized.endsWith("/**")) {
    normalized = normalized.slice(0, -3);
  }

  while (normalized.endsWith("/") && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
};

const scopesOverlap = (left: string, right: string): boolean => {
  const a = normalizeScope(left);
  const b = normalizeScope(right);

  if (a.length === 0 || b.length === 0) {
    return false;
  }

  if (a === "*" || b === "*") {
    return true;
  }

  return (
    a === b ||
    a.startsWith(`${b}/`) ||
    b.startsWith(`${a}/`)
  );
};

export const detectOwnershipConflicts = (
  leases: readonly OwnershipLease[],
): readonly OwnershipConflict[] => {
  const conflicts: OwnershipConflict[] = [];

  for (let leftIndex = 0; leftIndex < leases.length; leftIndex += 1) {
    const left = leases[leftIndex];
    if (left === undefined) {
      continue;
    }

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < leases.length;
      rightIndex += 1
    ) {
      const right = leases[rightIndex];
      if (right === undefined || left.ownerAgentId === right.ownerAgentId) {
        continue;
      }

      for (const leftScope of left.allowedWrites) {
        for (const rightScope of right.allowedWrites) {
          if (scopesOverlap(leftScope, rightScope)) {
            conflicts.push({
              leftSurfaceId: left.surfaceId,
              rightSurfaceId: right.surfaceId,
              leftOwnerAgentId: left.ownerAgentId,
              rightOwnerAgentId: right.ownerAgentId,
              leftWriteScope: leftScope,
              rightWriteScope: rightScope,
            });
          }
        }
      }
    }
  }

  return conflicts;
};

export const assertNoOwnershipConflicts = (
  leases: readonly OwnershipLease[],
): void => {
  const conflicts = detectOwnershipConflicts(leases);

  if (conflicts.length === 0) {
    return;
  }

  const summary = conflicts
    .map(
      (conflict) =>
        `${conflict.leftOwnerAgentId}:${conflict.leftWriteScope} <-> ${conflict.rightOwnerAgentId}:${conflict.rightWriteScope}`,
    )
    .join(", ");

  throw new ForgeContractError(`ownership overlap detected: ${summary}`);
};
