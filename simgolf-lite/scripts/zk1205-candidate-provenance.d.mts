export interface Zk1205CandidateProvenance {
  checkout: {
    commit: string | null;
    worktree: "clean" | "dirty" | "unknown";
    dirtyEntries: string[] | null;
  };
  ci: {
    source: string | null;
    commit: string | null;
    state: "missing" | "available" | "invalid";
  };
  relationship: "match" | "conflict" | "unknown";
}

export interface Zk1205ProvenanceInput {
  checkoutCommit?: unknown;
  dirtyEntries?: string[] | null;
  ciCommit?: unknown;
  ciSource?: string | null;
}

export type Zk1205GitReader = (args: string[]) => string | null;

export function normalizeZk1205CandidateProvenance(
  input?: Zk1205ProvenanceInput,
): Zk1205CandidateProvenance;

export function collectZk1205CandidateProvenance(
  runGit: Zk1205GitReader,
  env?: Record<string, string | undefined>,
): Zk1205CandidateProvenance;

export function captureZk1205CandidateProvenance(options?: {
  runGit?: Zk1205GitReader;
  env?: Record<string, string | undefined>;
}): Zk1205CandidateProvenance;
