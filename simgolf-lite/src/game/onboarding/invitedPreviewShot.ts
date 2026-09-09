import type { LiveShotOutcome } from "../live/m47Types";
import type { InvitedPreviewShotEvidence } from "./invitedPreview";
import { projectCommittedShot } from "../rules/shotTruth";

/** Preserve the v1 receipt bytes. Its `rest` means next lie, not physical rest. */
export function invitedPreviewShot(shot: LiveShotOutcome): InvitedPreviewShotEvidence {
  const truth = projectCommittedShot(shot);
  return {
    shotNumber: truth.shotNumber,
    intent: shot.intent,
    club: truth.club,
    from: { ...truth.from },
    landing: { ...shot.landing },
    rest: { ...truth.nextLiePosition },
    lieAfter: truth.lieAfter,
    penaltyStrokes: shot.penaltyStrokes,
  };
}
