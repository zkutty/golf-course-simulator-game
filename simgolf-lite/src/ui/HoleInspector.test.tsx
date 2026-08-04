import { isValidElement, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { HoleEvaluation } from "../game/eval/evaluateHole";
import { validateStrokeIndexes } from "../game/models/strokeIndexes";
import type { Course, Hole } from "../game/models/types";
import { HoleInspector } from "./HoleInspector";

const evaluation: HoleEvaluation = {
  scratchShotsToGreen: 2,
  bogeyShotsToGreen: 3,
  autoPar: 4,
  reachableInTwo: true,
  effectiveDistanceYards: 350,
  issues: [],
};

function scorecard(length: 9 | 18): Course {
  const width = 10;
  const height = length + 2;
  return {
    width,
    height,
    tiles: Array.from({ length: width * height }, () => "rough" as const),
    elevations: Array(width * height).fill(0),
    holes: Array.from({ length }, (_, index) => ({
      id: `hole-${index + 1}`,
      name: `Hole ${index + 1}`,
      tee: { x: 1, y: index + 1 },
      green: { x: 8, y: index + 1 },
      parMode: "MANUAL" as const,
      parManual: 4 as const,
    })),
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "Stroke index editor fixture",
    baseGreenFee: 0,
    condition: 1,
  };
}

type StrokeIndexInputProps = {
  min?: number;
  max?: number;
  children?: ReactNode;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};

function findStrokeIndexInput(node: ReactNode): ReactElement<StrokeIndexInputProps> | null {
  if (!isValidElement<StrokeIndexInputProps>(node)) return null;
  if (node.type === "input" && node.props.min === 1 && node.props.max === 18) return node as ReactElement<{ min?: number; max?: number; onChange?: (event: ChangeEvent<HTMLInputElement>) => void }>;
  const children = node.props.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const input = findStrokeIndexInput(child);
      if (input) return input;
    }
    return null;
  }
  return findStrokeIndexInput(children);
}

function strokeIndexInput(course: Course, activeHoleIndex: number, onSetHoleIndex: (index: number) => void) {
  const inspector = HoleInspector({
    holeIndex: activeHoleIndex,
    evaluation,
    showFixOverlay: false,
    setShowFixOverlay: () => undefined,
    course,
    hole: course.holes[activeHoleIndex],
    onSetHoleIndex,
  });
  const input = findStrokeIndexInput(inspector);
  if (!input?.props.onChange) throw new Error("Stroke-index input was not rendered.");
  return input.props.onChange;
}

function editStrokeIndex(course: Course, activeHoleIndex: number, value: string): Course {
  let persisted = course;
  const onChange = strokeIndexInput(course, activeHoleIndex, (holeIndex) => {
    persisted = {
      ...persisted,
      holes: persisted.holes.map((hole, index) => index === activeHoleIndex
        ? { ...hole, holeIndex, holeIndexSource: "manual" as const }
        : hole),
    };
  });
  onChange({ target: { value } } as ChangeEvent<HTMLInputElement>);
  return persisted;
}

describe("ZK-742 manual stroke-index editor", () => {
  it("persists player-facing bounds one-based and marks them manual through the inspector callback", () => {
    let course = scorecard(18);
    course = editStrokeIndex(course, 0, "1");
    expect(course.holes[0]).toMatchObject({ holeIndex: 1, holeIndexSource: "manual" });

    course = editStrokeIndex(course, 0, "18");
    expect(course.holes[0]).toMatchObject({ holeIndex: 18, holeIndexSource: "manual" });
  });

  it.each([9, 18] as const)("creates a complete manual %i-hole scorecard accepted by the net/handicap route", (length) => {
    let course = scorecard(length);
    for (let index = 0; index < length; index++) course = editStrokeIndex(course, index, String(index + 1));

    expect(course.holes.every((hole) => hole.holeIndexSource === "manual")).toBe(true);
    expect(validateStrokeIndexes(course)).toEqual({ valid: true, reasons: [] });
  });

  it.each(["", "0", "19", "1.5", "4abc", "not-a-number"])("does not corrupt a valid manual index for invalid input %j", (value) => {
    const course = scorecard(9);
    const existing: Hole = { ...course.holes[0], holeIndex: 7, holeIndexSource: "manual" };
    const validCourse = { ...course, holes: [existing, ...course.holes.slice(1)] };

    expect(editStrokeIndex(validCourse, 0, value).holes[0]).toEqual(existing);
  });
});
