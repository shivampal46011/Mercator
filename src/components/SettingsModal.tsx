import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  SHORTCUT_LABELS,
  eventToShortcut,
  formatShortcut,
  loadSettings,
  saveSettings,
  type AppSettings,
  type ShortcutAction,
} from "../lib/settings";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AppSettings>(loadSettings());
  const [recording, setRecording] = useState<ShortcutAction | null>(null);

  const update = (patch: Partial<AppSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
  };

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return; // shortcuts must include ⌘/Ctrl so typing never triggers them
      const sc = eventToShortcut(e);
      if (sc) {
        update({ shortcuts: { ...s.shortcuts, [recording]: sc } });
        setRecording(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, s]);

  const radio = (value: AppSettings["flowRefresh"], label: string, hint: string) => (
    <label className="flex items-start gap-2.5 cursor-pointer group">
      <input
        type="radio"
        checked={s.flowRefresh === value}
        onChange={() => update({ flowRefresh: value })}
        className="mt-0.5 accent-violet-500"
      />
      <span>
        <span className="block text-[12.5px] text-zinc-200 group-hover:text-white">{label}</span>
        <span className="block text-[10.5px] text-zinc-600">{hint}</span>
      </span>
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm select-none"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-h-[80vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-[#101015] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">⚙ Settings</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-xl leading-none">
            ×
          </button>
        </div>

        <div className="mt-5">
          <div className="text-[10px] font-semibold tracking-widest text-zinc-500 mb-2.5">
            FLOW VIEW REFRESH
          </div>
          <div className="space-y-2.5">
            {radio("auto", "Automatic", "Rescan when the agent finishes a turn or files change")}
            {radio("manual", "Manual only", "Rescan only when you press ⟳")}
            {radio("interval", "On an interval", "Rescan every N seconds (plus the ⟳ button)")}
            {s.flowRefresh === "interval" && (
              <div className="ml-6 flex items-center gap-2 text-[12px] text-zinc-400">
                every
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={s.flowRefreshIntervalSec}
                  onChange={(e) =>
                    update({
                      flowRefreshIntervalSec: Math.max(5, Math.min(600, Number(e.target.value) || 30)),
                    })
                  }
                  className="w-16 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-center text-zinc-200 outline-none focus:border-violet-500/50"
                />
                seconds
              </div>
            )}
          </div>
        </div>

        <div className="mt-6">
          <div className="text-[10px] font-semibold tracking-widest text-zinc-500 mb-2.5">
            EDITING POLICY
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={s.lockManualEdits}
              onChange={(e) => update({ lockManualEdits: e.target.checked })}
              className="mt-0.5 accent-violet-500"
            />
            <span>
              <span className="block text-[12.5px] text-zinc-200 group-hover:text-white">
                Lock manual code edits
              </span>
              <span className="block text-[10.5px] text-zinc-600 leading-relaxed">
                Code is view-only; every change goes through the aligned agent (✎ ai edit or chat),
                which is forced to follow the @contract standard. One channel in = predictable codebase.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-6">
          <div className="text-[10px] font-semibold tracking-widest text-zinc-500 mb-2.5">
            COMMAND SHORTCUTS
          </div>
          <div className="space-y-1.5">
            {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((action) => (
              <div key={action} className="flex items-center gap-3">
                <span className="flex-1 text-[12.5px] text-zinc-300">{SHORTCUT_LABELS[action]}</span>
                <button
                  onClick={() => setRecording(recording === action ? null : action)}
                  className={`min-w-[88px] px-2.5 py-1 rounded-md border text-[12px] font-mono transition-colors ${
                    recording === action
                      ? "border-violet-500/60 bg-violet-500/15 text-violet-300 animate-pulse"
                      : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700"
                  }`}
                >
                  {recording === action ? "press keys…" : formatShortcut(s.shortcuts[action])}
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-zinc-700">
            Click a shortcut, then press the new combination (must include ⌘ or Ctrl). Esc cancels.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => {
              setS(DEFAULT_SETTINGS);
              saveSettings(DEFAULT_SETTINGS);
            }}
            className="text-[11px] px-2.5 py-1 rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Reset to defaults
          </button>
          <span className="text-[10px] text-zinc-700">changes apply immediately</span>
        </div>
      </div>
    </div>
  );
}
