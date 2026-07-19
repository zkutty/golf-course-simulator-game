export const BINDING_ACTIONS = [
  "panUp", "panDown", "panLeft", "panRight", "rotateLeft", "rotateRight",
  "speed1", "speed2", "speed3", "pause", "terrainTool", "obstacleTool", "buildingTool", "quicksave",
] as const;

export type BindingAction = typeof BINDING_ACTIONS[number];
export type Keybindings = Record<BindingAction, string>;

export const DEFAULT_KEYBINDINGS: Keybindings = {
  panUp: "KeyW", panDown: "KeyS", panLeft: "KeyA", panRight: "KeyD",
  rotateLeft: "KeyQ", rotateRight: "KeyE", speed1: "Digit1", speed2: "Digit2", speed3: "Digit3",
  pause: "Space", terrainTool: "KeyT", obstacleTool: "KeyO", buildingTool: "KeyB", quicksave: "Ctrl+KeyS",
};

export const BINDING_LABELS: Record<BindingAction, string> = {
  panUp: "Pan up", panDown: "Pan down", panLeft: "Pan left", panRight: "Pan right",
  rotateLeft: "Rotate left", rotateRight: "Rotate right", speed1: "Speed 1×", speed2: "Speed 2×", speed3: "Speed 3×",
  pause: "Pause / resume", terrainTool: "Terrain tool", obstacleTool: "Obstacle tool", buildingTool: "Building tool", quicksave: "Quick save",
};

export function normalizeKeybindings(value: unknown): Keybindings {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(BINDING_ACTIONS.map((action) => [action, typeof raw[action] === "string" && raw[action] ? raw[action] : DEFAULT_KEYBINDINGS[action]])) as Keybindings;
}

export function bindingFromEvent(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string {
  const modifiers = [event.ctrlKey || event.metaKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : ""].filter(Boolean);
  return [...modifiers, event.code].join("+");
}

export function eventMatchesBinding(event: KeyboardEvent, binding: string): boolean { return bindingFromEvent(event) === binding; }
export function findBindingConflict(bindings: Keybindings, action: BindingAction, binding: string): BindingAction | null {
  return BINDING_ACTIONS.find((candidate) => candidate !== action && bindings[candidate] === binding) ?? null;
}
export function displayBinding(binding: string): string { return binding.replace("Key", "").replace("Digit", "").replace("Arrow", "Arrow "); }
