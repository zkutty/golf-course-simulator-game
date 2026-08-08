export function createDeferredReporter<Args extends unknown[], Result>(
  load: () => Promise<((...args: Args) => Result) | undefined>,
): (...args: Args) => Result | undefined {
  let reporter: ((...args: Args) => Result) | undefined;
  let loading: Promise<typeof reporter> | undefined;
  return (...args) => {
    if (reporter) return reporter(...args);
    loading ??= load().then((loaded) => (reporter = loaded));
    void loading.then((loaded) => loaded?.(...args));
  };
}
