export type PlatformKind = "browser" | "desktop" | "steam";

export interface PlatformCapabilities {
  kind: PlatformKind;
  nativeFiles: boolean;
  steam: boolean;
  workshop: boolean;
  cloud: boolean;
  overlay: boolean;
  screenshots: boolean;
}

export interface PlatformFileStore {
  readText(key: string): Promise<string | null>;
  writeTextAtomic(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  chooseImport(extensions: string[]): Promise<{ name: string; text: string } | null>;
  chooseExport(name: string, text: string): Promise<boolean>;
  exportSupportBundle(): Promise<boolean>;
}

export interface PlatformWorkshopItem {
  id: string;
  state: "subscribed" | "downloading" | "installed" | "incompatible" | "corrupt" | "cached";
  title: string;
  version?: string;
  localPath?: string;
}

export interface PlatformWorkshop {
  legalAgreementUrl: string | null;
  list(): Promise<PlatformWorkshopItem[]>;
  publish(input: {
    contentId: string;
    title: string;
    description: string;
    tags: string[];
    visibility: "public" | "friends" | "private";
    packageText: string;
    previewDataUrl?: string;
    existingPublishedId?: string;
  }): Promise<{
    publishedId: string;
    needsLegalAgreement: boolean;
    operationId?: string;
    progress?: number;
    ownershipVerified?: boolean;
    ownership?: "owner" | "not-owner" | "unknown";
    legalAgreementUrl?: string | null;
  }>;
  cancel(operationId: string): Promise<void>;
  copyLocal(itemId: string): Promise<string | null>;
}

export interface PlatformCloud {
  status(): Promise<"unavailable" | "offline" | "ready" | "full">;
  generations(): Promise<Array<{ id: string; createdAt: number; device: string; checksum: string }>>;
  preserveBoth(localGeneration: string, cloudGeneration: string): Promise<boolean>;
}

export interface PlatformServices {
  version: 1;
  capabilities: PlatformCapabilities;
  files: PlatformFileStore;
  app: {
    version(): Promise<string>;
    safeMode(): Promise<boolean>;
    markCleanExit(): Promise<void>;
    requestQuit(input: { dirty: boolean; resumableBoundary: boolean }): Promise<"quit" | "cancel">;
    setWindowMode(mode: "windowed" | "borderless" | "fullscreen"): Promise<void>;
  };
  achievements: {
    unlock(ids: string[]): Promise<string[]>;
  };
  cloud: PlatformCloud;
  workshop: PlatformWorkshop;
  presence: {
    set(value: "title" | "designing" | "operating" | "playing" | "tournament" | "campaign"): Promise<void>;
  };
  overlay: {
    open(url: string): Promise<boolean>;
  };
  screenshots: {
    save(dataUrl: string, suggestedName: string): Promise<string | null>;
  };
}

export interface CourseCraftDesktopBridge {
  version: 1;
  invoke<T>(channel: string, payload?: unknown): Promise<T>;
  capabilities: PlatformCapabilities;
}
