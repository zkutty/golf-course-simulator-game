type ModuleOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

export type RendererStartupResult<TModules, TActivation> =
  | { kind: "cancelled" }
  | { kind: "ready"; modules: TModules; activation: TActivation };

/** Start code loading alongside Pixi initialization, but activate atlases only after both finish. */
export async function prepareRendererStartup<TModules, TActivation>(
  initialize: () => Promise<void>,
  loadModules: () => Promise<TModules>,
  activateAtlases: () => Promise<TActivation>,
  isCancelled: () => boolean,
): Promise<RendererStartupResult<TModules, TActivation>> {
  const initialized = initialize();
  let loading: Promise<TModules>;
  try {
    loading = loadModules();
  } catch (error) {
    loading = Promise.reject(error);
  }
  // Handle an import failure immediately, including while Pixi init is pending.
  // Re-throw it only after init so init failures keep their original precedence.
  const modules: Promise<ModuleOutcome<TModules>> = loading.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );

  await initialized;
  if (isCancelled()) return { kind: "cancelled" };
  const moduleOutcome = await modules;
  if (isCancelled()) return { kind: "cancelled" };
  if (!moduleOutcome.ok) throw moduleOutcome.error;
  const activation = await activateAtlases();
  if (isCancelled()) return { kind: "cancelled" };
  return { kind: "ready", modules: moduleOutcome.value, activation };
}
