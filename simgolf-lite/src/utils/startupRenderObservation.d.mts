/** Unknown renderer identity stays unqualified; these functions grant no native/source authority. */
export function bootstrapStartupRenderObservation(): void;
export function observeStartupRenderer(renderer: unknown, ticker?: unknown): void;
export function activateStartupRenderer(renderer: unknown, ticker?: unknown): void;

/** Pure bounded transport. Expanded rows are RAM-only, never source authority. */
export function encodeStartupRenderObservation(value: unknown): Readonly<Record<string, unknown>>;
export function decodeStartupRenderObservation(value: unknown): Readonly<Record<string, unknown>>;
export function readStartupRenderObservation(value: unknown): Readonly<Record<string, unknown>>;
