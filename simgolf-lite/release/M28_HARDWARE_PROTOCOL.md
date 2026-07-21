# M28 hardware performance protocol

Test the deployed RC on one representative low-range and one mid-range device.
Record model, year, CPU, GPU, RAM, display resolution, OS, browser/version,
power state, and whether reduced-animation or performance settings are active.

Use the deterministic M27 36-hole estate with 100 golfers, ambient life, audio,
the Architect Report, and continuous camera movement. Measure cold startup,
save/load, paint latency, simulation tick work, mean/p95/max frame time, memory
at 0/15/30/60 minutes, and any user-visible stall.

The predeclared RC budgets are in `rc-config.json`: renderer work ≤8 ms,
hardware p95 frame time ≤33 ms, common interactions ≤100 ms, and no monotonic
heap growth beyond 32 MB during the one-hour session. Record raw results even
when a device misses a budget; do not retune the gate after measuring.

Playwright headless measurements and the deterministic soak are comparison
baselines only. They do not satisfy the two physical-device sign-offs.
