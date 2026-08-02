# ZK-681 Worker offload decision

Decision: **adopt a persistent Web Worker only for on-demand, non-authoritative analysis**.

Course state, simulation, saves, and gameplay decisions remain on `GameSession` and the existing deterministic main-thread authorities. The Worker may compute advisory architecture/routing, fine-green/slope, habitat-map, or similarly expensive analysis from an immutable snapshot. A result is usable only when its request is still active and its `GameSession.revision` is current.

## Evidence

The automated Chromium benchmark runs the production `analyzeArchitecture`, `analyzeShotSlope`, and `deriveTreeHabitat` functions on a deterministic 220×140, 36-hole fixture. It compares the same snapshot on the main thread and in a real module Worker; the surface workload transfers its 246,400-byte elevation buffer rather than cloning it.

The committed machine report at `artifacts/zk-681/worker-benchmark.json` recorded:

| Workload | Payload | Main compute | Dispatch / serialization | Worker compute | End to end | Equivalent |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Architecture and routing | 391,031 B | 137.8 ms | 2.3 ms | 146.7 ms | 287.6 ms | Yes |
| Surface slope and habitat | 461,251 B | 12.0 ms | 2.2 ms | 11.3 ms | 16.2 ms | Yes |

Both representative tasks exceeded the renderer's existing 8 ms work budget in the committed run. Worker end-to-end latency is not lower—especially on cold architecture startup—but the on-demand result can arrive later without monopolizing the render/input thread. A persistent Worker should therefore be created or prewarmed when a heavy analysis surface opens, reused while that surface is active, and torn down with the owning session. Smaller real inputs remain on the main thread unless they cross the same gate.

The same browser run proves output-digest equivalence, explicit cancellation rejection, stale-revision rejection after a session update, and Worker termination through session teardown. The existing unit suite separately checks the versioned protocol and forwarded transfer list.

## Gate and boundaries

- Adopt for advisory, latency-tolerant analysis that exceeds 8 ms on a representative snapshot.
- Keep cheap, per-frame, authoritative, save-affecting, and simulation work on the main thread.
- Transfer owned typed-array snapshots when ownership can safely move; never detach live game-state storage.
- Cancel superseded requests and reject every response whose revision no longer matches `GameSession.revision`.
- Preserve deterministic output equivalence as a required automated gate.
- Fall back to the synchronous analyzer if Worker construction is unavailable; the result remains advisory either way.

This is machine evidence from Playwright Chromium, which exercises the same Blink/V8 module-Worker path used by Electron. Production build and packaged-Electron smoke prove the Worker chunk is bundled. Physical-device performance, long-session behavior, and subjective human validation are deliberately postponed to the later certification gate.
