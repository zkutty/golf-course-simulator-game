export type StartupToken = Readonly<{ id: number; phase: number; parent: number; attempt: number; generation: number }> | null;
export function recordRendererStartupAttempt(recorder: Readonly<{ owner(generation: unknown): number }>, generationToken: unknown): number;
export function startupAttempt(generation: unknown): number;
export function startupBegin(phase: number, parent?: StartupToken, attempt?: number): StartupToken;
export function startupEnd(token: StartupToken, kind?: number): void;
export function startupCancel(attempt: number, kind?: number): void;
export function startupSpan<T>(phase: number, fn: (token: StartupToken) => T, parent?: StartupToken, attempt?: number): T;
