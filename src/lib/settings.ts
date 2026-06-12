export type ShortcutAction = "save" | "terminal" | "view" | "claude";

export interface AppSettings {
  flowRefresh: "auto" | "manual" | "interval";
  flowRefreshIntervalSec: number;
  lockManualEdits: boolean;
  shortcuts: Record<ShortcutAction, string>;
}

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  save: "Save active file",
  terminal: "Toggle terminal",
  view: "Switch Flow ↔ Code",
  claude: "Toggle Claude panel",
};

export const DEFAULT_SETTINGS: AppSettings = {
  flowRefresh: "auto",
  flowRefreshIntervalSec: 30,
  lockManualEdits: true,
  shortcuts: { save: "mod+s", terminal: "mod+j", view: "mod+g", claude: "mod+l" },
};

const KEY = "newgen-settings";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...(parsed.shortcuts ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent("newgen-settings-changed"));
}

/** Normalize a keyboard event into "mod+shift+k" form; null for bare modifier presses. */
export function eventToShortcut(e: KeyboardEvent): string | null {
  const k = e.key.toLowerCase();
  if (["meta", "control", "shift", "alt"].includes(k)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(k);
  return parts.join("+");
}

export function matchShortcut(e: KeyboardEvent, sc: string): boolean {
  return eventToShortcut(e) === sc;
}

export function formatShortcut(sc: string): string {
  return sc
    .split("+")
    .map((p) =>
      p === "mod" ? "⌘" : p === "shift" ? "⇧" : p === "alt" ? "⌥" : p.length === 1 ? p.toUpperCase() : p,
    )
    .join("");
}
