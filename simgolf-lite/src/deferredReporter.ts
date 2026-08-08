export type DeferredReporter<Args extends unknown[], Result> = ((...args: Args) => Result | undefined) & {
  load(): Promise<void>;
};

export function createDeferredReporter<Args extends unknown[], Result>(
  load: () => Promise<((...args: Args) => Result) | undefined>,
): DeferredReporter<Args, Result> {
  let reporter: ((...args: Args) => Result) | undefined;
  let loading: Promise<typeof reporter> | undefined;
  const ensureLoaded = () => loading ??= load().then((loaded) => (reporter = loaded));
  const deferred = ((...args: Args) => {
    if (reporter) return reporter(...args);
    void ensureLoaded().then((loaded) => loaded?.(...args));
  }) as DeferredReporter<Args, Result>;
  deferred.load = () => ensureLoaded().then(() => undefined);
  return deferred;
}
