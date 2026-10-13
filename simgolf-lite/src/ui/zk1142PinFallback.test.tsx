import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {HoleInspector} from "./HoleInspector";
import {createM23CourseSetupReferenceCourse} from "../game/testing/referenceCourse";
import {courseForCourseSetup,resolveCourseSetup} from "../game/models/courseSetup";

const evaluation: import("../game/eval/evaluateHole").HoleEvaluation={scratchShotsToGreen:2,bogeyShotsToGreen:3,autoPar:4,reachableInTwo:true,effectiveDistanceYards:350,issues:[]};
function partial(rotation:"B"|"C") {
  const original=createM23CourseSetupReferenceCourse();const hole={...original.holes[0],pinPositions:{...original.holes[0].pinPositions,[rotation]:null}};
  return {course:{...original,activePinRotation:rotation,holes:[hole]},hole};
}
describe("ZK1142 partial daily pin setup",()=>{
  for(const rotation of ["B","C"] as const){
    it(`uses the same ${rotation} to A fallback in inspection`,()=>{
      const {course,hole}=partial(rotation);const resolved=resolveCourseSetup(hole,"member",rotation);
      expect(resolved).toMatchObject({pinRotation:"A",usedPinFallback:true,pin:hole.green});
      expect(courseForCourseSetup(course,"member",rotation).holes[0].green).toEqual(resolved.pin);
    });
    it(`clearly discloses missing ${rotation} in the inspector`,()=>{
      const {course,hole}=partial(rotation);
      const html=renderToStaticMarkup(<HoleInspector course={course} hole={hole} holeIndex={0} evaluation={evaluation} showFixOverlay={false} setShowFixOverlay={()=>{}} />);
      expect(html).toContain(`Pin ${rotation} is not placed`);expect(html).toContain("Using Pin A");
    });
  }
});
