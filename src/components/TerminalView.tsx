import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

interface Props {
  id: string;
  cwd: string;
  command?: string;
  visible: boolean;
}

export function TerminalView({ id, cwd, command, visible }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const term = new Terminal({
      fontSize: 12,
      fontFamily: '"SF Mono", Menlo, monospace',
      cursorBlink: true,
      scrollback: 8000,
      macOptionIsMeta: true,
      theme: {
        background: "#0c0c10",
        foreground: "#c9c9d4",
        cursor: "#7c5cff",
        selectionBackground: "#2d2b55",
        black: "#1a1a21",
        red: "#ef6b73",
        green: "#8bd49c",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#d7d7e0",
        brightBlack: "#52525e",
        brightRed: "#f28b92",
        brightGreen: "#a4e0b2",
        brightYellow: "#edd0a0",
        brightBlue: "#84c2f5",
        brightMagenta: "#d99ae8",
        brightCyan: "#7fd1da",
        brightWhite: "#f4f4f8",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL unavailable — xterm falls back to the DOM renderer.
    }

    const unlisteners: UnlistenFn[] = [];
    let disposed = false;

    const boot = async () => {
      unlisteners.push(await listen<string>(`pty-output-${id}`, (e) => term.write(e.payload)));
      unlisteners.push(
        await listen(`pty-exit-${id}`, () => term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n")),
      );
      if (disposed) return;
      if (el.clientWidth > 0 && el.clientHeight > 0) fit.fit();
      await invoke("pty_spawn", {
        id,
        cwd,
        command: command ?? null,
        cols: term.cols,
        rows: term.rows,
      }).catch((err) => term.write(`\r\nfailed to start: ${err}\r\n`));
    };
    void boot();

    const dataSub = term.onData((d) => void invoke("pty_write", { id, data: d }).catch(() => {}));

    const ro = new ResizeObserver(() => {
      if (!el.clientWidth || !el.clientHeight) return;
      fit.fit();
      void invoke("pty_resize", { id, cols: term.cols, rows: term.rows }).catch(() => {});
    });
    ro.observe(el);

    return () => {
      disposed = true;
      ro.disconnect();
      dataSub.dispose();
      unlisteners.forEach((u) => u());
      void invoke("pty_kill", { id }).catch(() => {});
      term.dispose();
    };
  }, [id, cwd, command]);

  return <div ref={ref} className={`absolute inset-0 pl-2 pt-1 ${visible ? "" : "hidden"}`} />;
}
