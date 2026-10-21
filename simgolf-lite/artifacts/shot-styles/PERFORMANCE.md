# Same-host 100-golfer comparison — 2026-10-21

Both runs used the unchanged `scripts/perf-smoke.mjs`, sequentially after other task-owned browser/build/test processes exited. Baseline is production source `0371b431ee07047155ec40c9f7362650bb423925`; candidate is the integrated shot-style working tree. The final source commit is recorded in the release evidence after committing. Budgets and run duration were unchanged.

| Measurement | Baseline | Candidate | Gate |
| --- | ---: | ---: | --- |
| Active synthetic golfers | 100 | 100 | unchanged fixture |
| Renderer mean tick work | 0.985 ms | 1.044 ms | ≤8 ms, both pass |
| Cold startup | 539 ms | 646 ms | ≤5000 ms, both pass |
| Headless frame p95 | 100.00 ms | 100.00 ms | reported, not asserted |
| Warmup / measurement | 8 / 20 s | 8 / 20 s | unchanged |

Both used Parkland, 1440×900, DPR1, 4× live speed and a slow camera pan. The browser reports SwiftShader software WebGL2. This measures JS work; neither headless FPS nor this run establishes physical GPU frame pacing, thermal behavior or human golf authenticity. AC power was observed with `pmset -g batt`; the hardware-class query was sandbox-denied and remains null in the raw evidence. No local inference model was loaded by this task.

The established performance fixture consists of 100 synthetic walking golfers. A candidate fixture consistency correction clears the template's unused shot outcomes when replacing its entire itinerary with a synthetic walk. Those walkers never played those retained shots; this prevents an invalid saved owner/segment association and does not remove motion from actual gameplay. Existing save-size and 100-golfer restore assertions are preserved.

Separate retained-scene tests cover 100 motion-bearing actors, all four rotations, offscreen culling, repeated events and stable display pools. Actual selected AI airborne pixels and Player Pro continuous playback are verified in [EVIDENCE.md](EVIDENCE.md) and [FINAL_BROWSER_GATES.md](FINAL_BROWSER_GATES.md). Those functional checks are not misrepresented as a 100-concurrent-airborne GPU benchmark.

Raw evidence: [baseline](perf-baseline.json), [candidate](perf-candidate.json).
