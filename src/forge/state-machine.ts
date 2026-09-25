import {
  type ForgePhase,
  ForgeContractError,
} from "./contracts.js";

export const FORGE_TRANSITIONS: Readonly<
  Record<ForgePhase, readonly ForgePhase[]>
> = {
  intake: ["diverge"],
  diverge: ["judge"],
  judge: ["synthesize", "diverge"],
  synthesize: ["specify"],
  specify: ["contract_freeze"],
  contract_freeze: ["build"],
  build: ["review"],
  review: ["integrate", "build"],
  integrate: ["experience_eval", "contract_freeze"],
  experience_eval: ["find", "fix"],
  find: ["falsify"],
  falsify: ["fix", "verify"],
  fix: ["verify"],
  verify: ["human_check", "fix"],
  human_check: ["release_gate", "specify", "fix"],
  release_gate: ["done", "fix"],
  done: [],
};

export const canTransitionForgePhase = (
  from: ForgePhase,
  to: ForgePhase,
): boolean => FORGE_TRANSITIONS[from].includes(to);

export const assertForgeTransition = (
  from: ForgePhase,
  to: ForgePhase,
): void => {
  if (!canTransitionForgePhase(from, to)) {
    throw new ForgeContractError(
      `invalid Forge phase transition: ${from} -> ${to}`,
    );
  }
};
