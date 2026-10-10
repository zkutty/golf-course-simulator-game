export const CAPTURE: Readonly<{ bytes: 134217728; decodedUtf16Bytes: 134217728; deadlineMs: 120000; summaryBytes: 32768; blockChars: 16384; eintrRetries: 256 }>;
export const CANDIDATE: string;
export const PUBLICATION_AMENDMENT_SHA256: string;
export interface PublicCdpSession {
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
  send(method: 'HeapProfiler.takeHeapSnapshot'): Promise<unknown>;
}
export interface SaveFinalOwnerOptions {
  outputDirectory: string;
  candidateCommit: string;
  sampleCount: number;
  saveReportErrors: readonly string[];
}
export function captureSaveFinalOwnerGraph(cdp: PublicCdpSession, options: SaveFinalOwnerOptions): Promise<Record<string, unknown>>;
// ROOT controls use dependency injection from the .mjs source; production call
// exposes exactly the existing public session and the final SAVE metadata.
