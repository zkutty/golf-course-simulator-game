/** Proposed interface only. This file is outside src and is not imported by the game. */
export type Vec2 = readonly [number, number];
export type Phase = 'walk' | 'settle' | 'address' | 'backswing' | 'contact' |
  'follow-through' | 'watch' | 'reaction' | 'walk-on' | 'wait' | 'putt' | 'chip' | 'bunker';
export type Hand = 'right' | 'left' | 'unspecified';
export interface RetainedIdentity {
  readonly shotId: string; readonly holeId: string; readonly shotNumber: number;
  readonly seed: number; readonly club: string; readonly style: string; readonly modelVersion: string;
}
export interface CursorV1 { readonly version: 1; readonly key: string; readonly elapsedMs: number }
export interface ActivityInputV1 {
  readonly version: 1; readonly scopeId: string; readonly actorId: string;
  readonly appearanceId: string; readonly handedness: Hand; readonly ownerKey: string | null;
  readonly authorityRevision: string; readonly authorityPosition: Vec2;
  readonly route: { readonly revision: string; readonly legal: true; readonly points: readonly Vec2[] } | null;
  readonly shotIdentity: RetainedIdentity | null;
  readonly pacingCursor: CursorV1 | null;
  /** Exact output of the published shotPacingFrame. Do not derive another clock. */
  readonly pacingFrame: { readonly key: string; readonly motionProgress: number; readonly phase: string; readonly complete: boolean } | null;
  /** Reference to validated retained evidence, never a reconstructed/second solver payload. */
  readonly retainedEvidence: { readonly key: string; readonly validated: true } | null;
  readonly observedOutcome: { readonly key: string; readonly endpointObserved: true;
    readonly result: 'hole-out' | 'exceptional' | 'good' | 'bad' | 'neutral'; readonly evidenceId: string } | null;
  readonly observedEventIds: readonly string[];
  readonly visibility: 'visible' | 'culled';
  readonly quality: 'high' | 'medium' | 'low'; readonly motionEnabled: boolean;
  readonly followExplicit: boolean; readonly paused: boolean; readonly hidden: boolean;
}
export interface ActivityOutputV1 {
  readonly version: 1; readonly ownerKey: string | null; readonly authorityRevision: string;
  readonly phase: Phase; readonly clipId: string; readonly frame: number;
  readonly targetOctant: number; readonly mirror: boolean; readonly handedness: Hand;
  readonly groundAnchor: Vec2; readonly footAnchors: readonly [Vec2, Vec2];
  readonly handAnchor: Vec2 | null; readonly clubAnchor: Vec2 | null;
  readonly position: Vec2; readonly stridePhase: number; readonly ballMotionProgress: number | null;
  readonly reaction: 'nod' | 'sigh' | 'brief-celebration' | null;
  readonly consumedEventIds: readonly string[]; readonly fallbackReason: string | null;
}
