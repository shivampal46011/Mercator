import { useState } from "react";
import { TerminalView } from "./TerminalView";

interface TermTab {
  id: string;
  title: string;
  command?: string;
}

let counter = 0;
const nextId = () => `pty-${++counter}`;

interface Props {
  cwd: string;
  height: number;
  onHeightChange: (h: number) => void;
}

export function TerminalPanel({ cwd, height, onHeightChange }: Props) {
  const [tabs, setTabs] = useState<TermTab[]>(() => [{ id: nextId(), title: "zsh" }]);
  const [active, setActive] = useState<string>(() => tabs[0].id);

  const addTab = (command?: string, title?: string) => {
    const t = { id: nextId(), title: title ?? "zsh", command };
    setTabs((ts) => [...ts, t]);
    setActive(t.id);
  };

  const closeTab = (id: string) => {
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (active === id) setActive(next.length ? next[next.length - 1].id : "");
  };

  const dragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev: MouseEvent) =>
      onHeightChange(Math.min(Math.max(startH + (startY - ev.clientY), 120), window.innerHeight * 0.7));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div style={{ height }} className="shrink-0 flex flex-col border-t border-zinc-800/60 bg-[#0c0c10]">
      <div
        onMouseDown={dragStart}
        className="h-1 -mt-px cursor-row-resize hover:bg-violet-500/40 transition-colors"
      />
      <div className="h-8 shrink-0 flex items-center gap-1 px-2 border-b border-zinc-800/40 select-none">
        <span className="text-[10px] font-semibold tracking-widest text-zinc-500 mr-1">TERMINAL</span>
        {tabs.map((t) => (
          <div
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`group flex items-center gap-1.5 px-2.5 h-6 rounded-md text-[11px] cursor-pointer ${
              active === t.id ? "bg-zinc-800 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.command === "claude" && <span className="text-violet-400">✦</span>}
            {t.title}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
              className="opacity-0 group-hover:opacity-100 hover:text-zinc-100"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => addTab()}
          className="px-1.5 text-zinc-500 hover:text-zinc-200 text-[13px]"
          title="New terminal"
        >
          ＋
        </button>
        <div className="flex-1" />
        <button
          onClick={() => addTab("claude", "Claude")}
          className="flex items-center gap-1.5 px-2.5 h-6 rounded-md text-[11px] text-violet-300 border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 transition-colors"
          title="Open a Claude Code session in this project"
        >
          ✦ Claude Code
        </button>
      </div>
      <div className="flex-1 min-h-0 relative">
        {tabs.map((t) => (
          <TerminalView key={t.id} id={t.id} cwd={cwd} command={t.command} visible={active === t.id} />
        ))}
        {tabs.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-zinc-600">
            No terminals —
            <button className="ml-1 underline hover:text-zinc-300" onClick={() => addTab()}>
              open one
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
