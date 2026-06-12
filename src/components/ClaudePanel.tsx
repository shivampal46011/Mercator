import { useEffect, useState } from "react";
import { TerminalView } from "./TerminalView";
import { ChatView } from "./ChatView";

let claudeCounter = 0;

type PanelMode = "chat" | "terminal";

interface Props {
  cwd: string;
  visible: boolean;
  width: number;
  onWidthChange: (w: number) => void;
  onClose: () => void;
}

export function ClaudePanel({ cwd, visible, width, onWidthChange, onClose }: Props) {
  const [termId] = useState(() => `claude-term-${++claudeCounter}`);
  const [mode, setMode] = useState<PanelMode>("chat");
  const [terminalStarted, setTerminalStarted] = useState(false);
  const projectName = cwd.split("/").pop() ?? cwd;

  // An externally-dispatched chat message should surface the chat tab.
  useEffect(() => {
    const toChat = () => setMode("chat");
    window.addEventListener("newgen-chat-send", toChat);
    return () => window.removeEventListener("newgen-chat-send", toChat);
  }, []);

  const dragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: MouseEvent) =>
      onWidthChange(Math.min(Math.max(startW + (startX - ev.clientX), 300), window.innerWidth * 0.55));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const tab = (active: boolean) =>
    `px-2.5 py-0.5 rounded-md text-[10.5px] transition-colors ${
      active ? "bg-violet-500/20 text-violet-200" : "text-zinc-500 hover:text-zinc-300"
    }`;

  return (
    <div
      style={{ width }}
      className={`${visible ? "flex" : "hidden"} relative shrink-0 flex-col border-l border-zinc-800/60 bg-[#0c0c10]`}
    >
      <div
        onMouseDown={dragStart}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-violet-500/40 z-10 transition-colors"
      />
      <div className="h-8 shrink-0 flex items-center gap-2 px-3 border-b border-zinc-800/40 select-none">
        <span className="text-violet-400 text-[13px]">✦</span>
        <span className="text-[10px] font-semibold tracking-widest text-zinc-400">CLAUDE</span>
        <span className="text-[10px] text-zinc-600 truncate">in {projectName}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 mr-1">
          <button onClick={() => setMode("chat")} className={tab(mode === "chat")}>
            Chat
          </button>
          <button
            onClick={() => {
              setMode("terminal");
              setTerminalStarted(true);
            }}
            className={tab(mode === "terminal")}
            title="Raw Claude Code terminal session"
          >
            Terminal
          </button>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-600 hover:text-zinc-300 text-[15px] leading-none"
          title="Hide Claude panel (⌘L) — sessions keep running"
        >
          ×
        </button>
      </div>
      <div className={mode === "chat" ? "flex-1 min-h-0" : "hidden"}>
        <ChatView cwd={cwd} />
      </div>
      <div className={mode === "terminal" ? "flex-1 min-h-0 relative" : "hidden"}>
        {terminalStarted && (
          <TerminalView id={termId} cwd={cwd} command="claude" visible={visible && mode === "terminal"} />
        )}
      </div>
    </div>
  );
}
