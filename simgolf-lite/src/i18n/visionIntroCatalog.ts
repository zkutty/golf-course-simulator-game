import { registerMessages } from "./core";

// This editorial copy is only consumed by the existing deferred Vision route.
export const visionIntroEn = {
  "vision.nav.aria": "CourseCraft vision navigation",
  "vision.nav.vision": "The Vision",
  "vision.nav.story": "The Story",
  "vision.nav.systems": "The Systems",
  "vision.nav.play": "Play It",
  "vision.nav.biomes": "The Landscapes",
  "vision.nav.world": "The World",
  "vision.back": "Back to game",
  "vision.share": "Share the vision",
  "vision.copied": "Link copied",
  "vision.share.title": "The vision for CourseCraft",
  "vision.share.text": "See the golf world you can shape in CourseCraft.",
  "vision.hero.kicker": "A living golf world, made yours",
  "vision.hero.title": "Build the course. Shape the world.",
  "vision.hero.deck": "A cozy golf world where you shape every contour, run the club, play the course yourself, and build a legacy that belongs to you.",
  "vision.hero.cta": "Explore the vision",
  "vision.hero.imageAlt": "An expansive living golf destination with a clubhouse, practice grounds, lakes, homes, golfers, and staff",
  "vision.hero.captionLabel": "The destination",
  "vision.hero.caption": "One estate, shaped from first survey to enduring institution",
  "vision.story.eyebrow": "The north star",
  "vision.story.title": "More than a course builder.",
  "vision.story.body": "CourseCraft is the fantasy of growing a patch of promising land into a golf world with history. Design holes worth remembering, play them through your own Player Pro, operate the club behind the scorecard, and watch every choice ripple across the estate.",
  "vision.principle.create.title": "Create it",
  "vision.principle.create.body": "Sculpt the ground, route the holes, set the tees and pins, and make strategic golf from the landscape you inherit.",
  "vision.principle.operate.title": "Run it",
  "vision.principle.operate.body": "Price the experience, staff the campus, manage pace, expand facilities, and keep the promises your club makes.",
  "vision.principle.remember.title": "Live with it",
  "vision.principle.remember.body": "Golfers develop opinions, records become lore, communities react, and the course earns a reputation that cannot be faked.",
  "vision.course.imageAlt": "A windswept coastal golf hole with alternate routes, golfers, grounds crew, dunes, bunkers, and a seaside green",
  "vision.course.imageCaption": "Storyboard 01 · The land becomes strategy",
  "vision.course.kicker": "Every hole is authored",
  "vision.course.title": "Read the land. Draw the risk. Watch it play.",
  "vision.course.body": "The course is not a backdrop. Its slopes, carries, approaches, hazards, sightlines, and walking routes create the decisions that golfers make—and the stories they tell afterward.",
  "vision.course.beat1": "Freeform routing and terrain sculpting",
  "vision.course.beat2": "Multiple tees, pins, and daily setups",
  "vision.course.beat3": "Golfer skill, personality, and shot planning",
  "vision.course.beat4": "Architecture reports and safety tradeoffs",
} as const;

export function registerVisionIntroCatalog(): () => void {
  return registerMessages(visionIntroEn);
}
