import type { Persona } from "../types";

interface Props {
  persona: Persona | null;
  activePath: string | null;
  projectPath: string;
}

export function StatusBar({ persona, activePath, projectPath }: Props) {
  const rel =
    activePath && activePath.startsWith(projectPath)
      ? activePath.slice(projectPath.length + 1)
      : activePath;

  return (
    <div className="h-6 shrink-0 flex items-center gap-3 px-3 text-[11px] text-zinc-500 border-t border-zinc-800/60 bg-[#101015] select-none">
      <span className={persona === "builder" ? "text-cyan-400" : "text-violet-400"}>
        {persona === "builder" ? "🧭 Builder lens" : "🛠 Engineer lens"}
      </span>
      <span className="truncate">{rel ?? "—"}</span>
      <div className="flex-1" />
      <span className="text-zinc-700">NewGen v0.1.0 · M0</span>
    </div>
  );
}
