type ModuleOutcome<T> = { status: "fulfilled"; modules: T } | { status: "rejected"; error: unknown };

export interface RendererModuleInitializationPorts<Application, Modules> {
  acquire(): Promise<Application | null>;
  loadModules(): Promise<Modules>;
  isCurrent(): boolean;
  acquired(application: Application): void;
}

/** Overlap module requests with acquisition; installing scenes remains the caller's job. */
export async function initializeRendererModules<Application, Modules>(
  ports: RendererModuleInitializationPorts<Application, Modules>,
): Promise<{ application: Application; modules: Modules } | null> {
  let pendingModules: Promise<ModuleOutcome<Modules>>;
  try {
    pendingModules = ports.loadModules().then(
      (modules) => ({ status: "fulfilled" as const, modules }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
  } catch (error: unknown) {
    pendingModules = Promise.resolve({ status: "rejected", error });
  }
  // Native failure/null must not wait for a pending module request.
  const application = await ports.acquire();
  if (!application) return null;
  ports.acquired(application);
  if (!ports.isCurrent()) return null;
  const result = await pendingModules;
  if (!ports.isCurrent()) return null;
  if (result.status === "rejected") throw result.error;
  return { application, modules: result.modules };
}
