import { type SpecVerification } from "../../src/workflow/review-contracts.ts";

export const verifiedSpec: SpecVerification = {
  completeness: { status: "passed", evidence: "Tracked fixture tasks and source.txt inspected." },
  correctness: { status: "passed", evidence: "Fixture behavior and configured checks agree." },
  coherence: { status: "passed", evidence: "Fixture implementation follows its approved plan." },
  conflicts: [],
};

export const failedSpec: SpecVerification = {
  ...verifiedSpec,
  correctness: { status: "failed", evidence: "The boundary behavior in source.txt is missing." },
};
