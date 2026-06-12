import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { OpenFile, Persona } from "./types";
import { ensureStandard, loadProfile, readFile, writeFile } from "./lib/ipc";
import { TopBar } from "./components/TopBar";
import { Welcome } from "./components/Welcome";
import { FileExplorer } from "./components/FileExplorer";
import { EditorArea } from "./components/EditorArea";
import { FlowView } from "./components/FlowView";
import { ClaudePanel } from "./components/ClaudePanel";
import { TerminalPanel } from "./components/TerminalPanel";
import { StatusBar } from "./components/StatusBar";
import { SettingsModal } from "./components/SettingsModal";
import { loadSettings, matchShortcut, type AppSettings } from "./lib/settings";

export type ViewMode = "flow" | "code";

export default function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [persona, setPersona] = useState<Persona>("engineer");
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("flow");
  const [claudeOpen, setClaudeOpen] = useState(true);
  const [claudeWidth, setClaudeWidth] = useState(380);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(260);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;

  const projectName = projectPath?.split("/").pop() ?? null;

  const openProject = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false, title: "Open a project folder" });
    if (typeof picked !== "string") return;
    setProjectPath(picked);
    setOpenFiles([]);
    setActivePath(null);
    setView("flow");
    setClaudeOpen(true);
    // v1 targets engineers — the Builder lens (and its first-run question) is deferred.
    const profile = await loadProfile(picked).catch(() => null);
    setPersona(profile?.persona ?? "engineer");
    // Align the project: CLAUDE.md gets the contract standard if it has none.
    void ensureStandard(picked).catch(() => {});
  }, []);

  const openFile = useCallback(async (path: string) => {
    setView("code");
    if (openFilesRef.current.some((f) => f.path === path)) {
      setActivePath(path);
      return;
    }
    const content = await readFile(path).catch(() => null);
    if (content === null) return;
    const name = path.split("/").pop() ?? path;
    setOpenFiles((fs) => [...fs, { path, name, content, dirty: false }]);
    setActivePath(path);
  }, []);

  const editFile = useCallback((path: string, content: string) => {
    setOpenFiles((fs) => fs.map((f) => (f.path === path ? { ...f, content, dirty: true } : f)));
  }, []);

  const saveActive = useCallback(async () => {
    const path = activePathRef.current;
    if (!path) return;
    const file = openFilesRef.current.find((f) => f.path === path);
    if (!file || !file.dirty) return;
    await writeFile(path, file.content);
    setOpenFiles((fs) => fs.map((f) => (f.path === path ? { ...f, dirty: false } : f)));
  }, []);

  const closeFile = useCallback((path: string) => {
    const files = openFilesRef.current;
    const file = files.find((f) => f.path === path);
    if (file?.dirty && !window.confirm(`Discard unsaved changes in ${file.name}?`)) return;
    const next = files.filter((f) => f.path !== path);
    setOpenFiles(next);
    if (activePathRef.current === path) {
      setActivePath(next.length ? next[next.length - 1].path : null);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sc = settings.shortcuts;
      if (matchShortcut(e, sc.save)) {
        e.preventDefault();
        void saveActive();
      } else if (matchShortcut(e, sc.terminal)) {
        e.preventDefault();
        setTerminalOpen((t) => !t);
      } else if (matchShortcut(e, sc.view)) {
        e.preventDefault();
        setView((v) => (v === "flow" ? "code" : "flow"));
      } else if (matchShortcut(e, sc.claude)) {
        e.preventDefault();
        setClaudeOpen((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActive, settings]);

  useEffect(() => {
    const onChanged = () => setSettings(loadSettings());
    window.addEventListener("newgen-settings-changed", onChanged);
    return () => window.removeEventListener("newgen-settings-changed", onChanged);
  }, []);

  // A deleted or renamed file (or anything inside a deleted folder) closes its tabs.
  useEffect(() => {
    const onRemoved = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      const gone = (p: string) => p === path || p.startsWith(`${path}/`);
      const remaining = openFilesRef.current.filter((f) => !gone(f.path));
      if (remaining.length === openFilesRef.current.length) return;
      setOpenFiles(remaining);
      if (activePathRef.current && gone(activePathRef.current)) {
        setActivePath(remaining.length ? remaining[remaining.length - 1].path : null);
      }
    };
    window.addEventListener("newgen-file-removed", onRemoved);
    return () => window.removeEventListener("newgen-file-removed", onRemoved);
  }, []);

  useEffect(() => {
    const open = () => setClaudeOpen(true);
    window.addEventListener("newgen-claude-open", open);
    return () => window.removeEventListener("newgen-claude-open", open);
  }, []);

  if (!projectPath) {
    return <Welcome onOpenProject={openProject} />;
  }

  return (
    <div className="h-screen flex flex-col bg-[#0c0c10] text-zinc-300 overflow-hidden">
      <TopBar
        projectName={projectName}
        view={view}
        onViewChange={setView}
        claudeOpen={claudeOpen}
        onToggleClaude={() => setClaudeOpen((c) => !c)}
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen((t) => !t)}
        onOpenProject={openProject}
        onOpenSettings={() => setSettingsOpen(true)}
        shortcuts={settings.shortcuts}
      />
      <div className="flex flex-1 min-h-0">
        <FileExplorer projectPath={projectPath} onOpenFile={openFile} activePath={activePath} />
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0 relative">
            <div className={view === "flow" ? "absolute inset-0" : "hidden"}>
              <FlowView projectPath={projectPath} onOpenFile={openFile} />
            </div>
            <div className={view === "code" ? "absolute inset-0 flex flex-col" : "hidden"}>
              <EditorArea
                files={openFiles}
                activePath={activePath}
                onSelect={setActivePath}
                onClose={closeFile}
                onEdit={editFile}
                onSaveActive={saveActive}
                locked={settings.lockManualEdits}
              />
            </div>
          </div>
          {terminalOpen && (
            <TerminalPanel cwd={projectPath} height={terminalHeight} onHeightChange={setTerminalHeight} />
          )}
        </div>
        <ClaudePanel
          key={projectPath}
          cwd={projectPath}
          visible={claudeOpen}
          width={claudeWidth}
          onWidthChange={setClaudeWidth}
          onClose={() => setClaudeOpen(false)}
        />
      </div>
      <StatusBar persona={persona} activePath={activePath} projectPath={projectPath} />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
