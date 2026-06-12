import type { ViewMode } from "../App";
import { formatShortcut, type ShortcutAction } from "../lib/settings";

interface Props {
  projectName: string | null;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  claudeOpen: boolean;
  onToggleClaude: () => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onOpenProject: () => void;
  onOpenSettings: () => void;
  shortcuts: Record<ShortcutAction, string>;
}

export function TopBar({
  projectName,
  view,
  onViewChange,
  claudeOpen,
  onToggleClaude,
  terminalOpen,
  onToggleTerminal,
  onOpenProject,
  onOpenSettings,
  shortcuts,
}: Props) {
  const seg = (active: boolean) =>
    `px-3 py-1 rounded-md text-[11.5px] transition-colors ${
      active ? "bg-violet-500/20 text-violet-200 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.35)]" : "text-zinc-500 hover:text-zinc-300"
    }`;

  return (
    <div
      data-tauri-drag-region
      className="h-10 shrink-0 flex items-center gap-2 pl-[84px] pr-3 border-b border-zinc-800/60 bg-[#101015] select-none"
    >
      <div className="size-2.5 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 shadow-[0_0_8px_rgba(124,92,255,0.6)]" />
      <span className="text-[13px] font-semibold tracking-tight text-zinc-100">NewGen</span>
      {projectName && (
        <span className="ml-1 text-[11px] text-zinc-400 px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800">
          {projectName}
        </span>
      )}
      <div className="flex-1 h-full" data-tauri-drag-region />
      <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
        <button
          onClick={() => onViewChange("flow")}
          className={seg(view === "flow")}
          title={`Flow View (${formatShortcut(shortcuts.view)})`}
        >
          ⚡ Flow
        </button>
        <button
          onClick={() => onViewChange("code")}
          className={seg(view === "code")}
          title={`Code view (${formatShortcut(shortcuts.view)})`}
        >
          ⌨ Code
        </button>
      </div>
      <div className="flex-1 h-full" data-tauri-drag-region />
      <button
        onClick={onToggleClaude}
        title={`Toggle Claude panel (${formatShortcut(shortcuts.claude)})`}
        className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
          claudeOpen
            ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
            : "border-zinc-800 text-zinc-500 hover:text-violet-300 hover:border-violet-500/40"
        }`}
      >
        ✦ Claude
      </button>
      <button
        onClick={onToggleTerminal}
        title={`Toggle terminal (${formatShortcut(shortcuts.terminal)})`}
        className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
          terminalOpen
            ? "border-zinc-700 bg-zinc-800 text-zinc-300"
            : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
        }`}
      >
        Terminal
      </button>
      <button
        onClick={onOpenProject}
        className="text-[11px] px-2.5 py-1 rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 transition-colors"
      >
        Open…
      </button>
      <button
        onClick={onOpenSettings}
        title="Settings"
        className="text-[13px] px-1.5 py-0.5 rounded-md text-zinc-500 hover:text-zinc-200 transition-colors"
      >
        ⚙
      </button>
    </div>
  );
}
