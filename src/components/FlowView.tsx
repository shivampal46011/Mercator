import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import type { FlowGraph } from "../types";
import { flowAnnotate, readFile, scanProject } from "../lib/ipc";
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

type Level = "modules" | "files" | "detail";
const levelFor = (zoom: number): Level => (zoom < 0.5 ? "modules" : zoom < 1.05 ? "files" : "detail");
const LEVEL_ZOOM: Record<Level, number> = { modules: 0.35, files: 0.8, detail: 1.25 };

const MAX_ROWS = 8;
const FILE_W = 240;
const FUNC_W = 208;
const FUNC_H = 66;

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

/* ---------- masonry placement inside a boundary box ---------- */

function masonry(items: { id: string; h: number }[], itemW: number, headerH: number) {
  const cols = items.length > 6 ? 2 : 1;
  const pad = 14;
  const colY: number[] = Array(cols).fill(headerH + pad);
  const pos: Record<string, { x: number; y: number }> = {};
  for (const it of items) {
    let c = 0;
    for (let i = 1; i < cols; i++) if (colY[i] < colY[c]) c = i;
    pos[it.id] = { x: pad + c * (itemW + pad), y: colY[c] };
    colY[c] += it.h + pad;
  }
  const h = Math.max(...colY, headerH + pad) + 4;
  return { pos, w: pad + cols * (itemW + pad), h };
}

/* ---------- nodes ---------- */

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
};
type FileFlowNode = Node<FileNodeData, "file">;

function FileNode({ data }: NodeProps<FileFlowNode>) {
  const style = ROLE_STYLE[data.role] ?? ROLE_STYLE.util;
  return (
    <div
      onDoubleClick={data.onOpen}
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
        <span className="opacity-0 group-hover:opacity-100 text-violet-400 transition-opacity">open ↗</span>
      </div>
    </div>
  );
}

type BoundaryNodeData = { label: string; sub?: string; tone: "service" | "file" };
type BoundaryFlowNode = Node<BoundaryNodeData, "boundary">;

function BoundaryNode({ data }: NodeProps<BoundaryFlowNode>) {
  const service = data.tone === "service";
  return (
    <div
      className={`w-full h-full rounded-2xl border border-dashed ${
        service ? "border-zinc-700/80 bg-zinc-500/[0.03]" : "border-violet-500/25 bg-violet-500/[0.03]"
      }`}
    >
      <Handle type="target" position={Position.Left} id="in" className="!size-2 !bg-violet-500/60 !border-0" />
      <Handle type="source" position={Position.Right} id="out" className="!size-2 !bg-cyan-400/60 !border-0" />
      <div className="px-3.5 py-2 flex items-baseline gap-2 overflow-hidden">
        <span
          className={`text-[10.5px] font-semibold tracking-widest uppercase truncate ${
            service ? "text-zinc-400" : "text-violet-300/90"
          }`}
        >
          {data.label}
        </span>
        {data.sub && <span className="text-[9.5px] text-zinc-600 truncate">{data.sub}</span>}
      </div>
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

const nodeTypes = { file: FileNode, boundary: BoundaryNode, func: FuncNode };

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
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("files");
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [editRequest, setEditRequest] = useState("");
  const [peek, setPeek] = useState<Peek | null>(null);
  const [peekCode, setPeekCode] = useState<string | null>(null);
  const autoRan = useRef(false);
  const levelRef = useRef<Level>("files");
  const rfRef = useRef<ReactFlowInstance | null>(null);

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
  }, [projectPath]);

  useEffect(refresh, [refresh]);

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
    setAnnotating(true);
    setError(null);
    try {
      await flowAnnotate(projectPath);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setAnnotating(false);
    }
  }, [projectPath, refresh]);

  useEffect(() => {
    if (!graph || autoRan.current || annotating) return;
    if (graph.nodes.length > 0 && !graph.nodes.some((n) => n.ai)) {
      autoRan.current = true;
      void annotate();
    }
  }, [graph, annotate, annotating]);

  // Code peek: fetch the function's lines on demand.
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

  const setZoomLevel = useCallback((l: Level) => {
    rfRef.current?.zoomTo(LEVEL_ZOOM[l], { duration: 350 });
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[] };

    /* ----- modules: aggregated service blocks ----- */
    if (level === "modules") {
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
      for (const name of mods.keys()) g.setNode(name, { width: 280, height: 110 });
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
          type: "boundary",
          position: { x: pos.x - 140, y: pos.y - 55 },
          style: { width: 280, height: 110 },
          data: {
            label: name,
            sub: `${m.count} files · ${topRoles}${m.inlet ? " · ⇥in" : ""}${m.outlet ? " · out↦" : ""}`,
            tone: "service" as const,
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
          animated: v.call,
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
    }

    /* ----- detail: file boundaries containing function blocks ----- */
    if (level === "detail") {
      const fnExists = new Map<string, Set<string>>();
      for (const n of graph.nodes) fnExists.set(n.id, new Set(n.functions.map((f) => f.name)));

      const geo = new Map<string, ReturnType<typeof masonry>>();
      for (const n of graph.nodes) {
        geo.set(
          n.id,
          masonry(
            n.functions.map((f) => ({ id: f.name, h: FUNC_H })),
            FUNC_W,
            34,
          ),
        );
      }

      const g = new dagre.graphlib.Graph();
      g.setDefaultEdgeLabel(() => ({}));
      g.setGraph({ rankdir: "LR", nodesep: 46, ranksep: 120, marginx: 50, marginy: 50 });
      for (const n of graph.nodes) {
        const m = geo.get(n.id)!;
        g.setNode(n.id, { width: Math.max(m.w, 236), height: Math.max(m.h, 64) });
      }
      const pairSeen = new Set<string>();
      for (const e of graph.edges) {
        if (e.from === e.to) continue;
        const key = `${e.from}→${e.to}`;
        if (!pairSeen.has(key)) {
          pairSeen.add(key);
          g.setEdge(e.from, e.to);
        }
      }
      dagre.layout(g);

      const groupNodes: Node[] = [];
      const childNodes: Node[] = [];
      for (const n of graph.nodes) {
        const m = geo.get(n.id)!;
        const pos = g.node(n.id);
        const w = Math.max(m.w, 236);
        const h = Math.max(m.h, 64);
        groupNodes.push({
          id: `grp:${n.id}`,
          type: "boundary",
          position: { x: pos.x - w / 2, y: pos.y - h / 2 },
          style: { width: w, height: h },
          data: { label: n.name, sub: n.purpose, tone: "file" as const },
        });
        for (const f of n.functions) {
          childNodes.push({
            id: `fn:${n.id}#${f.name}`,
            type: "func",
            parentId: `grp:${n.id}`,
            extent: "parent",
            position: m.pos[f.name],
            data: {
              name: f.name,
              subtitle: humanize(f.name),
              lines: Math.max(1, f.endLine - f.startLine + 1),
              onPeek: () => setPeek({ file: n.id, fn: f.name, start: f.startLine, end: f.endLine }),
            },
          });
        }
      }

      const rfEdges: Edge[] = [];
      graph.edges.forEach((e, i) => {
        const srcFn = e.fromFn && fnExists.get(e.from)?.has(e.fromFn);
        const tgtFn = e.toFn && fnExists.get(e.to)?.has(e.toFn);
        if (e.from === e.to && !(srcFn && tgtFn)) return;
        const isCall = e.kind === "call";
        rfEdges.push({
          id: `e-${i}`,
          source: srcFn ? `fn:${e.from}#${e.fromFn}` : `grp:${e.from}`,
          target: tgtFn ? `fn:${e.to}#${e.toFn}` : `grp:${e.to}`,
          sourceHandle: "out",
          targetHandle: "in",
          animated: isCall,
          style: isCall
            ? { stroke: e.from === e.to ? "rgba(56,189,248,0.45)" : "rgba(124,92,255,0.45)", strokeWidth: 1.5 }
            : { stroke: "rgba(113,113,122,0.25)", strokeWidth: 1, strokeDasharray: "4 4" },
        });
      });
      return { nodes: [...groupNodes, ...childNodes], edges: rfEdges };
    }

    /* ----- files: service boundaries containing file cards ----- */
    const wired = new Map<string, Set<string>>();
    const mark = (file: string, fn?: string) => {
      if (!fn) return;
      if (!wired.has(file)) wired.set(file, new Set());
      wired.get(file)!.add(fn);
    };
    for (const e of graph.edges) {
      mark(e.from, e.fromFn);
      mark(e.to, e.toFn);
    }

    const shownByFile = new Map<string, string[]>();
    const heights = new Map<string, number>();
    for (const n of graph.nodes) {
      const w = wired.get(n.id) ?? new Set();
      const names = n.functions.map((f) => f.name);
      const ordered = [...names.filter((f) => w.has(f)), ...names.filter((f) => !w.has(f))];
      const shown = ordered.slice(0, MAX_ROWS);
      shownByFile.set(n.id, shown);
      heights.set(n.id, fileCardHeight(shown.length, names.length - shown.length));
    }

    const byModule = new Map<string, typeof graph.nodes>();
    for (const n of graph.nodes) {
      const m = moduleOf(n.id);
      if (!byModule.has(m)) byModule.set(m, []);
      byModule.get(m)!.push(n);
    }

    const geo = new Map<string, ReturnType<typeof masonry>>();
    for (const [m, files] of byModule) {
      geo.set(
        m,
        masonry(
          files.map((f) => ({ id: f.id, h: heights.get(f.id)! })),
          FILE_W,
          30,
        ),
      );
    }

    const agg = new Set<string>();
    for (const e of graph.edges) {
      const a = moduleOf(e.from);
      const b = moduleOf(e.to);
      if (a !== b) agg.add(`${a}→${b}`);
    }
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 140, marginx: 60, marginy: 60 });
    for (const [m, mGeo] of geo) g.setNode(m, { width: mGeo.w, height: mGeo.h });
    for (const k of agg) {
      const [a, b] = k.split("→");
      g.setEdge(a, b);
    }
    dagre.layout(g);

    const groupNodes: Node[] = [];
    const childNodes: Node[] = [];
    for (const [m, files] of byModule) {
      const mGeo = geo.get(m)!;
      const pos = g.node(m);
      groupNodes.push({
        id: `svc:${m}`,
        type: "boundary",
        position: { x: pos.x - mGeo.w / 2, y: pos.y - mGeo.h / 2 },
        style: { width: mGeo.w, height: mGeo.h },
        data: { label: m, sub: `${files.length} files`, tone: "service" as const },
      });
      for (const n of files) {
        const shown = shownByFile.get(n.id) ?? [];
        childNodes.push({
          id: n.id,
          type: "file",
          parentId: `svc:${m}`,
          extent: "parent",
          position: mGeo.pos[n.id],
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
          },
        });
      }
    }

    const rfEdges: Edge[] = [];
    graph.edges.forEach((e, i) => {
      if (e.from === e.to) return; // intra-file edges render at detail level
      const fromShown = shownByFile.get(e.from) ?? [];
      const toShown = shownByFile.get(e.to) ?? [];
      const isCall = e.kind === "call";
      rfEdges.push({
        id: `e-${i}`,
        source: e.from,
        target: e.to,
        sourceHandle: e.fromFn && fromShown.includes(e.fromFn) ? `out-${e.fromFn}` : "out",
        targetHandle: e.toFn && toShown.includes(e.toFn) ? `in-${e.toFn}` : "in",
        animated: isCall,
        style: isCall
          ? { stroke: "rgba(124,92,255,0.45)", strokeWidth: 1.5 }
          : { stroke: "rgba(113,113,122,0.25)", strokeWidth: 1, strokeDasharray: "4 4" },
      });
    });
    return { nodes: [...groupNodes, ...childNodes], edges: rfEdges };
  }, [graph, level, onOpenFile, projectPath]);

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

  const callCount = graph?.edges.filter((e) => e.kind === "call").length ?? 0;

  const seg = (l: Level, label: string) => (
    <button
      key={l}
      onClick={() => setZoomLevel(l)}
      className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
        level === l ? "bg-violet-500/20 text-violet-200" : "text-zinc-600 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="h-full flex flex-col bg-[#08080c]">
      <div className="h-8 shrink-0 flex items-center gap-2 px-3 border-b border-zinc-800/40 select-none">
        <span className="text-[10px] font-semibold tracking-widest text-zinc-500">FLOW VIEW</span>
        <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-900/60 p-0.5">
          {seg("modules", "Services")}
          {seg("files", "Files")}
          {seg("detail", "Functions")}
        </div>
        {graph && (
          <span className="text-[10px] text-zinc-600">
            {graph.nodes.length} blocks · {callCount} function links
            {graph.truncated && " · showing first 400 files"}
          </span>
        )}
        {error && <span className="text-[10px] text-red-400 truncate max-w-[260px]">{error}</span>}
        <div className="flex-1" />
        <button
          onClick={annotate}
          disabled={annotating}
          title="Ask Claude to write a one-line purpose on every block (cached — only re-runs for changed files; runs automatically on first open)"
          className={`text-[10.5px] px-2.5 py-0.5 rounded-md border transition-colors ${
            annotating
              ? "border-violet-500/40 text-violet-300 animate-pulse"
              : "border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
          }`}
        >
          ✦ {annotating ? "explaining your code…" : "Re-explain changed"}
        </button>
        <button
          onClick={refresh}
          className="text-zinc-600 hover:text-zinc-300 transition-colors text-[13px]"
          title="Rescan project"
        >
          ⟳
        </button>
      </div>
      <div className="flex-1 min-h-0 relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-[12px] text-zinc-500">
            Mapping your code flow…
          </div>
        )}
        {!loading && !error && nodes.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-zinc-600">
            <p className="text-sm">No TypeScript/JavaScript files found</p>
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
          fitViewOptions={{ maxZoom: 0.9 }}
          minZoom={0.08}
          maxZoom={2.2}
          nodesConnectable={false}
          deleteKeyCode={null}
          onInit={(inst) => {
            rfRef.current = inst;
          }}
          onMove={(_, vp) => {
            const l = levelFor(vp.zoom);
            if (l !== levelRef.current) {
              levelRef.current = l;
              setLevel(l);
            }
          }}
        >
          {/* space mesh: a large grid behind a fine dot field */}
          <Background id="mesh" variant={BackgroundVariant.Lines} gap={140} color="#12121c" />
          <Background id="dots" variant={BackgroundVariant.Dots} gap={24} size={1} color="#1d1d28" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            maskColor="rgba(8,8,12,0.78)"
            nodeColor={(n) => (n.type === "boundary" ? "#15151f" : "#2d2d3a")}
          />
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
