import Editor from "@monaco-editor/react";
import type { OpenFile } from "../types";

const LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  json: "json",
  css: "css",
  html: "html",
  md: "markdown",
  rs: "rust",
  py: "python",
  toml: "ini",
  yml: "yaml",
  yaml: "yaml",
  sh: "shell",
  svg: "xml",
  xml: "xml",
};

const langOf = (path: string) => LANG[(path.split(".").pop() ?? "").toLowerCase()] ?? "plaintext";

interface Props {
  files: OpenFile[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onEdit: (path: string, content: string) => void;
  onSaveActive: () => void;
  locked: boolean;
}

export function EditorArea({ files, activePath, onSelect, onClose, onEdit, onSaveActive, locked }: Props) {
  const active = files.find((f) => f.path === activePath) ?? null;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0c0c10]">
      {files.length > 0 && (
        <div className="h-9 shrink-0 flex items-end gap-px overflow-x-auto bg-[#0e0e13] border-b border-zinc-800/60 px-1 select-none">
          {files.map((f) => {
            const isActive = f.path === activePath;
            return (
              <div
                key={f.path}
                onClick={() => onSelect(f.path)}
                className={`group flex items-center gap-1.5 px-3 h-8 rounded-t-md text-[12px] cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "bg-[#0c0c10] text-zinc-200 border border-b-0 border-zinc-800/60"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <span>{f.name}</span>
                {f.dirty && <span className="size-1.5 rounded-full bg-violet-400" />}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(f.path);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-200 ml-0.5"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
      {locked && active && (
        <div className="h-7 shrink-0 flex items-center gap-2 px-3 text-[10.5px] text-amber-300/90 bg-amber-500/5 border-b border-amber-500/20 select-none">
          🔒 Aligned-agent mode — manual edits are locked so every change follows the @contract
          standard. Use ✎ ai edit on a block or ask the chat. (Unlock in ⚙ Settings)
        </div>
      )}
      <div className="flex-1 min-h-0 relative">
        {active ? (
          <Editor
            path={active.path}
            defaultValue={active.content}
            language={langOf(active.path)}
            theme="newgen-dark"
            onChange={(v) => onEdit(active.path, v ?? "")}
            onMount={(editor, monacoInstance) => {
              editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () =>
                onSaveActive(),
              );
            }}
            options={{
              fontSize: 13,
              fontFamily: '"SF Mono", Menlo, "JetBrains Mono", monospace',
              minimap: { enabled: false },
              smoothScrolling: true,
              cursorBlinking: "smooth",
              padding: { top: 12 },
              scrollBeyondLastLine: false,
              renderLineHighlight: "all",
              automaticLayout: true,
              readOnly: locked,
              readOnlyMessage: {
                value: "Locked — changes go through the agent (✎ ai edit / chat). Unlock in ⚙ Settings.",
              },
            }}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-600 select-none">
            <div className="size-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-400/20 border border-zinc-800" />
            <p className="text-sm">Open a file from the explorer</p>
            <p className="text-[11px] text-zinc-700">⌘S save · ⌘J terminal · ⌘G flow view · ⌘L Claude</p>
          </div>
        )}
      </div>
    </div>
  );
}
