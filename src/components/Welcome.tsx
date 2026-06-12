export function Welcome({ onOpenProject }: { onOpenProject: () => void }) {
  return (
    <div className="h-screen flex flex-col bg-[#0c0c10] text-zinc-300 overflow-hidden">
      <div data-tauri-drag-region className="h-10 shrink-0" />
      <div className="flex-1 flex flex-col items-center justify-center gap-5 select-none">
        <div className="size-16 rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-cyan-400 shadow-[0_0_60px_rgba(124,92,255,0.35)]" />
        <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
          NewGen Editor
        </h1>
        <p className="text-zinc-500 text-sm max-w-md text-center leading-relaxed">
          See your code as a living flow. Trust it by behavior, not by reading every line.
        </p>
        <button
          onClick={onOpenProject}
          className="mt-3 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500 text-white text-sm font-medium shadow-lg shadow-violet-900/40 hover:brightness-110 active:scale-[0.98] transition"
        >
          Open a project folder
        </button>
        <div className="flex gap-2 mt-5 text-[11px] text-zinc-600">
          <span className="px-2.5 py-1 rounded-full border border-zinc-800">✦ Claude inside</span>
          <span className="px-2.5 py-1 rounded-full border border-zinc-800">Flow View · M2</span>
          <span className="px-2.5 py-1 rounded-full border border-zinc-800">Contracts · M4</span>
        </div>
      </div>
      <div className="h-8 shrink-0 flex items-center justify-center text-[10px] text-zinc-700">
        v0.1.0 · M0 shell
      </div>
    </div>
  );
}
