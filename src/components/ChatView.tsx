import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type ChatPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; detail: string };

interface ChatMsg {
  role: "user" | "assistant";
  parts: ChatPart[];
}

let chatCounter = 0;

function toolDetail(input: Record<string, unknown>): string {
  for (const key of ["file_path", "command", "path", "pattern", "url", "description", "prompt"]) {
    const v = input?.[key];
    if (typeof v === "string" && v) return v.split("\n")[0].slice(0, 80);
  }
  return "";
}

export function ChatView({ cwd }: { cwd: string }) {
  const [id] = useState(() => `chat-${++chatCounter}`);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  runningRef.current = running;
  const sessionRef = useRef<string | null>(null);
  const stderrRef = useRef<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;
    void (async () => {
      const onEvent = await listen<string>(`chat-event-${id}`, (e) => {
        let ev: any;
        try {
          ev = JSON.parse(e.payload);
        } catch {
          return;
        }
        if (typeof ev.session_id === "string") sessionRef.current = ev.session_id;
        if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
          const parts: ChatPart[] = [];
          for (const block of ev.message.content) {
            if (block.type === "text" && block.text) parts.push({ kind: "text", text: block.text });
            if (block.type === "tool_use")
              parts.push({ kind: "tool", name: block.name, detail: toolDetail(block.input ?? {}) });
          }
          if (parts.length) {
            setMessages((ms) => {
              const last = ms[ms.length - 1];
              if (last?.role === "assistant") {
                return [...ms.slice(0, -1), { ...last, parts: [...last.parts, ...parts] }];
              }
              return [...ms, { role: "assistant", parts }];
            });
          }
        }
      });
      const onStderr = await listen<string>(`chat-stderr-${id}`, (e) => {
        stderrRef.current.push(e.payload);
      });
      const onDone = await listen<{ code: number | null }>(`chat-done-${id}`, (e) => {
        setRunning(false);
        window.dispatchEvent(new CustomEvent("newgen-flow-refresh"));
        if (e.payload.code !== 0) {
          const err = stderrRef.current.join("\n").trim();
          if (err) {
            setMessages((ms) => [
              ...ms,
              { role: "assistant", parts: [{ kind: "text", text: `⚠ ${err.slice(0, 600)}` }] },
            ]);
          }
        }
        stderrRef.current = [];
      });
      if (cancelled) {
        onEvent();
        onStderr();
        onDone();
        return;
      }
      unlisteners.push(onEvent, onStderr, onDone);
    })();
    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
      void invoke("chat_cancel", { id }).catch(() => {});
    };
  }, [id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, running]);

  const sendText = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || runningRef.current) return false;
      setMessages((ms) => [...ms, { role: "user", parts: [{ kind: "text", text }] }]);
      setRunning(true);
      runningRef.current = true;
      void invoke("chat_send", { id, project: cwd, message: text, session: sessionRef.current }).catch(
        (err) => {
          setRunning(false);
          setMessages((ms) => [...ms, { role: "assistant", parts: [{ kind: "text", text: `⚠ ${err}` }] }]);
        },
      );
      return true;
    },
    [id, cwd],
  );

  const send = () => {
    if (sendText(input)) setInput("");
  };

  // Impact-aware edits (and anything else in the editor) can hand the chat a message.
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text !== "string" || !text.trim()) return;
      if (runningRef.current) {
        setInput(text); // a turn is in flight — stage it in the composer instead
        return;
      }
      sendText(text);
    };
    window.addEventListener("newgen-chat-send", handler);
    return () => window.removeEventListener("newgen-chat-send", handler);
  }, [sendText]);

  const stop = () => void invoke("chat_cancel", { id }).catch(() => {});

  const newChat = () => {
    if (running) stop();
    sessionRef.current = null;
    setMessages([]);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="h-7 shrink-0 flex items-center justify-between px-2.5 border-b border-zinc-800/30 select-none">
        <span className="text-[9.5px] text-zinc-700">
          {sessionRef.current ? "session active" : "new session"}
        </span>
        <button onClick={newChat} className="text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors">
          + New chat
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !running && (
          <div className="mt-10 text-center space-y-2 select-none">
            <div className="text-violet-400 text-xl">✦</div>
            <p className="text-[12px] text-zinc-500 leading-relaxed px-4">
              Ask Claude to build, explain, or fix something in this project. It reads and edits your files
              — Flow View refreshes automatically when it finishes.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-violet-500/15 border border-violet-500/25 px-3 py-2 text-[12.5px] text-zinc-200 whitespace-pre-wrap leading-relaxed">
                {m.parts.map((p) => (p.kind === "text" ? p.text : "")).join("")}
              </div>
            ) : (
              <div className="space-y-1.5">
                {m.parts.map((p, j) =>
                  p.kind === "text" ? (
                    <p
                      key={j}
                      className="text-[12.5px] text-zinc-300 whitespace-pre-wrap leading-relaxed"
                    >
                      {p.text}
                    </p>
                  ) : (
                    <div
                      key={j}
                      className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10.5px] font-mono text-zinc-500 w-fit max-w-full"
                    >
                      <span className="text-cyan-400/80 shrink-0">⚙</span>
                      <span className="shrink-0">{p.name}</span>
                      {p.detail && <span className="text-zinc-600 truncate">· {p.detail}</span>}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
        {running && (
          <div className="text-[12px] text-violet-400 animate-pulse select-none">✦ working…</div>
        )}
      </div>
      <div className="shrink-0 border-t border-zinc-800/40 p-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 focus-within:border-violet-500/50 transition-colors">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Ask Claude… (Enter to send, Shift+Enter for newline)"
            className="w-full resize-none bg-transparent px-3 pt-2 text-[12.5px] text-zinc-200 placeholder-zinc-600 outline-none"
          />
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="text-[9.5px] text-zinc-700">auto-accepts file edits in this project</span>
            {running ? (
              <button
                onClick={stop}
                className="text-[11px] px-2.5 py-1 rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className="text-[11px] px-2.5 py-1 rounded-md bg-violet-600 text-white disabled:opacity-30 hover:bg-violet-500 transition-colors"
              >
                Send ↵
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
