import type { Persona } from "../types";

interface Props {
  current: Persona | null;
  dismissable: boolean;
  onPick: (p: Persona) => void;
  onClose: () => void;
}

export function PersonaModal({ current, dismissable, onPick, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm select-none">
      <div className="w-[600px] rounded-2xl border border-zinc-800 bg-[#101015] p-7 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">How do you want to see this project?</h2>
            <p className="text-[13px] text-zinc-500 mt-1 leading-relaxed">
              This sets the abstraction lens of the viewer. The layout — terminal, files, plugins — never
              changes. Switch anytime from the top bar.
            </p>
          </div>
          {dismissable && (
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-xl leading-none ml-4">
              ×
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 mt-6">
          <button
            onClick={() => onPick("engineer")}
            className={`text-left rounded-xl border p-5 transition-all hover:-translate-y-0.5 ${
              current === "engineer"
                ? "border-violet-500/60 bg-violet-500/10"
                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
            }`}
          >
            <div className="text-2xl">🛠</div>
            <div className="mt-3 font-medium text-zinc-100 text-[14px]">I read code</div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-500">
              Engineer lens — functions, call edges, and how everything is stitched together. Contracts shown
              as raw input → output.
            </p>
          </button>
          <button
            onClick={() => onPick("builder")}
            className={`text-left rounded-xl border p-5 transition-all hover:-translate-y-0.5 ${
              current === "builder"
                ? "border-cyan-500/60 bg-cyan-500/10"
                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
            }`}
          >
            <div className="text-2xl">🧭</div>
            <div className="mt-3 font-medium text-zinc-100 text-[14px]">I don't read code</div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-500">
              Builder lens — business logic only. Does the code fulfill your request, and did anything extra
              happen? (Full lens lands in M5.)
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
