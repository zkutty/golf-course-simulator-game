# Exact guarded replacement for Number(v.toFixed(6))

Acceptance proof for the guarded collision helper, prepared October 23, 2026. Results, model versions, physical samples and output tolerances remain unchanged. Exact-candidate release gates still govern deployment.

Proposed branch with an explicit noncoercing primitive-Number guard (other carriers execute their original toFixed behavior):

```js
if (v === 0) return 0;
if (typeof v === "number" && Math.abs(v) < 1_000_000) {
  const scaled = v * 1_000_000;
  const nearest = Math.round(scaled);
  if (Math.abs(scaled - nearest) < 0.499) return nearest / 1_000_000;
}
return Number(v.toFixed(6));
```

## Proof of identical Number bits

Let X be the exact real value of the binary64 input, S = X*10^6 the mathematical product, P the binary64 `scaled`, N the integral Number returned by Math.round(P), D = |P-N| the mathematical distance, and d the computed absolute subtraction. All the reasoning below applies only inside |X|<10^6. It makes no decimal approximation of X.

1. The exact multiplication has |S|<10^12<2^40. Correct binary64 rounding therefore has absolute error |P-S|<=2^-14: below 2^40 the largest spacing is 2^-13, and nearest rounding is at most half that spacing. This bound also covers all smaller normal and subnormal products. Multiplication by the exactly representable integer 10^6 cannot overflow here.
2. Math.round returns an actual nearest integral Number, so D<=1/2. N is exactly representable, since |N|<=10^12<2^40<<2^53. Computing P-N has absolute error <=2^-54 (a conservative half-ulp bound for a result with magnitude <=1/2); abs adds no error. Sterbenz exact subtraction would be stronger but is unnecessary.
3. Let T be the exact binary64 constant written `0.499`. T<=499/1000+2^-54. The successful guard gives |S-N|<=|S-P|+D < 2^-14+T+2^-54 <1/2. Thus N is the UNIQUE nearest integer to the exact mathematical S. Positive and negative ties cannot occur in this branch. Math.round's toward-positive-infinity tie convention is consequently irrelevant.
4. ECMAScript toFixed(6) selects the integer closest to |X|*10^6, choosing the greater positive integer at a tie, and applies the original negative sign. The unique integer in step 3 is precisely that choice with its sign. Hence its decimal string denotes exactly N/10^6.
5. The toFixed result in this domain has at most 13 significant decimal digits. StringNumericValue/RoundMVResult MUST convert values with <=20 significant digits to the nearest binary64 Number; its implementation-defined >20-digit allowance cannot apply. The numerator N and divisor 10^6 are exact Numbers, and Number::divide likewise correctly rounds the mathematical rational N/10^6. Both paths therefore return the same binary64 bits; dividing by 10^6 is NOT multiplication by the inexact constant 10^-6.
6. Signed zero: toFixed on either input zero yields the unsigned zero string, so `v===0` returns +0. A strictly negative nonzero input remains strictly negative after multiplying by 10^6 (the factor is >=1, so no underflow to zero); if Math.round returns zero it returns -0, and division by a positive divisor preserves -0. This matches parsing the negative zero string emitted by toFixed. Positive tiny inputs give +0.
7. Inputs with |v|>=10^6, near-half scaled values, NaN, and infinities run the original expression verbatim. No proof claim or altered arithmetic is needed for overflow, large-integer formatting, toFixed's >=10^21 notation rule, or nonfinite values.

## Primary normative sources

- [Number.prototype.toFixed](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.prototype.tofixed): exact real-value nearest decimal integer and sign handling.
- [Number multiply/divide](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-multiply): binary64 multiplication/division; their final steps use the Number-value rounding operation.
- [StringNumericValue and RoundMVResult](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-stringtonumber): correctly rounded conversion for <=20 significant digits, including negative-zero parsing.
- [Math.round](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.round): nearest integer, negative-zero behavior, and the warning that floor(x+.5) can differ.

## Audit evidence and counterexamples

`NUMERIC-AUDIT.mjs` checks Object.is equality, including signed zero. It independently decodes binary64 significand/exponent to a BigInt rational and performs exact decimal-integer rounding for every accepted fast branch. It also checks decimal-string parsing against exact-integer division separately.

The bounded deterministic audit passed 532,609 complete comparisons (356,898 accepted fast branches), including random raw binary64 values, both signs, decimal-half neighbors, all binary exponent boundaries, subnormal/normal boundaries, the domain boundary, overflow and nonfinite inputs. Another 400,000 comparisons verified decimal-rational parse/division equality. Zero mismatches. These checks corroborate the proof; they do not establish it by sampling.

The unguarded Math.round(v*1e6)/1e6 expression had 23,462 mismatches in the same audit. Examples:

- v=5e-7: computed scaled value is .5, but exact binary input lies below the decimal midpoint; original returns +0, naive returns .000001. The guard falls back.
- v=-.0078125 (an exact binary/decimal half): original returns -.007813, naive returns -.007812. The guard falls back.
- v=999999.9999995: original returns 999999.999999, naive returns 1000000. The guard falls back.
- v=-0: original returns +0, naive preserves -0. The explicit zero branch matches the original.
- v=Number.MAX_VALUE: naive multiplication overflows; original remains finite. The domain guard falls back.

## Release value and acceptance boundary

This primitive accounts for about a quarter of remaining workload cost, so it has a plausible material payoff. The proof supports only this fixed-digit, bounded, separated branch. It does not authorize generic decimal rounding, changing digits/bounds/thresholds, multiplying by 1e-6, replacing Math.round with floor(scaled+.5), or weakening any equality check.

Before product use: independent numerical review of the proof, direct Object.is regressions for all listed special classes, exhaustive frozen-collision oracle results, and full M61/live/ZK813/ProAm byte equality plus unchanged historical golden and delivery gate. The original analysis packet made no source changes; the later authorized implementation must retain the explicit primitive-Number guard.

Runtime carriers that are not primitive Numbers execute the original expression, preserving errors and custom/boxed `toFixed` behavior. The production helper is extracted directly by `obstacleCollisionRounding.test.ts` for Object.is comparisons; the exhaustive collision oracle remains frozen at db5e345.

The attached `NUMERIC-PERFORMANCE.json` records the accepted local workload comparisons. Its primitive audit ran before source integration; it is supplementary to the proof and production-helper tests. Hosted release acceptance is recorded separately in CI and Linear.

Reproduce the independent rational audit from the app directory with `node artifacts/shot-styles/NUMERIC-AUDIT.mjs`; run the production-helper regressions with `npx vitest run src/game/rules/obstacleCollisionRounding.test.ts`.
