import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xyflow/react/dist/style.css";
import type { Feature, FlowGraph } from "../types";
import { flowAnnotate, flowFeatures, readFile, scanProject } from "../lib/ipc";
import { loadSettings } from "../lib/settings";

const ROLE_STYLE: Record<string, { icon: string; label: string; accent: string; border: string }> = {
  entry: { icon: "⚡", label: "Ignition", accent: "text-violet-300", border: "border-violet-500/50" },
  port: { icon: "🌐", label: "Inlet", accent: "text-cyan-300", border: "border-cyan-500/50" },
  ui: { icon: "🎨", label: "UI", accent: "text-blue-300", border: "border-blue-500/30" },
  state: { icon: "🧠", label: "Memory", accent: "text-amber-300", border: "border-amber-500/40" },
  data: { icon: "🗄", label: "Storage", accent: "text-green-300", border: "border-green-500/40" },
  network: { icon: "📡", label: "Outlet", accent: "text-fuchsia-300", border: "border-fuchsia-500/40" },
  types: { icon: "📐", label: "Contracts", accent: "text-zinc-400", border: "border-zinc-700" },
  util: { icon: "🔧", label: "Toolbox", accent: "text-zinc-300", border: "border-zinc-700" },
  config: { icon: "⚙", label: "Settings", accent: "text-zinc-400", border: "border-zinc-700" },
  test: { icon: "✓", label: "Safety net", accent: "text-emerald-300", border: "border-emerald-500/40" },
};

const MAX_ROWS = 8;
const FILE_W = 240;
const FUNC_W = 208;
const FUNC_H = 66;

/** Degradation thresholds: past these, the canvas trades decoration for framerate. */
const PERF = {
  bigView: 220, // rendered blocks in one view: beyond this, no animated edges
  minimapMax: 350,
};

const fileCardHeight = (shown: number, hidden: number) =>
  104 + (shown > 0 ? 8 + shown * 19 + (hidden > 0 ? 13 : 0) : 0) + 18;

const humanize = (n: string) =>
  n
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();

const moduleOf = (id: string) => {
  const parts = id.split("/");
  if (parts.length === 1) return "(root)";
  return parts.slice(0, Math.min(2, parts.length - 1)).join("/");
};

/* ---------- node components ---------- */

type FileNodeData = {
  name: string;
  dir: string;
  shownFns: string[];
  hiddenCount: number;
  loc: number;
  role: string;
  purpose: string;
  ai: boolean;
  inlet: boolean;
  outlet: boolean;
  uses: number;
  usedBy: number;
  onOpen: () => void;
  onEdit: () => void;
  onDrill: () => void;
};
type FileFlowNode = Node<FileNodeData, "file">;

function FileNode({ data }: NodeProps<FileFlowNode>) {
  const style = ROLE_STYLE[data.role] ?? ROLE_STYLE.util;
  return (
    <div
      onClick={data.onDrill}
      title="click to open this file's functions"
      className={`w-[240px] rounded-xl border ${style.border} bg-[#101015]/95 shadow-[0_4px_24px_rgba(0,0,0,0.35)] hover:shadow-[0_0_24px_rgba(124,92,255,0.18)] transition-all cursor-pointer group`}
    >
      <Handle type="target" position={Position.Left} id="in" className="!size-2 !bg-violet-500/70 !border-0" />
      <Handle type="source" position={Position.Right} id="out" className="!size-2 !bg-cyan-400/70 !border-0" />
      <div className="flex items-center gap-1.5 px-3 pt-2.5">
        <span className="text-[13px] leading-none">{style.icon}</span>
        <span className={`text-[10px] font-semibold tracking-wider uppercase ${style.accent}`}>
          {style.label}
        </span>
        <div className="flex-1" />
        {data.inlet && (
          <span className="text-[8.5px] px-1.5 py-px rounded-full border border-cyan-500/40 text-cyan-300/90">
            ⇥ in
          </span>
        )}
        {data.outlet && (
          <span className="text-[8.5px] px-1.5 py-px rounded-full border border-fuchsia-500/40 text-fuchsia-300/90">
            out ↦
          </span>
        )}
      </div>
      <p className="px-3 pt-1.5 text-[12px] leading-snug text-zinc-200 line-clamp-2">
        {data.ai && <span className="text-violet-400 mr-1">✦</span>}
        {data.purpose}
      </p>
      <div className="px-3 pt-1 pb-1 text-[9px] text-zinc-600 truncate">
        {data.dir ? `${data.dir}/` : ""}
        {data.name} · {data.loc} loc
      </div>
      {data.shownFns.length > 0 && (
        <div className="border-t border-zinc-800/50 bg-zinc-900/40 py-1">
          {data.shownFns.map((f) => (
            <div key={f} className="relative flex items-center px-3 py-[2.5px] text-[10.5px] font-mono text-zinc-400">
              <Handle
                type="target"
                position={Position.Left}
                id={`in-${f}`}
                className="!absolute !left-0 !size-1.5 !bg-violet-400/80 !border-0"
              />
              <span className="text-violet-400/70 mr-1.5">ƒ</span>
              <span className="truncate">{f}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={`out-${f}`}
                className="!absolute !right-0 !size-1.5 !bg-cyan-400/80 !border-0"
              />
            </div>
          ))}
          {data.hiddenCount > 0 && <div className="px-3 text-[9px] text-zinc-600">+{data.hiddenCount} more</div>}
        </div>
      )}
      <div className="px-3 pb-2 pt-1 flex items-center gap-2.5 text-[9.5px] text-zinc-600">
        <span title="blocks this one depends on">→ {data.uses}</span>
        <span title="blocks that depend on this one">← {data.usedBy}</span>
        <div className="flex-1" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onEdit();
          }}
          className="opacity-0 group-hover:opacity-100 text-amber-300/90 hover:text-amber-200 transition-opacity"
          title="Describe a change — the agent receives it with a computed impact analysis"
        >
          ✎ ai edit
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onOpen();
          }}
          className="opacity-0 group-hover:opacity-100 text-violet-400 hover:text-violet-300 transition-opacity"
          title="Open in the code editor"
        >
          open ↗
        </button>
      </div>
    </div>
  );
}

type ServiceNodeData = { label: string; sub: string; onDrill: () => void };
type ServiceFlowNode = Node<ServiceNodeData, "service">;

function ServiceNode({ data }: NodeProps<ServiceFlowNode>) {
  return (
    <div
      onClick={data.onDrill}
      title="click to open this service"
      className="w-[280px] rounded-2xl border-2 border-zinc-700 bg-[#101015]/95 shadow-[0_6px_32px_rgba(0,0,0,0.45)] hover:border-violet-500/50 transition-all cursor-pointer px-4 py-3.5"
    >
      <Handle type="target" position={Position.Left} id="in" className="!size-2.5 !bg-violet-500/70 !border-0" />
      <Handle type="source" position={Position.Right} id="out" className="!size-2.5 !bg-cyan-400/70 !border-0" />
      <div className="text-[15px] font-semibold text-zinc-100 truncate">{data.label}</div>
      <div className="mt-1.5 text-[10px] text-zinc-500 leading-relaxed line-clamp-2">{data.sub}</div>
      <div className="mt-1.5 text-[9px] text-zinc-600">click to open</div>
    </div>
  );
}

type PortalNodeData = { label: string; sub?: string; onDrill: () => void };
type PortalFlowNode = Node<PortalNodeData, "portal">;

function PortalNode({ data }: NodeProps<PortalFlowNode>) {
  return (
    <div
      onClick={data.onDrill}
      title="connection outside this view — click to go there"
      className="w-[190px] rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60 px-2.5 py-1.5 cursor-pointer hover:border-cyan-500/60 transition-colors"
    >
      <Handle type="target" position={Position.Left} id="in" className="!size-1.5 !bg-violet-400/70 !border-0" />
      <Handle type="source" position={Position.Right} id="out" className="!size-1.5 !bg-cyan-400/70 !border-0" />
      <div className="text-[10.5px] text-zinc-400 truncate">⇄ {data.label}</div>
      {data.sub && <div className="text-[8.5px] text-zinc-600 truncate mt-0.5">{data.sub}</div>}
    </div>
  );
}

type FuncNodeData = {
  name: string;
  subtitle: string;
  lines: number;
  onPeek: () => void;
};
type FuncFlowNode = Node<FuncNodeData, "func">;

function FuncNode({ data }: NodeProps<FuncFlowNode>) {
  return (
    <div
      onClick={data.onPeek}
      className="w-[208px] rounded-lg border border-zinc-800 bg-[#13131b]/95 hover:border-violet-500/50 hover:bg-[#16161f] px-2.5 py-2 cursor-pointer transition-colors"
    >
      <Handle type="target" position={Position.Left} id="in" className="!size-1.5 !bg-violet-400/80 !border-0" />
      <Handle type="source" position={Position.Right} id="out" className="!size-1.5 !bg-cyan-400/80 !border-0" />
      <div className="flex items-center gap-1.5">
        <span className="text-violet-400/80 text-[11px] font-mono">ƒ</span>
        <span className="text-[11.5px] font-mono text-zinc-200 truncate">{data.name}</span>
      </div>
      <div className="text-[9.5px] text-zinc-500 truncate mt-0.5">{data.subtitle}</div>
      <div className="text-[8.5px] text-zinc-600 mt-0.5">{data.lines} lines · click for code</div>
    </div>
  );
}

type StepNodeData = {
  idx: number;
  total: number;
  file: string;
  fn?: string | null;
  does: string;
  example: string;
  state: "done" | "active" | "pending";
  onSelect: () => void;
};
type StepFlowNode = Node<StepNodeData, "step">;

function StepNode({ data }: NodeProps<StepFlowNode>) {
  const tone =
    data.state === "active"
      ? "border-violet-400 shadow-[0_0_30px_rgba(139,92,246,0.45)]"
      : data.state === "done"
        ? "border-violet-500/40"
        : "border-zinc-800 opacity-75";
  return (
    <div
      onClick={data.onSelect}
      className={`w-[250px] rounded-xl border-2 ${tone} bg-[#101015]/95 px-3 py-2.5 cursor-pointer transition-all`}
    >
      <Handle type="target" position={Position.Left} id="in" className="!size-1.5 !bg-violet-400/80 !border-0" />
      <Handle type="source" position={Position.Right} id="out" className="!size-1.5 !bg-amber-400/90 !border-0" />
      <div className="text-[9px] text-zinc-500 tracking-widest">
        STEP {data.idx + 1}/{data.total}
      </div>
      <div className="text-[12px] text-zinc-200 mt-0.5 leading-snug">{data.does}</div>
      <div className="text-[9.5px] font-mono text-zinc-500 mt-1 truncate">
        {data.file.split("/").pop()}
        {data.fn ? ` · ƒ ${data.fn}` : ""}
      </div>
      {data.state === "active" && data.example && (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] font-mono text-amber-200 break-all">
          {data.example}
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  file: memo(FileNode),
  service: memo(ServiceNode),
  portal: memo(PortalNode),
  func: memo(FuncNode),
  step: memo(StepNode),
};

/* ---------- impact analysis ---------- */

function computeImpact(graph: FlowGraph, fileId: string) {
  const callers = graph.edges.filter((e) => e.to === fileId && e.from !== fileId && e.kind === "call");
  const rev = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.from === e.to) continue;
    if (!rev.has(e.to)) rev.set(e.to, new Set());
    rev.get(e.to)!.add(e.from);
  }
  const seen = new Set<string>([fileId]);
  const queue = [fileId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const dep of rev.get(cur) ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  seen.delete(fileId);
  return { callers, transitive: [...seen] };
}

/* ---------- flow view ---------- */

type Crumb = { kind: "service"; id: string } | { kind: "file"; id: string };

interface Props {
  projectPath: string;
  onOpenFile: (absPath: string) => void;
}

interface Peek {
  file: string;
  fn: string;
  start: number;
  end: number;
}

export function FlowView({ projectPath, onOpenFile }: Props) {
  const [graph, setGraph] = useState<FlowGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [annotating, setAnnotating] = useState(false);
  const [annotateProgress, setAnnotateProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<Crumb[]>([]);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [editRequest, setEditRequest] = useState("");
  const [peek, setPeek] = useState<Peek | null>(null);
  const [peekCode, setPeekCode] = useState<string | null>(null);
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [featuresLoading, setFeaturesLoading] = useState(false);
  const [activeFeature, setActiveFeature] = useState<Feature | null>(null);
  const [playStep, setPlayStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [tool, setTool] = useState<"pointer" | "hand">(() =>
    localStorage.getItem("newgen-flow-tool") === "hand" ? "hand" : "pointer",
  );
  const autoRan = useRef(false);
  const featuresRan = useRef(false);
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const pickTool = (t: "pointer" | "hand") => {
    setTool(t);
    localStorage.setItem("newgen-flow-tool", t);
  };

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    scanProject(projectPath)
      .then(setGraph)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectPath]);

  useEffect(() => {
    autoRan.current = false;
    featuresRan.current = false;
    setDrill([]);
    setFeatures(null);
    setActiveFeature(null);
    setPlayStep(-1);
    setPlaying(false);
  }, [projectPath]);

  const loadFeatures = useCallback(
    async (force: boolean) => {
      setFeaturesLoading(true);
      try {
        setFeatures(await flowFeatures(projectPath, force));
      } catch (e) {
        setError(String(e));
      } finally {
        setFeaturesLoading(false);
      }
    },
    [projectPath],
  );

  // Feature playback: example data hops one step at a time.
  useEffect(() => {
    if (!playing || !activeFeature) return;
    if (playStep >= activeFeature.flow.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setPlayStep((s) => s + 1), 1500);
    return () => clearTimeout(t);
  }, [playing, playStep, activeFeature]);

  useEffect(refresh, [refresh]);

  // Drop crumbs that no longer exist after a rescan.
  useEffect(() => {
    if (!graph) return;
    setDrill((d) =>
      d.filter((c) =>
        c.kind === "service"
          ? graph.nodes.some((n) => moduleOf(n.id) === c.id)
          : graph.nodes.some((n) => n.id === c.id),
      ),
    );
  }, [graph]);

  const [refreshCfg, setRefreshCfg] = useState(() => {
    const s = loadSettings();
    return { mode: s.flowRefresh, intervalSec: s.flowRefreshIntervalSec };
  });
  useEffect(() => {
    const onChanged = () => {
      const s = loadSettings();
      setRefreshCfg({ mode: s.flowRefresh, intervalSec: s.flowRefreshIntervalSec });
    };
    window.addEventListener("newgen-settings-changed", onChanged);
    return () => window.removeEventListener("newgen-settings-changed", onChanged);
  }, []);

  useEffect(() => {
    if (refreshCfg.mode === "manual") return;
    const handler = () => refresh();
    window.addEventListener("newgen-flow-refresh", handler);
    return () => window.removeEventListener("newgen-flow-refresh", handler);
  }, [refresh, refreshCfg.mode]);

  useEffect(() => {
    if (refreshCfg.mode !== "interval") return;
    const t = setInterval(refresh, Math.max(5, refreshCfg.intervalSec) * 1000);
    return () => clearInterval(t);
  }, [refresh, refreshCfg]);

  const annotate = useCallback(async () => {
    setError(null);
    try {
      const queued = await flowAnnotate(projectPath);
      if (queued > 0) {
        setAnnotating(true);
        setAnnotateProgress({ done: 0, total: queued });
      }
    } catch (e) {
      setError(String(e));
    }
  }, [projectPath]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const unsubs: UnlistenFn[] = [];
    let off = false;
    void (async () => {
      const onProgress = await listen<{ done: number; total: number }>("flow-annotate-progress", (e) => {
        setAnnotateProgress(e.payload);
        refreshRef.current();
      });
      const onDone = await listen("flow-annotate-done", () => {
        setAnnotating(false);
        setAnnotateProgress(null);
        refreshRef.current();
      });
      const onErr = await listen<string>("flow-annotate-error", (e) => {
        setAnnotating(false);
        setAnnotateProgress(null);
        setError(e.payload);
      });
      if (off) {
        onProgress();
        onDone();
        onErr();
        return;
      }
      unsubs.push(onProgress, onDone, onErr);
    })();
    return () => {
      off = true;
      unsubs.forEach((u) => u());
    };
  }, []);

  useEffect(() => {
    if (!graph || autoRan.current || annotating) return;
    if (graph.nodes.length > 0 && !graph.nodes.some((n) => n.ai)) {
      autoRan.current = true;
      void annotate();
    }
  }, [graph, annotate, annotating]);

  // Load the feature map once per project (cached on disk — instant when unchanged).
  useEffect(() => {
    if (!graph || featuresRan.current || graph.nodes.length === 0) return;
    featuresRan.current = true;
    void loadFeatures(false);
  }, [graph, loadFeatures]);

  useEffect(() => {
    if (!peek) {
      setPeekCode(null);
      return;
    }
    let alive = true;
    readFile(`${projectPath}/${peek.file}`)
      .then((c) => {
        if (!alive) return;
        setPeekCode(c.split("\n").slice(peek.start - 1, peek.end).join("\n"));
      })
      .catch(() => alive && setPeekCode("// could not read file"));
    return () => {
      alive = false;
    };
  }, [peek, projectPath]);

  const multiModule = useMemo(() => {
    if (!graph) return false;
    return new Set(graph.nodes.map((n) => moduleOf(n.id))).size > 1;
  }, [graph]);

  const drillService = useCallback((id: string) => setDrill([{ kind: "service", id }]), []);
  const drillFile = useCallback(
    (id: string) =>
      setDrill(
        multiModule
          ? [
              { kind: "service", id: moduleOf(id) },
              { kind: "file", id },
            ]
          : [{ kind: "file", id }],
      ),
    [multiModule],
  );

  const viewKey = drill.map((c) => `${c.kind}:${c.id}`).join("/") || "root";
  const navKey = activeFeature ? `feature:${activeFeature.name}` : viewKey;

  // Re-frame the canvas and close overlays when navigating.
  useEffect(() => {
    setPeek(null);
    setEditTarget(null);
    const t = setTimeout(() => rfRef.current?.fitView({ duration: 300, maxZoom: 1, padding: 0.15 }), 60);
    return () => clearTimeout(t);
  }, [navKey]);

  // Esc: close overlays first, then exit feature mode, then climb a level.
  const escState = useRef({ peek: false, edit: false, feature: false });
  escState.current = { peek: !!peek, edit: !!editTarget, feature: !!activeFeature };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const s = escState.current;
      if (s.peek) setPeek(null);
      else if (s.edit) setEditTarget(null);
      else if (s.feature) {
        setActiveFeature(null);
        setPlaying(false);
        setPlayStep(-1);
      } else setDrill((d) => d.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const layoutCache = useRef(new Map<string, { nodes: Node[]; edges: Edge[] }>());
  useEffect(() => {
    layoutCache.current.clear();
  }, [graph]);

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[] };

    /* ----- feature mode: the feature's flow as an animated pipeline ----- */
    if (activeFeature) {
      const steps = activeFeature.flow;
      const W = 250;
      const GAP = 110;
      const stepNodes: Node[] = steps.map((s, i) => ({
        id: `step:${i}`,
        type: "step",
        position: { x: i * (W + GAP), y: (i % 2) * 36 },
        data: {
          idx: i,
          total: steps.length,
          file: s.file,
          fn: s.fn,
          does: s.does,
          example: s.example,
          state: i === playStep ? "active" : i < playStep ? "done" : "pending",
          onSelect: () => {
            setPlaying(false);
            setPlayStep(i);
          },
        },
      }));
      const stepEdges: Edge[] = steps.slice(0, -1).map((_, i) => ({
        id: `se-${i}`,
        source: `step:${i}`,
        target: `step:${i + 1}`,
        sourceHandle: "out",
        targetHandle: "in",
        animated: i === playStep,
        style: {
          stroke:
            i < playStep
              ? "rgba(139,92,246,0.7)"
              : i === playStep
                ? "rgba(251,191,36,0.85)"
                : "rgba(113,113,122,0.3)",
          strokeWidth: i <= playStep ? 2 : 1.2,
        },
      }));
      return { nodes: stepNodes, edges: stepEdges };
    }

    const cached = layoutCache.current.get(viewKey);
    if (cached) return cached;

    const last = drill[drill.length - 1];
    const result = (() => {
      /* ----- file view: this file's functions + portals to connected files ----- */
      if (last?.kind === "file") {
        const file = graph.nodes.find((n) => n.id === last.id);
        if (!file) return { nodes: [] as Node[], edges: [] as Edge[] };
        const fnSet = new Set(file.functions.map((f) => f.name));

        const g = new dagre.graphlib.Graph();
        g.setDefaultEdgeLabel(() => ({}));
        g.setGraph({ rankdir: "LR", nodesep: 26, ranksep: 90, marginx: 50, marginy: 50 });
        for (const f of file.functions) g.setNode(`fn:${f.name}`, { width: FUNC_W, height: FUNC_H });

        // portals: one per external file this file talks to
        const portals = new Map<string, { inbound: boolean; outbound: boolean }>();
        for (const e of graph.edges) {
          if (e.from === last.id && e.to !== last.id) {
            const p = portals.get(e.to) ?? { inbound: false, outbound: false };
            p.outbound = true;
            portals.set(e.to, p);
          } else if (e.to === last.id && e.from !== last.id) {
            const p = portals.get(e.from) ?? { inbound: false, outbound: false };
            p.inbound = true;
            portals.set(e.from, p);
          }
        }
        for (const ext of portals.keys()) g.setNode(`portal:${ext}`, { width: 190, height: 50 });

        const rfEdges: Edge[] = [];
        const seenEdge = new Set<string>();
        graph.edges.forEach((e, i) => {
          const isCall = e.kind === "call";
          const style = isCall
            ? { stroke: "rgba(124,92,255,0.5)", strokeWidth: 1.5 }
            : { stroke: "rgba(113,113,122,0.3)", strokeWidth: 1, strokeDasharray: "4 4" };
          // intra-file
          if (e.from === last.id && e.to === last.id) {
            if (e.fromFn && e.toFn && fnSet.has(e.fromFn) && fnSet.has(e.toFn)) {
              const k = `i:${e.fromFn}->${e.toFn}`;
              if (seenEdge.has(k)) return;
              seenEdge.add(k);
              g.setEdge(`fn:${e.fromFn}`, `fn:${e.toFn}`);
              rfEdges.push({
                id: `e-${i}`,
                source: `fn:${e.fromFn}`,
                target: `fn:${e.toFn}`,
                sourceHandle: "out",
                targetHandle: "in",
                animated: true,
                style: { stroke: "rgba(56,189,248,0.5)", strokeWidth: 1.5 },
              });
            }
            return;
          }
          // outbound
          if (e.from === last.id && portals.has(e.to)) {
            const src = e.fromFn && fnSet.has(e.fromFn) ? `fn:${e.fromFn}` : null;
            if (!src) return;
            const k = `o:${e.fromFn}->${e.to}`;
            if (seenEdge.has(k)) return;
            seenEdge.add(k);
            g.setEdge(src, `portal:${e.to}`);
            rfEdges.push({
              id: `e-${i}`,
              source: src,
              target: `portal:${e.to}`,
              sourceHandle: "out",
              targetHandle: "in",
              animated: isCall,
              style,
            });
            return;
          }
          // inbound
          if (e.to === last.id && portals.has(e.from)) {
            const tgt = e.toFn && fnSet.has(e.toFn) ? `fn:${e.toFn}` : null;
            if (!tgt) return;
            const k = `in:${e.from}->${e.toFn}`;
            if (seenEdge.has(k)) return;
            seenEdge.add(k);
            g.setEdge(`portal:${e.from}`, tgt);
            rfEdges.push({
              id: `e-${i}`,
              source: `portal:${e.from}`,
              target: tgt,
              sourceHandle: "out",
              targetHandle: "in",
              animated: isCall,
              style,
            });
          }
        });

        dagre.layout(g);
        const rfNodes: Node[] = [];
        for (const f of file.functions) {
          const pos = g.node(`fn:${f.name}`);
          rfNodes.push({
            id: `fn:${f.name}`,
            type: "func",
            position: { x: pos.x - FUNC_W / 2, y: pos.y - FUNC_H / 2 },
            data: {
              name: f.name,
              subtitle: humanize(f.name),
              lines: Math.max(1, f.endLine - f.startLine + 1),
              onPeek: () => setPeek({ file: last.id, fn: f.name, start: f.startLine, end: f.endLine }),
            },
          });
        }
        for (const [ext] of portals) {
          const pos = g.node(`portal:${ext}`);
          const extNode = graph.nodes.find((n) => n.id === ext);
          rfNodes.push({
            id: `portal:${ext}`,
            type: "portal",
            position: { x: pos.x - 95, y: pos.y - 25 },
            data: {
              label: ext.split("/").pop() ?? ext,
              sub: extNode?.purpose,
              onDrill: () => drillFile(ext),
            },
          });
        }
        return { nodes: rfNodes, edges: rfEdges };
      }

      /* ----- service view: this service's files + portals to other services ----- */
      if (last?.kind === "service" || !multiModule) {
        const serviceId = last?.kind === "service" ? last.id : null;
        const files = serviceId
          ? graph.nodes.filter((n) => moduleOf(n.id) === serviceId)
          : graph.nodes;
        const fileSet = new Set(files.map((f) => f.id));
        const big = files.length > PERF.bigView;

        const wired = new Map<string, Set<string>>();
        for (const e of graph.edges) {
          if (e.fromFn && fileSet.has(e.from)) {
            if (!wired.has(e.from)) wired.set(e.from, new Set());
            wired.get(e.from)!.add(e.fromFn);
          }
          if (e.toFn && fileSet.has(e.to)) {
            if (!wired.has(e.to)) wired.set(e.to, new Set());
            wired.get(e.to)!.add(e.toFn);
          }
        }
        const shownByFile = new Map<string, string[]>();
        for (const n of files) {
          const w = wired.get(n.id) ?? new Set();
          const names = n.functions.map((f) => f.name);
          const ordered = [...names.filter((f) => w.has(f)), ...names.filter((f) => !w.has(f))];
          shownByFile.set(n.id, ordered.slice(0, MAX_ROWS));
        }

        // portals to other services
        const portals = new Map<string, { count: number }>();
        if (serviceId) {
          for (const e of graph.edges) {
            const fromIn = fileSet.has(e.from);
            const toIn = fileSet.has(e.to);
            if (fromIn === toIn) continue;
            const ext = moduleOf(fromIn ? e.to : e.from);
            const p = portals.get(ext) ?? { count: 0 };
            p.count += 1;
            portals.set(ext, p);
          }
        }

        const g = new dagre.graphlib.Graph();
        g.setDefaultEdgeLabel(() => ({}));
        g.setGraph({ rankdir: "LR", nodesep: 32, ranksep: 100, marginx: 50, marginy: 50 });
        for (const n of files) {
          const shown = shownByFile.get(n.id) ?? [];
          g.setNode(n.id, {
            width: FILE_W,
            height: fileCardHeight(shown.length, n.functions.length - shown.length),
          });
        }
        for (const ext of portals.keys()) g.setNode(`portal:${ext}`, { width: 190, height: 50 });

        const rfEdges: Edge[] = [];
        const pairSeen = new Set<string>();
        const portalPair = new Set<string>();
        graph.edges.forEach((e, i) => {
          if (e.from === e.to) return;
          const fromIn = fileSet.has(e.from);
          const toIn = fileSet.has(e.to);
          const isCall = e.kind === "call";
          if (fromIn && toIn) {
            const k = `${e.from}|${e.fromFn ?? ""}->${e.to}|${e.toFn ?? ""}`;
            if (pairSeen.has(k)) return;
            pairSeen.add(k);
            g.setEdge(e.from, e.to);
            const fromShown = shownByFile.get(e.from) ?? [];
            const toShown = shownByFile.get(e.to) ?? [];
            rfEdges.push({
              id: `e-${i}`,
              source: e.from,
              target: e.to,
              sourceHandle: e.fromFn && fromShown.includes(e.fromFn) ? `out-${e.fromFn}` : "out",
              targetHandle: e.toFn && toShown.includes(e.toFn) ? `in-${e.toFn}` : "in",
              animated: isCall && !big,
              style: isCall
                ? { stroke: "rgba(124,92,255,0.45)", strokeWidth: 1.5 }
                : { stroke: "rgba(113,113,122,0.25)", strokeWidth: 1, strokeDasharray: "4 4" },
            });
          } else if (serviceId && fromIn !== toIn) {
            const ext = moduleOf(fromIn ? e.to : e.from);
            const inner = fromIn ? e.from : e.to;
            const k = fromIn ? `${inner}->portal:${ext}` : `portal:${ext}->${inner}`;
            if (portalPair.has(k)) return;
            portalPair.add(k);
            if (fromIn) g.setEdge(inner, `portal:${ext}`);
            else g.setEdge(`portal:${ext}`, inner);
            rfEdges.push({
              id: `pe-${i}`,
              source: fromIn ? inner : `portal:${ext}`,
              target: fromIn ? `portal:${ext}` : inner,
              sourceHandle: "out",
              targetHandle: "in",
              animated: false,
              style: { stroke: "rgba(113,113,122,0.3)", strokeWidth: 1, strokeDasharray: "4 4" },
            });
          }
        });

        dagre.layout(g);
        const rfNodes: Node[] = [];
        for (const n of files) {
          const pos = g.node(n.id);
          const shown = shownByFile.get(n.id) ?? [];
          rfNodes.push({
            id: n.id,
            type: "file",
            position: { x: pos.x - FILE_W / 2, y: pos.y - pos.height / 2 },
            data: {
              name: n.name,
              dir: n.dir,
              shownFns: shown,
              hiddenCount: n.functions.length - shown.length,
              loc: n.loc,
              role: n.role,
              purpose: n.purpose,
              ai: n.ai,
              inlet: n.inlet,
              outlet: n.outlet,
              uses: n.uses,
              usedBy: n.usedBy,
              onOpen: () => onOpenFile(`${projectPath}/${n.id}`),
              onEdit: () => {
                setEditTarget(n.id);
                setEditRequest("");
              },
              onDrill: () => drillFile(n.id),
            },
          });
        }
        for (const [ext, p] of portals) {
          const pos = g.node(`portal:${ext}`);
          rfNodes.push({
            id: `portal:${ext}`,
            type: "portal",
            position: { x: pos.x - 95, y: pos.y - 25 },
            data: {
              label: ext,
              sub: `${p.count} connection${p.count > 1 ? "s" : ""}`,
              onDrill: () => drillService(ext),
            },
          });
        }
        return { nodes: rfNodes, edges: rfEdges };
      }

      /* ----- root: services ----- */
      interface Mod {
        count: number;
        roles: Map<string, number>;
        inlet: boolean;
        outlet: boolean;
      }
      const mods = new Map<string, Mod>();
      for (const n of graph.nodes) {
        const m = moduleOf(n.id);
        const mod = mods.get(m) ?? { count: 0, roles: new Map(), inlet: false, outlet: false };
        mod.count += 1;
        mod.roles.set(n.role, (mod.roles.get(n.role) ?? 0) + 1);
        mod.inlet ||= n.inlet;
        mod.outlet ||= n.outlet;
        mods.set(m, mod);
      }
      const agg = new Map<string, { count: number; call: boolean }>();
      for (const e of graph.edges) {
        const a = moduleOf(e.from);
        const b = moduleOf(e.to);
        if (a === b) continue;
        const k = `${a}→${b}`;
        const cur = agg.get(k) ?? { count: 0, call: false };
        cur.count += 1;
        cur.call ||= e.kind === "call";
        agg.set(k, cur);
      }
      const g = new dagre.graphlib.Graph();
      g.setDefaultEdgeLabel(() => ({}));
      g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 130, marginx: 60, marginy: 60 });
      for (const name of mods.keys()) g.setNode(name, { width: 280, height: 120 });
      for (const k of agg.keys()) {
        const [a, b] = k.split("→");
        g.setEdge(a, b);
      }
      dagre.layout(g);

      const rfNodes: Node[] = [...mods.entries()].map(([name, m]) => {
        const pos = g.node(name);
        const topRoles = [...m.roles.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([r]) => {
            const s = ROLE_STYLE[r] ?? ROLE_STYLE.util;
            return `${s.icon} ${s.label}`;
          })
          .join(" · ");
        return {
          id: `svc:${name}`,
          type: "service",
          position: { x: pos.x - 140, y: pos.y - 60 },
          data: {
            label: name,
            sub: `${m.count} files · ${topRoles}${m.inlet ? " · ⇥in" : ""}${m.outlet ? " · out↦" : ""}`,
            onDrill: () => drillService(name),
          },
        };
      });
      const rfEdges: Edge[] = [...agg.entries()].map(([k, v], i) => {
        const [a, b] = k.split("→");
        return {
          id: `me-${i}`,
          source: `svc:${a}`,
          target: `svc:${b}`,
          sourceHandle: "out",
          targetHandle: "in",
          animated: v.call && mods.size <= 60,
          label: v.count > 1 ? `${v.count}` : undefined,
          labelStyle: { fill: "#71717a", fontSize: 10 },
          labelBgStyle: { fill: "#0a0a0e" },
          style: {
            stroke: v.call ? "rgba(124,92,255,0.5)" : "rgba(113,113,122,0.3)",
            strokeWidth: Math.min(1 + v.count * 0.4, 4),
          },
        };
      });
      return { nodes: rfNodes, edges: rfEdges };
    })();

    layoutCache.current.set(viewKey, result);
    return result;
  }, [graph, drill, viewKey, multiModule, onOpenFile, projectPath, drillFile, drillService, activeFeature, playStep]);

  const impact = useMemo(() => {
    if (!graph || !editTarget) return null;
    return computeImpact(graph, editTarget);
  }, [graph, editTarget]);

  const sendEdit = useCallback(() => {
    if (!graph || !editTarget || !editRequest.trim() || !impact) return;
    const callerLines = impact.callers
      .slice(0, 20)
      .map((e) => `  - ${e.from}${e.fromFn ? ` → ${e.fromFn}()` : ""} uses ${e.toFn ? `${e.toFn}()` : "this module"}`);
    const prompt = [
      `Edit ${editTarget}: ${editRequest.trim()}`,
      ``,
      `Impact analysis from the editor's dependency graph — verify while working:`,
      callerLines.length
        ? `Call sites that use this file:\n${callerLines.join("\n")}`
        : `No known call sites inside the project use this file.`,
      impact.transitive.length
        ? `Files transitively depending on it: ${impact.transitive.slice(0, 15).join(", ")}${
            impact.transitive.length > 15 ? ` (+${impact.transitive.length - 15} more)` : ""
          }`
        : ``,
      ``,
      `After making the change, check every listed call site for breakage (signatures, types, behavior) and update them if needed. Then summarize what you changed and which dependents you touched.`,
    ]
      .filter(Boolean)
      .join("\n");
    window.dispatchEvent(new CustomEvent("newgen-claude-open"));
    window.dispatchEvent(new CustomEvent("newgen-chat-send", { detail: prompt }));
    setEditTarget(null);
    setEditRequest("");
  }, [graph, editTarget, editRequest, impact]);

  const projectName = projectPath.split("/").pop() ?? projectPath;

  return (
    <div className="h-full flex flex-col bg-[#08080c]">
      <div className="h-8 shrink-0 flex items-center gap-2 px-3 border-b border-zinc-800/40 select-none">
        <span className="text-[10px] font-semibold tracking-widest text-zinc-500">FLOW</span>
        <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-900/60 p-0.5 shrink-0">
          <button
            onClick={() => pickTool("pointer")}
            title="Select tool — click blocks to drill in; pan with right/middle drag or trackpad scroll"
            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
              tool === "pointer" ? "bg-violet-500/20 text-violet-200" : "text-zinc-600 hover:text-zinc-300"
            }`}
          >
            ⌖
          </button>
          <button
            onClick={() => pickTool("hand")}
            title="Hand tool — drag anywhere to pan the canvas (clicks on blocks still work)"
            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
              tool === "hand" ? "bg-violet-500/20 text-violet-200" : "text-zinc-600 hover:text-zinc-300"
            }`}
          >
            ✋
          </button>
        </div>
        {drill.length > 0 && (
          <button
            onClick={() => setDrill((d) => d.slice(0, -1))}
            className="text-[12px] text-zinc-500 hover:text-zinc-200 transition-colors"
            title="Up one level (Esc)"
          >
            ←
          </button>
        )}
        <div className="flex items-center gap-1 text-[11px] min-w-0">
          <button
            onClick={() => {
              setDrill([]);
              setActiveFeature(null);
              setPlaying(false);
              setPlayStep(-1);
            }}
            className={`truncate transition-colors ${
              drill.length === 0 && !activeFeature ? "text-violet-300" : "text-zinc-500 hover:text-zinc-200"
            }`}
          >
            ⌂ {projectName}
          </button>
          {!activeFeature &&
            drill.map((c, i) => (
              <Fragment key={`${c.kind}:${c.id}`}>
                <span className="text-zinc-700">▸</span>
                <button
                  onClick={() => setDrill(drill.slice(0, i + 1))}
                  className={`truncate transition-colors ${
                    i === drill.length - 1 ? "text-violet-300" : "text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {c.kind === "file" ? c.id.split("/").pop() : c.id}
                </button>
              </Fragment>
            ))}
          {activeFeature && (
            <>
              <span className="text-zinc-700">▸</span>
              <span className="text-amber-300 truncate">⚡ {activeFeature.name}</span>
            </>
          )}
        </div>
        {activeFeature && (
          <>
            <button
              onClick={() => {
                if (playing) {
                  setPlaying(false);
                } else {
                  setPlayStep(0);
                  setPlaying(true);
                }
              }}
              className="text-[10.5px] px-2.5 py-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors shrink-0"
            >
              {playing ? "⏸ pause" : "▶ run example"}
            </button>
            <button
              onClick={() => {
                setActiveFeature(null);
                setPlaying(false);
                setPlayStep(-1);
              }}
              className="text-[10.5px] px-2 py-0.5 rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
            >
              ✕ exit
            </button>
          </>
        )}
        {loading && graph && (
          <span className="text-[10px] text-violet-300/80 animate-pulse shrink-0">rescanning…</span>
        )}
        {error && <span className="text-[10px] text-red-400 truncate max-w-[220px]">{error}</span>}
        <div className="flex-1" />
        <span className="text-[9.5px] text-zinc-700 hidden lg:block">
          click a block to go deeper · Esc to go up
        </span>
        <button
          onClick={annotate}
          disabled={annotating}
          title="Ask Claude to write a one-line purpose on every block (cached — only re-runs for changed files; runs automatically on first open)"
          className={`text-[10.5px] px-2.5 py-0.5 rounded-md border transition-colors shrink-0 ${
            annotating
              ? "border-violet-500/40 text-violet-300 animate-pulse"
              : "border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
          }`}
        >
          ✦{" "}
          {annotating
            ? annotateProgress
              ? `explaining… ${annotateProgress.done}/${annotateProgress.total}`
              : "explaining your code…"
            : "Re-explain changed"}
        </button>
        <button
          onClick={refresh}
          className="text-zinc-600 hover:text-zinc-300 transition-colors text-[13px] shrink-0"
          title="Rescan project"
        >
          ⟳
        </button>
      </div>
      <div className="flex-1 min-h-0 relative">
        {loading && !graph && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <div className="size-6 rounded-full border-2 border-violet-500/30 border-t-violet-400 animate-spin" />
            <span className="text-[12px]">Mapping your code flow…</span>
          </div>
        )}
        {!loading && !error && nodes.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-zinc-600">
            <p className="text-sm">Nothing to show here</p>
            <p className="text-[11px] text-zinc-700">
              Flow View maps TS/JS in v1 — more languages later (⌘G for Code view)
            </p>
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
          minZoom={0.08}
          maxZoom={2.2}
          nodesConnectable={false}
          nodesDraggable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable
          panOnDrag={tool === "hand" ? true : [1, 2]}
          onlyRenderVisibleElements
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
          onInit={(inst) => {
            rfRef.current = inst;
          }}
        >
          {/* space mesh: a large grid behind a fine dot field */}
          <Background id="mesh" variant={BackgroundVariant.Lines} gap={140} color="#12121c" />
          <Background id="dots" variant={BackgroundVariant.Dots} gap={24} size={1} color="#1d1d28" />
          <Controls showInteractive={false} />
          {nodes.length <= PERF.minimapMax && !activeFeature && (
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(8,8,12,0.78)"
              nodeColor={(n) => (n.type === "portal" ? "#15151f" : "#2d2d3a")}
            />
          )}
          <Panel position="bottom-right">
            <div className="w-[212px] rounded-xl border border-zinc-800 bg-[#101015]/95 shadow-xl p-2.5 select-none">
              <div className="flex items-center justify-between">
                <span className="text-[9.5px] font-semibold tracking-widest text-zinc-500">FEATURES</span>
                <button
                  onClick={() => loadFeatures(true)}
                  title="Re-map features with AI"
                  className="text-zinc-600 hover:text-violet-300 text-[11px] transition-colors"
                >
                  ✦
                </button>
              </div>
              {featuresLoading && (
                <div className="mt-2 text-[10px] text-violet-300 animate-pulse">✦ mapping features…</div>
              )}
              {!featuresLoading && features && features.length === 0 && (
                <div className="mt-2 text-[10px] text-zinc-600">none detected</div>
              )}
              {!featuresLoading && !features && (
                <button
                  onClick={() => loadFeatures(false)}
                  className="mt-2 text-[10.5px] text-violet-300 hover:underline"
                >
                  ✦ Map features
                </button>
              )}
              <div className="mt-1.5 space-y-1 max-h-[40vh] overflow-y-auto">
                {features?.map((f) => (
                  <button
                    key={f.name}
                    onClick={() => {
                      setActiveFeature(f);
                      setPlaying(false);
                      setPlayStep(-1);
                    }}
                    title={f.description}
                    className={`w-full text-left px-2 py-1 rounded-md text-[11px] transition-colors ${
                      activeFeature?.name === f.name
                        ? "bg-amber-500/20 text-amber-200"
                        : "text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200"
                    }`}
                  >
                    ⚡ {f.name}
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        </ReactFlow>

        {peek && (
          <div className="absolute right-3 top-3 bottom-3 z-20 w-[440px] flex flex-col rounded-xl border border-zinc-700 bg-[#0d0d13]/98 shadow-2xl overflow-hidden">
            <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-zinc-800/60">
              <span className="text-violet-400 font-mono text-[12px]">ƒ {peek.fn}</span>
              <span className="text-[10px] text-zinc-600 truncate">
                {peek.file} · L{peek.start}–{peek.end}
              </span>
              <div className="flex-1" />
              <button
                onClick={() => {
                  setEditTarget(peek.file);
                  setEditRequest(`In ${peek.fn}(): `);
                  setPeek(null);
                }}
                className="text-[10.5px] px-2 py-0.5 rounded-md border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 transition-colors"
              >
                ✎ ai edit
              </button>
              <button
                onClick={() => {
                  onOpenFile(`${projectPath}/${peek.file}`);
                  setPeek(null);
                }}
                className="text-[10.5px] px-2 py-0.5 rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                open file ↗
              </button>
              <button onClick={() => setPeek(null)} className="text-zinc-600 hover:text-zinc-300 ml-1">
                ×
              </button>
            </div>
            <pre className="flex-1 min-h-0 overflow-auto px-3 py-2 text-[11px] leading-[1.55] font-mono text-zinc-300 whitespace-pre">
              {peekCode ?? "loading…"}
            </pre>
          </div>
        )}

        {editTarget && impact && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[460px] rounded-xl border border-amber-500/30 bg-[#101015]/98 shadow-2xl p-3.5">
            <div className="flex items-center gap-2">
              <span className="text-amber-300 text-[12px]">✎</span>
              <span className="text-[12px] font-medium text-zinc-200 truncate">{editTarget}</span>
              <div className="flex-1" />
              <button onClick={() => setEditTarget(null)} className="text-zinc-600 hover:text-zinc-300">
                ×
              </button>
            </div>
            <div className="mt-1.5 text-[10.5px] text-zinc-500 leading-relaxed">
              ⚠ Impact: <span className="text-amber-300/90">{impact.callers.length} call sites</span> ·{" "}
              <span className="text-amber-300/90">{impact.transitive.length} dependent files</span> — the
              agent will receive this analysis and must check every affected site.
            </div>
            <textarea
              autoFocus
              value={editRequest}
              onChange={(e) => setEditRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendEdit();
                }
                if (e.key === "Escape") setEditTarget(null);
              }}
              rows={2}
              placeholder="Describe the change… (Enter to send to the agent)"
              className="mt-2 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-amber-500/50 transition-colors"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => setEditTarget(null)}
                className="text-[11px] px-2.5 py-1 rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
              <button
                onClick={sendEdit}
                disabled={!editRequest.trim()}
                className="text-[11px] px-2.5 py-1 rounded-md bg-amber-600 text-white disabled:opacity-30 hover:bg-amber-500 transition-colors"
              >
                Send impact-aware edit →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
