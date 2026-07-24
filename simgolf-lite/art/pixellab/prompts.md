# PixelLab pilot prompts

These are production tests, not final art prompts. Always attach the named
CourseCraft reference asset and write output to `art/pixellab/staging/raw/`.
Do not ask for a named living artist, a copyrighted game, or copied assets.

## Natural-prop pilot

Generate one isolated modern-isometric golf-course prop matching the supplied
CourseCraft reference: chunky readable silhouette, toy-like proportions,
fixed NW/upper-left light, 1 px locally darkened outline, two to four stepped
values per material, restrained dusty color, transparent background, no floor,
no baked shadow, no text, no watermark. Center the ground contact at the
bottom of a 128×192 transparent canvas.

Run this contract for:

- a mature parkland oak with a broad asymmetric canopy;
- a compact cultivated shrub with a low rounded silhouette;
- a weathered granite rock with a hard triangular silhouette.

## Facility pilot

Generate an isolated 2:1 dimetric golf-cart rental shelter matching the
supplied CourseCraft facility reference. Preserve the same footprint, major
geometry, bottom-center ground anchor, fixed NW light, toy-like painted
materials, clean outline, and readable parked carts. Transparent background,
no terrain, no baked shadow, no people, no signs or text, no watermark.

Create consistent parkland, links, and desert treatments. The facility must
remain recognizably the same building across themes and required camera views;
only materials, planting, and restrained regional details may change.

## Golfer-animation pilot

Use the supplied CourseCraft golfer as an identity and pixel-density
reference. Preserve the 48×72 frame canvas, chibi 2.5-head proportions,
bottom-center anchor, feet line at y=69, fixed NW light, locally darkened
1 px outline, transparent background, consistent clothing and club, and the
five authored direction rows `[s, sw, w, nw, n]`.

Create:

- idle: 2 frames × 5 rows, planted feet and subtle breathing only;
- walk: 6 frames × 5 rows, one loop with no skating or scale jump;
- right-handed swing: 8 frames × 5 rows, frames 0–5 windup through contact,
  frame 5 exact contact, frames 6–7 follow-through and finish.

Do not add a ball, background, text, shadow, extra club, or camera movement.

## High-resolution benchmark alternative

Method: built-in high-resolution image generation with the existing
`parkland_cart_rental_t1.png` supplied as a visual reference. The raw output
used a flat magenta key, followed by hard chroma removal and the pilot's
premultiplied normalization into the existing 192×160 renderer frame.

Final prompt:

> Use case: stylized-concept. Asset type: high-resolution alternative
> candidate for a 2D isometric management-game facility sprite benchmark.
> Input image: visual reference only for CourseCraft's cart-rental facility
> identity, 2:1 dimetric angle, toy-like proportions, warm materials, and
> upper-left/NW light. Create one isolated golf-cart rental shelter with two
> readable cream golf carts under a dark green shingled roof, matching the
> same overall footprint and major geometry while rendering it as polished
> painterly modern-isometric game art. Single centered object, full shelter
> visible, generous even padding, bottom-center ground contact. Fixed
> upper-left/NW light; restrained southeast shading; no cast or contact shadow.
> Perfectly flat solid #ff00ff chroma-key background with no gradients,
> texture, floor plane, lighting variation, or reflections. Original clean
> modern-isometric course-builder art, chunky readable silhouette, locally
> darkened outline, two to four stepped values per material, saturated but
> dusty colors, no photorealism. No people, signs, letters, numbers, logo,
> watermark, surrounding terrain, or copied third-party design; do not use
> #ff00ff anywhere in the object.
