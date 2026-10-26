import { useCallback, useEffect, useRef } from "react";
import type { PlayerPlayableRound, PlayerShotTrace } from "../../game/models/playerProTypes";
import {
  isPlayerShotPresentation,
  playerShotActivityIsCurrent,
  playerShotActivitySample,
  type PlayerShotActivitySampleV1,
  type PlayerShotPlaybackFrame,
  type PlayerShotPresentationV1,
} from "../../game/playerPro/shotPlayback";
import { advanceShotPacingCursor, createShotPacingCursor, createShotPacingPlan, shotPacingEventProgress, shotPacingFrame } from "../../game/live/shotPacing";
import { isValidRetainedShotMotionV1, type RetainedShotMotionV1, type ShotMotionEventV1 } from "../../game/rules/shotMotion";

export type PlayerPlaybackEvent = { kind: "contact" } | ShotMotionEventV1;

/** Presentation clock only. Completion is claimed once for this exact shot. */
export function createPlayerShotPlaybackDriver(shot: PlayerShotTrace, saved?: PlayerShotPresentationV1, scopeId = "player", actorId = "player", handedness: "right" | "left" | null = null) {
  const motion = shot.sharedOutcome?.motion;
  const plan = motion && createShotPacingPlan({ scopeId, actorId, motion, distanceYards: shot.carryYards + (shot.rollYards ?? 0) });
  if (!plan) throw new Error("Player playback requires validated retained shot motion.");
  const progress = isPlayerShotPresentation(saved, shot.id) ? saved.progress : 0;
  let cursor = createShotPacingCursor(plan, { version: 1, key: plan.key, elapsedMs: progress * plan.durationMs });
  let completed = false;
  const events = [
    { at: shotPacingEventProgress(plan, 0)!, event: { kind: "contact" } as PlayerPlaybackEvent },
    ...motion!.events.filter((event) => event.kind !== "launch" && event.kind !== "rest").map((event) => ({
      at: shotPacingEventProgress(plan, event.time)!, event,
    })),
  ];
  let eventIndex = events.findIndex((event) => event.at > progress);
  if (eventIndex < 0) eventIndex = events.length;
  const presentation = (): PlayerShotPresentationV1 => ({ version: 1, shotId: shot.id, progress: cursor.elapsedMs / plan.durationMs });
  const frame = (): PlayerShotPlaybackFrame => ({ ...shotPacingFrame(plan, cursor)!,
    addressProgress: Math.min(1, cursor.elapsedMs / plan.addressMs) });
  return {
    cursor: presentation,
    frame,
    plan,
    sample: (): PlayerShotActivitySampleV1 | null => {
      const current = shotPacingFrame(plan, cursor);
      return current && shot.id === plan.identity.shotId ? playerShotActivitySample(plan, cursor, current, motion!, scopeId, actorId, handedness) : null;
    },
    advance(elapsedMs: number, paused = false, skip = false, hidden = false) {
      cursor = advanceShotPacingCursor(plan, cursor, elapsedMs, { paused, skip, hidden })!;
      const next = frame();
      const crossed: PlayerPlaybackEvent[] = [];
      while (eventIndex < events.length && events[eventIndex]!.at <= next.progress) {
        if (!skip) crossed.push(events[eventIndex]!.event);
        eventIndex += 1;
      }
      const complete = next.complete && !completed;
      if (complete) completed = true;
      return { frame: next, events: crossed, complete };
    },
  };
}

interface PlaybackOptions {
  round: PlayerPlayableRound | null;
  actorId?: string;
  paused: boolean;
  immediate: boolean;
  onCheckpoint: (roundId: string, cursor: PlayerShotPresentationV1) => void;
  onComplete: (roundId: string, shotId: string) => void;
  onEvent: (round: PlayerPlayableRound, shot: PlayerShotTrace, event: PlayerPlaybackEvent) => void;
}

/** A ref cursor keeps React/session updates at coarse checkpoints, not frames. */
export function usePlayerShotPlayback(options: PlaybackOptions) {
  const frameRef = useRef<PlayerShotPlaybackFrame | null>(null);
  const activitySampleRef = useRef<PlayerShotActivitySampleV1 | null>(null);
  const activitySourceRef = useRef<{ shot: PlayerShotTrace; motion: RetainedShotMotionV1 } | null>(null);
  const optionsRef = useRef(options);
  const skipRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    optionsRef.current = options;
    const pending = options.round?.phase === "flight" ? options.round.pendingShot : null;
    if (!playerShotActivityIsCurrent(activitySampleRef.current, options.round, options.actorId)
      || activitySourceRef.current?.shot !== pending || activitySourceRef.current?.motion !== pending?.sharedOutcome?.motion) activitySampleRef.current = null;
  });
  const shot = options.round?.phase === "flight" ? options.round.pendingShot : null;
  const retained = isValidRetainedShotMotionV1(shot?.sharedOutcome?.motion);
  const key = retained && options.round && shot ? `${options.round.id}:${options.actorId ?? "player"}:${shot.id}` : null;
  useEffect(() => {
    const initial = optionsRef.current;
    const round = initial.round;
    const pending = round?.phase === "flight" ? round.pendingShot : null;
    if (!key || !round || !pending || !isValidRetainedShotMotionV1(pending.sharedOutcome?.motion)) {
      frameRef.current = null;
      activitySampleRef.current = null;
      activitySourceRef.current = null;
      skipRef.current = null;
      return;
    }
    const driver = createPlayerShotPlaybackDriver(pending, round.shotPresentation, round.id, initial.actorId, round.handedness ?? null);
    const ownedMotion = pending.sharedOutcome!.motion;
    activitySourceRef.current = { shot: pending, motion: ownedMotion! };
    frameRef.current = driver.frame();
    activitySampleRef.current = driver.sample();
    let lastTime: number | null = null;
    let request = 0;
    let checkpoint = Math.floor(driver.cursor().progress * 10);
    let finished = false;
    const publish = (elapsed: number, skip = false) => {
      if (finished) return;
      const current = optionsRef.current;
      const paused = current.paused;
      const result = driver.advance(elapsed, paused, skip || current.immediate && !paused, document.hidden);
      frameRef.current = result.frame;
      const sample = driver.sample();
      activitySampleRef.current = current.round?.pendingShot === pending && current.round.pendingShot.sharedOutcome?.motion === ownedMotion
        && playerShotActivityIsCurrent(sample, current.round, current.actorId) ? sample : null;
      const bucket = Math.floor(result.frame.progress * 10);
      if (bucket !== checkpoint || result.events.length || result.complete) {
        checkpoint = bucket;
        current.onCheckpoint(round.id, driver.cursor());
      }
      for (const event of result.events) current.onEvent(round, pending, event);
      if (result.complete) {
        finished = true;
        current.onComplete(round.id, pending.id);
      }
    };
    const tick = (now: number) => {
      publish(lastTime === null ? 0 : now - lastTime);
      lastTime = now;
      if (!finished) request = requestAnimationFrame(tick);
    };
    const checkpointVisibility = () => {
      lastTime = null;
      optionsRef.current.onCheckpoint(round.id, driver.cursor());
    };
    skipRef.current = () => publish(0, true);
    document.addEventListener("visibilitychange", checkpointVisibility);
    window.addEventListener("pagehide", checkpointVisibility);
    request = requestAnimationFrame(tick);
    return () => {
      activitySampleRef.current = null;
      activitySourceRef.current = null;
      cancelAnimationFrame(request);
      document.removeEventListener("visibilitychange", checkpointVisibility);
      window.removeEventListener("pagehide", checkpointVisibility);
      if (!finished && optionsRef.current.round?.pendingShot === pending) optionsRef.current.onCheckpoint(round.id, driver.cursor());
      skipRef.current = null;
    };
  }, [key, shot]);
  const skip = useCallback(() => skipRef.current?.(), []);
  return { frameRef, activitySampleRef, skip };
}
