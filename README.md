# NewGen Editor

An AI-native code editor for macOS — see your code as a living flow, trust it by behavior instead of reading every line. See [PLAN.md](./PLAN.md) for the full product & technical plan.

**Status: M0 (shell)** — Tauri app with file explorer, Monaco editor, multi-tab terminal (xterm.js + portable-pty), an embedded **Claude Code** terminal tab, and the first-run persona question (Engineer / Builder lens).

## Develop

```bash
npm install
npm run tauri dev
```

## Build a DMG

```bash
npm run tauri build
```

## Layout

- `src/` — React UI (explorer, editor, terminals, persona lens)
- `src-tauri/` — Rust core (fs commands, PTY manager, profile storage)
- `scripts/gen_icon.py` — regenerates the placeholder app icon (`python3 scripts/gen_icon.py && npm run tauri icon app-icon.png`)
