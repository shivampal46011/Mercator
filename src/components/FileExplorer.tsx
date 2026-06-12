import { useEffect, useRef, useState } from "react";
import type { DirEntry } from "../types";
import { createDir, createFile, deletePath, listDir, renamePath } from "../lib/ipc";

const DOT_COLORS: Record<string, string> = {
  ts: "bg-blue-400",
  tsx: "bg-blue-400",
  js: "bg-yellow-400",
  jsx: "bg-yellow-400",
  mjs: "bg-yellow-400",
  json: "bg-amber-500",
  css: "bg-sky-400",
  html: "bg-orange-400",
  md: "bg-zinc-400",
  rs: "bg-orange-600",
  py: "bg-green-400",
  toml: "bg-zinc-500",
  yml: "bg-rose-300",
  yaml: "bg-rose-300",
  svg: "bg-pink-400",
  png: "bg-pink-400",
  sh: "bg-emerald-400",
};

function fileDot(name: string) {
  const ext = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
  return DOT_COLORS[ext] ?? "bg-zinc-600";
}

/* ---------- tree node ---------- */

interface NodeProps {
  entry: DirEntry;
  depth: number;
  version: number;
  onOpenFile: (path: string) => void;
  activePath: string | null;
  onMenu: (e: React.MouseEvent, entry: DirEntry) => void;
}

function Node({ entry, depth, version, onOpenFile, activePath, onMenu }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const fetched = useRef(-1);

  useEffect(() => {
    if (entry.isDir && expanded && fetched.current !== version) {
      fetched.current = version;
      listDir(entry.path)
        .then(setChildren)
        .catch(() => setChildren([]));
    }
  }, [expanded, version, entry.isDir, entry.path]);

  const active = activePath === entry.path;
  const dotfile = entry.name.startsWith(".");

  return (
    <div>
      <button
        onClick={() => (entry.isDir ? setExpanded((x) => !x) : onOpenFile(entry.path))}
        onContextMenu={(e) => onMenu(e, entry)}
        className={`w-full flex items-center gap-1.5 py-[3px] pr-2 text-left text-[12.5px] leading-tight transition-colors ${
          active ? "bg-violet-500/15 text-violet-200" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
        } ${dotfile ? "opacity-50" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        {entry.isDir ? (
          <span
            className={`text-[8px] text-zinc-500 inline-block w-2.5 shrink-0 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          >
            ▶
          </span>
        ) : (
          <span className={`inline-block size-2 rounded-full shrink-0 ${fileDot(entry.name)}`} />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.isDir &&
        expanded &&
        children?.map((c) => (
          <Node
            key={c.path}
            entry={c}
            depth={depth + 1}
            version={version}
            onOpenFile={onOpenFile}
            activePath={activePath}
            onMenu={onMenu}
          />
        ))}
    </div>
  );
}

/* ---------- modals & menu ---------- */

interface MenuItem {
  label: string;
  danger?: boolean;
  action: () => void;
}

function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className="absolute min-w-[180px] rounded-lg border border-zinc-800 bg-[#15151b] shadow-2xl py-1"
        style={{
          left: Math.min(x, window.innerWidth - 200),
          top: Math.min(y, window.innerHeight - items.length * 32 - 12),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it, i) =>
          it.label === "—" ? (
            <div key={i} className="my-1 border-t border-zinc-800/60" />
          ) : (
            <button
              key={i}
              onClick={() => {
                onClose();
                it.action();
              }}
              className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
                it.danger ? "text-red-400 hover:bg-red-500/10" : "text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {it.label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function PromptModal({
  title,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const submit = () => {
    if (!value.trim()) return;
    onClose();
    onSubmit(value.trim());
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[320px] rounded-xl border border-zinc-800 bg-[#101015] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[12px] text-zinc-300 mb-2">{title}</div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[12.5px] text-zinc-200 outline-none focus:border-violet-500/50 transition-colors"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[11px] px-2.5 py-1 rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="text-[11px] px-2.5 py-1 rounded-md bg-violet-600 text-white disabled:opacity-30 hover:bg-violet-500"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({
  message,
  onConfirm,
  onClose,
}: {
  message: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[320px] rounded-xl border border-zinc-800 bg-[#101015] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[12.5px] text-zinc-200">{message}</div>
        <div className="mt-3.5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[11px] px-2.5 py-1 rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onClose();
              onConfirm();
            }}
            className="text-[11px] px-2.5 py-1 rounded-md bg-red-600 text-white hover:bg-red-500"
          >
            Move to Bin
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- explorer ---------- */

interface Props {
  projectPath: string;
  onOpenFile: (path: string) => void;
  activePath: string | null;
}

interface MenuState {
  x: number;
  y: number;
  entry: DirEntry | null;
}

export function FileExplorer({ projectPath, onOpenFile, activePath }: Props) {
  const [root, setRoot] = useState<DirEntry[]>([]);
  const [version, setVersion] = useState(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; initial: string; onSubmit: (v: string) => void } | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void listDir(projectPath)
      .then(setRoot)
      .catch(() => setRoot([]));
  }, [projectPath, version]);

  const bump = () => {
    setVersion((v) => v + 1);
    window.dispatchEvent(new CustomEvent("newgen-flow-refresh"));
  };

  const fail = (e: unknown) => setErr(String(e));

  const dirFor = (entry: DirEntry | null) =>
    entry === null ? projectPath : entry.isDir ? entry.path : entry.path.slice(0, entry.path.lastIndexOf("/"));

  const doNewFile = (entry: DirEntry | null) =>
    setPrompt({
      title: "New file name",
      initial: "",
      onSubmit: (name) => void createFile(`${dirFor(entry)}/${name}`).then(bump).catch(fail),
    });

  const doNewFolder = (entry: DirEntry | null) =>
    setPrompt({
      title: "New folder name",
      initial: "",
      onSubmit: (name) => void createDir(`${dirFor(entry)}/${name}`).then(bump).catch(fail),
    });

  const doRename = (entry: DirEntry) =>
    setPrompt({
      title: `Rename ${entry.name}`,
      initial: entry.name,
      onSubmit: (name) => {
        const parent = entry.path.slice(0, entry.path.lastIndexOf("/"));
        void renamePath(entry.path, `${parent}/${name}`)
          .then(() => {
            window.dispatchEvent(new CustomEvent("newgen-file-removed", { detail: { path: entry.path } }));
            bump();
          })
          .catch(fail);
      },
    });

  const doDelete = (entry: DirEntry) =>
    setConfirm({
      message: `Move "${entry.name}" to the Bin?`,
      onConfirm: () =>
        void deletePath(entry.path)
          .then(() => {
            window.dispatchEvent(new CustomEvent("newgen-file-removed", { detail: { path: entry.path } }));
            bump();
          })
          .catch(fail),
    });

  const openMenu = (e: React.MouseEvent, entry: DirEntry | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    const entry = menu.entry;
    if (entry === null) {
      return [
        { label: "New File…", action: () => doNewFile(null) },
        { label: "New Folder…", action: () => doNewFolder(null) },
      ];
    }
    if (entry.isDir) {
      return [
        { label: "New File inside…", action: () => doNewFile(entry) },
        { label: "New Folder inside…", action: () => doNewFolder(entry) },
        { label: "—", action: () => {} },
        { label: "Rename…", action: () => doRename(entry) },
        { label: "Move to Bin", danger: true, action: () => doDelete(entry) },
      ];
    }
    return [
      { label: "Open", action: () => onOpenFile(entry.path) },
      { label: "—", action: () => {} },
      { label: "Rename…", action: () => doRename(entry) },
      { label: "Move to Bin", danger: true, action: () => doDelete(entry) },
      { label: "—", action: () => {} },
      { label: "New File here…", action: () => doNewFile(entry) },
    ];
  };

  return (
    <div
      className="w-60 shrink-0 flex flex-col border-r border-zinc-800/60 bg-[#0e0e13] min-h-0 select-none"
      onContextMenu={(e) => openMenu(e, null)}
    >
      <div className="h-8 shrink-0 flex items-center justify-between px-3 text-[10px] font-semibold tracking-widest text-zinc-500">
        EXPLORER
        <span className="flex items-center gap-2">
          <button
            onClick={() => doNewFile(null)}
            className="text-zinc-600 hover:text-zinc-300 transition-colors text-[13px]"
            title="New file at project root"
          >
            ＋
          </button>
          <button
            onClick={bump}
            className="text-zinc-600 hover:text-zinc-300 transition-colors text-[13px]"
            title="Refresh"
          >
            ⟳
          </button>
        </span>
      </div>
      {err && (
        <button
          onClick={() => setErr(null)}
          className="mx-2 mb-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-left text-[10px] text-red-300"
          title="Dismiss"
        >
          {err}
        </button>
      )}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4">
        {root.map((e) => (
          <Node
            key={e.path}
            entry={e}
            depth={0}
            version={version}
            onOpenFile={onOpenFile}
            activePath={activePath}
            onMenu={openMenu}
          />
        ))}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
      {prompt && (
        <PromptModal
          title={prompt.title}
          initial={prompt.initial}
          onSubmit={prompt.onSubmit}
          onClose={() => setPrompt(null)}
        />
      )}
      {confirm && (
        <ConfirmModal message={confirm.message} onConfirm={confirm.onConfirm} onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}
