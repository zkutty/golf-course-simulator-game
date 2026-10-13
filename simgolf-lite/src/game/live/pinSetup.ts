import type {PinRotation} from "../models/types";

/** Requested setup by stable booked hole; fallback coordinates stay resolver-owned. */
export function bookedPinRotations(holeIds: readonly string[], rotation: PinRotation): Record<string,PinRotation> {
  return Object.fromEntries(holeIds.map((id)=>[id,rotation]));
}

export function requestedPinForHole(rotations: Readonly<Record<string,PinRotation>> | undefined, holeId: string): PinRotation | undefined {
  if(!rotations || !Object.prototype.hasOwnProperty.call(rotations,holeId))return undefined;
  const rotation=rotations[holeId];
  return rotation==="A" || rotation==="B" || rotation==="C" ? rotation : undefined;
}

/** A mixed daily setup must not masquerade as one frozen rotation. */
export function frozenCompletedPin(rotations: Readonly<Record<string,PinRotation>> | undefined, legacyRotation: PinRotation | undefined): PinRotation | undefined {
  const distinct=new Set(Object.values(rotations ?? {}));
  return distinct.size===0 ? legacyRotation : distinct.size===1 ? [...distinct][0] : undefined;
}
