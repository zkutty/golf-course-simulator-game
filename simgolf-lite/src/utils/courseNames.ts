// Fun default course names for the new-game wizard (ZKU-162). UI-side
// randomness only — never used by the sim.

const NAME_FIRST = [
  "Willow", "Bent", "Heron", "Fox", "Cedar", "Alder", "Stone", "Misty",
  "Golden", "Quail", "Bramble", "Hollow", "Juniper", "Clover", "Osprey", "Maple",
];
const NAME_SECOND = [
  "Creek", "Pines", "Hollow", "Ridge", "Meadows", "Glen", "Dunes", "Landing",
  "Crossing", "Point", "Fields", "Springs", "Bluff", "Run", "Vale", "Commons",
];

export function generateCourseName(): string {
  const a = NAME_FIRST[Math.floor(Math.random() * NAME_FIRST.length)];
  const b = NAME_SECOND[Math.floor(Math.random() * NAME_SECOND.length)];
  return `${a} ${b}`;
}
