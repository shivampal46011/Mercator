# NewGen Editor — Product & Technical Plan (v0.3)

> **Decisions locked (2026-06-12):** Tauri app shell · classic editor as default view (Flow View as a first-class tab) · sidecar contract files · DMG + auto-update distribution · persona question at first launch sets the abstraction lens · Terraform as the IaC engine behind infra bricks.

> An AI-native code editor where you supervise code by **flow and behavior**, not by reading every line. Built for the era where AI writes most of the code and humans need to *see* what it did.

---

## 1. The Core Idea (why this editor exists)

Today's editors were designed for humans typing code. With AI generating code:

1. **Unrequested changes get buried.** AI adds extra helpers, renames things, touches files you didn't ask about — and it all disappears into a text diff.
2. **Review fatigue is real.** You can't micro-read every generation. You need a *glance-level* understanding: "what did it do, and how did the flow change?"
3. **Trust should come from behavior, not reading.** If a function takes X and returns Y as expected, you don't need to read its body every time.

NewGen Editor answers with three pillars:

| Pillar | What it means |
|---|---|
| **Flow View** | The code is rendered as a live graph of functions/modules and their call + data flow. Text is secondary. |
| **Change Digest** | Every AI edit produces a visual "what changed" summary — flow diff, new nodes, removed edges, flagged extras. |
| **Contract Testing** | Each function carries input→output contracts. After every AI edit, contracts re-run automatically. Green node = trusted, no reading needed. |
| **Abstraction Dial** | The viewer adapts to who's looking: engineers see functions and how they're stitched; non-coders see business logic and whether the code fulfills it. Same layout (terminal, plugins, explorer all stay) — only the lens changes. |

---

## 2. Feature Set — Version 1

### 2.1 Flow View (the centerpiece)
- **Placement (decided, revised after M0):** Flow View is the **landing view** when a project opens — the canvas is the product's identity. Code view (Monaco) is one keystroke away (`⌘G`); the Claude chat panel is pre-opened on the right. The flow diff auto-surfaces here after every AI turn.
- Parse the codebase into a graph: functions, modules, call edges, import edges.
- Interactive canvas: zoom from architecture level → module level → function level → (only then) actual code.
- Click a node to open its code in a side panel — code is *on demand* inside this view.
- **Flow Diff:** after any edit (AI or human), changed nodes glow, new nodes pulse in, removed nodes fade out. A timeline scrubber replays how the flow evolved across AI turns.

### 2.2 AI Change Digest
- After each Claude Code turn, the editor computes a semantic diff (not a text diff):
  - Functions added / modified / removed
  - New dependencies installed
  - Files touched **outside the scope of the request** → flagged as "unrequested extras"
  - New side effects detected (network calls, fs writes, env reads)
- Presented as a card stack: *"What I asked"* vs *"What it did"*.
- In **Builder mode** (§2.11) the digest renders in plain business language: "Your request: ✓ fulfilled / ✗ not fulfilled — and here is anything *extra* that happened to the code."

### 2.3 The Contract Standard (decided 2026-06-12)

The communication protocol between **human** (reads it), **agent** (must write to it), and **validator** (a deterministic program — never an LLM — that checks it). This is what makes "trust without reading" engineerable.

**The artifact** — every *exported* symbol carries an in-code `@contract` comment:

```ts
/** @contract
 *  for: resolves a relative import to a real project file
 *  in:  fromDir (string), spec (string)
 *  out: resolved path, or null if it's an external package
 *  deps: lib/paths#normalize
 *  effects: none
 *  ok: resolve("src/lib", "./ipc") => "src/lib/ipc.ts"
 *  ok: resolve("src", "react") => null
 */
export function resolve(fromDir: string, spec: string): string | null {
```

Reading the block IS reading the function. The validator extracts all blocks into a machine index (`.newgen/contracts.json`) that Flow View renders — blocks show the `for:` line with a validation badge.

**Coverage rule:** exported symbols only. Internal helpers are free — no annotation noise on 3-line functions.

**Direction rule:** `deps` declares *intended* dependencies; "used by" is always **derived** from real imports, never hand-written. The diff between declared and actual is the violation report:
- actual import not declared → 🚩 **undeclared dependency** — the "AI did something extra" detector, as a program instead of a reviewer's eyes
- declared but unused → stale contract

**Two-tier proof:**
1. *Understanding layer* — inline `ok: input => output` examples. Job: human comprehension + quick "matches my assumption" check. Executed on every AI turn. Side-effectful code declares `effects:` (network/fs/db — statically verified) instead of pretending to be pure.
2. *Back-testing layer* — a durable regression suite that accumulates corner cases over time, protecting what was already validated against breakage by future changes. The validator **auto-syncs every inline `ok:` into the regression suite** (no double bookkeeping); corner cases get appended to the suite without cluttering the readable contract; **every bug fix must add a regression case** (machine-checkable rule: a fix turn must touch the suite).

**The validator (deterministic, in the Rust core + Node sidecar for execution):**
1. Coverage — every exported symbol has a contract
2. Dependency diff — declared `deps` vs actual imports (both directions)
3. Signature — `in:`/`out:` vs the actual TS signature
4. Effects — declared `effects:` vs detected signals (network/fs/db/process)
5. Examples — execute every `ok:` line, compare output
6. Regression discipline — bug-fix turns must extend the suite

**Enforcement (decided): gate + auto-fix loop.** After every AI turn the fast layer runs (structure + impacted `ok:` examples); violations are auto-fed back to the agent (max 2 retries), then surrendered to the human with red badges on the affected Flow View blocks. Non-conforming code never silently lands. The standard itself lives in the project's `CLAUDE.md`, so every embedded chat turn inherits it.

**Back-testing cadence (decided):** per AI turn, run only the regression tests of touched modules **plus their dependents** (the dependency graph tells us the blast radius); the **full suite is the Netlify deploy gate**.

v1 scope: JavaScript/TypeScript only.

### 2.4 Embedded Claude Code Terminal
- A real PTY running the `claude` CLI inside the editor — full Claude Code, not a chat clone.
- **Hooks integration:** Claude Code hooks (PostToolUse on Edit/Write) notify the editor the moment AI touches a file → Flow Diff and contracts update live, mid-generation.
- The editor can also drive Claude Code programmatically later via the Claude Agent SDK (phase 2).
- **The editor is itself an MCP server.** The embedded Claude Code auto-connects to it and gains UI tools (`highlight_nodes`, `open_file`, `focus_table`, `show_diff`, …). This is the mechanism behind AI-driven highlighting (§2.13) — one protocol surface, many UI capabilities.

### 2.5 Architecture Planning Section
- A canvas tab for sketching system architecture: AWS service shapes (Lambda, S3, API Gateway, RDS, etc.), arrows, notes.
- v1 = drawing + saving (file-based, lives in the repo as JSON so it's versioned with the code) — **plus database bricks go live** via Terraform (§2.12).
- Coming soon (not v1): live provisioning for the full AWS catalog, drift detection.

### 2.6 Deployment — Netlify
- Detect/install Netlify CLI, link a site, `netlify deploy` from a button.
- Deploy gate: contracts must pass before deploy (overridable).
- Deploy logs stream into the Logs panel.

### 2.7 Terminal & Logs
- General-purpose terminal panel (multiple tabs, same PTY infra as the Claude terminal).
- Logs panel: structured view of app output, build output, deploy output — filterable, with timestamps.

### 2.8 File Explorer
- Standard tree, but with flow-awareness: hovering a file highlights its nodes in the Flow View.

### 2.9 Git
- Clone, status, stage, commit, branch, merge, push/pull, history.
- Git is also the backbone of the Change Digest (each AI turn = a shadow commit/checkpoint, so any AI turn can be reverted with one click).

### 2.10 Plugin System (VS Code-style, minimal v1)
- Manifest (`plugin.json`) + JS API, loaded in a sandboxed plugin runtime (see §3 — custom-built in Tauri, so the v1 API stays deliberately small).
- v1 contribution points: **commands**, **side panels**, **flow-node decorators** (let plugins paint info onto graph nodes — this is our unique extension surface that VS Code doesn't have).
- Language support, themes, debug adapters → phase 2.

### 2.11 Abstraction Modes (Engineer / Builder)
- **First launch asks one question:** "Do you read code?" The answer sets the default lens; it's changeable anytime (per project), and it **never changes the layout** — explorer, terminal, plugins, logs all stay. Only the viewer section changes.
- **Engineer mode:** Flow View at the function level — what's stitched to what, call edges, contracts as raw input→output, code panels on demand.
- **Builder mode (non-coder):** the viewer speaks business logic:
  - The graph shows *capabilities* ("User signup", "Send invoice email"), not functions.
  - The Change Digest answers exactly two questions: *Does the code fulfill your business request?* and *Did anything beyond that happen?*
  - Contracts surface as plain-language acceptance checks ("Signing up with a valid email creates an account") that compile down to the same function contracts underneath — one test system, two languages.
- Powered by an AI-maintained **feature map** (`.newgen/features.json`): a mapping from business capabilities → clusters of functions/files, rebuilt incrementally as the code changes.

### 2.12 Infra Bricks — Lego-Style Database & Deploy Automation
The repetitive loop this kills: *choose a database → connect it → configure deployment* — every project, every time.
- **Bricks on the architecture canvas are live.** Drag a "Postgres" brick onto the canvas → the editor generates a Terraform module under `.newgen/infra/`, provisions it on AWS, and wires the connection string into the app's env (locally and into Netlify env vars). Zero console-clicking.
- **Terraform is the engine** (the tool classically paired with Ansible: Terraform provisions the cloud resources, Ansible-style config is not needed for managed services). All generated IaC is committed to the repo — inspectable, versioned, never a black box.
- **Database Explorer panel:** see tables and schemas, sample rows, and **which code uses which table** (cross-linked with the call graph — click a table, the functions that read/write it light up in Flow View, and vice versa).
- **Ask the AI about your data:** natural-language questions in the Claude terminal ("which tables are unused?", "show me everyone who signed up this week") — answered via the editor's MCP tools with read-only DB access by default.
- v1 scope: **two bricks only** — PostgreSQL (RDS) and DynamoDB. Each brick is real work (Terraform module + connection wiring + explorer support), so the catalog grows brick by brick.

### 2.13 AI-Driven UI Highlighting
- Ask "where does login happen?" and the AI doesn't just answer in text — it **highlights the components**: nodes glow in Flow View, files pulse in the explorer, relevant lines flash in the editor, tables light up in the Database Explorer.
- Mechanism: the editor's MCP server (§2.4) exposes `highlight_nodes`, `open_file`, `focus_table`, `scrub_timeline` etc. as tools to the embedded Claude Code.
- Works in both abstraction modes: Engineer mode highlights functions; Builder mode highlights capabilities.

### Explicitly NOT in v1
- ❌ Debugger ("coming soon" badge in UI)
- ❌ Multi-language flow parsing (TS/JS first; Python next)
- ❌ Windows/Linux builds
- ❌ Live provisioning for the full AWS catalog (v1 bricks = the two databases only; everything else on the canvas is draw-only)
- ❌ Write access for AI database queries (read-only in v1)

---

## 3. Tech Stack (recommendation)

**Decision: Tauri** (chosen over Electron). Lighter, faster, smaller bundle (~15MB vs ~200MB), Rust core — fits the "new gen" identity. Trade-off accepted: the embedded PTY and the plugin sandbox need more custom work than they would in Electron; the plan below accounts for that.

| Layer | Choice | Why |
|---|---|---|
| App shell | **Tauri 2.x** (Rust core + system WebView) | Tiny bundle, native performance, first-class auto-updater (`tauri-plugin-updater`) for the DMG + auto-update distribution. |
| UI | **React + TypeScript + Tailwind** (in the WebView) | Fast iteration on a custom, polished UI. |
| Code editor component | **Monaco** (or CodeMirror 6 if WebView perf demands it) | Both are plain web components — they run in Tauri's WebView fine. Start with Monaco for features; benchmark early. |
| Flow graph | **React Flow** + **elkjs** (auto-layout) | React Flow for interaction/animation, ELK for clean hierarchical layouts of call graphs. |
| Parsing / call graph | **tree-sitter via native Rust bindings** | A genuine Tauri win: tree-sitter is Rust-native, so parsing/graph extraction runs in the core at full speed — no worker-process plumbing. |
| Terminal (Claude + general) | **xterm.js** frontend + **portable-pty** (Rust crate) backend | Replaces node-pty. PTY sessions live in the Rust core, streamed to xterm.js over Tauri events. Custom work, well-trodden in the Tauri ecosystem. |
| Git | **git2-rs** (libgit2) for status/graph + shell out to system `git` for clone/push (auth) | Fast in-process reads; full-fidelity network operations. |
| Contract runner | **Sidecar Node process** (Tauri sidecar), vitest-like harness | Contracts for JS/TS must run on a JS runtime; Tauri's sidecar mechanism bundles/manages it cleanly. |
| Plugin host | **Sandboxed JS via embedded runtime** (QuickJS/Deno-core in Rust) or sandboxed iframe + postMessage API | No Node extension host in Tauri — this is the biggest custom build. v1 keeps the API surface deliberately small to compensate. |
| Persistence | Files in-repo (contracts, architecture diagrams, editor state in `.newgen/`) | Everything versions with the project. |
| Packaging | Tauri bundler → notarized universal DMG (arm64 + x64) + `tauri-plugin-updater` | Matches the chosen distribution model. |

**Process architecture:**

```
┌──────────────────────────────────────────────────┐
│ Rust core (Tauri)                                │
│  fs / git (git2) / PTY mgr (portable-pty) /      │
│  tree-sitter parser + call-graph / updater       │
└────┬──────────────────┬──────────────┬───────────┘
     │ Tauri IPC/events │ sandbox API  │ sidecar
┌────▼─────────┐  ┌─────▼──────┐  ┌────▼──────────┐
│ WebView (UI) │  │ Plugin     │  │ Node sidecar  │
│ React        │  │ runtime    │  │ • contract    │
│ FlowView tab │  │ (QuickJS / │  │   runner      │
│ Monaco       │  │  iframe)   │  │ • TS resolver │
│ Terminals    │  │            │  │   (tsc API)   │
└──────────────┘  └────────────┘  └───────────────┘
```

**Tauri-specific risks to watch:**
1. PTY fidelity — Claude Code is a rich TUI; verify rendering/keybindings in xterm.js-over-Tauri *first* (M1 is the riskiest milestone now).
2. WebView memory ceilings with Monaco + React Flow + multiple xterm instances on large repos — benchmark at M2.
3. Plugin sandbox is fully custom — keep v1 API tiny (commands, panels, node decorators) and version it from day one.

---

## 4. Build Order (suggested milestones)

1. **M0 – Shell:** Tauri app, file explorer, Monaco editor, terminal panel (xterm.js + portable-pty), first-run persona question (stored in `.newgen/profile.json`). (A working basic editor.)
2. **M1 – Claude inside:** Embedded Claude Code PTY + hooks wiring + the editor's MCP server with its first tools (`highlight_nodes`, `open_file`) → AI-driven highlighting lands early because it rides the same wiring. **De-risk first:** validate Claude Code's TUI renders correctly in xterm.js-over-Tauri before building anything on top.
3. **M2 – Flow View:** tree-sitter parsing → call graph → React Flow canvas with zoom levels.
4. **M3 – Flow Diff + Change Digest:** checkpoint per AI turn, semantic diff, unrequested-extras flags, one-click revert.
5. **M4 – Contract Standard:** `@contract` parser + extraction index, validator (coverage / dependency diff / signature / effects / examples), gate + auto-fix loop wired into the chat panel, regression-suite sync, badges on Flow View blocks.
6. **M5 – Builder mode:** AI-maintained feature map, capability-level graph lens, plain-language digest, acceptance checks compiling to contracts.
7. **M6 – Git UI + Netlify deploy** (with contracts-pass gate) + Logs panel.
8. **M7 – Architecture canvas + Infra bricks:** draw-only canvas for everything, live Terraform provisioning + Database Explorer for the two v1 database bricks.
9. **M8 – Plugin system v1** + polish + packaging/notarization.

Rationale: M1 before M2 because the Claude integration generates the *events* the whole visual system reacts to; building Flow View against live AI edits keeps it honest. Builder mode (M5) comes after the digest and contracts exist, because it is a *lens over them*, not a separate system.

---

## 5. Suggestions for Review (my additions — accept/reject freely)

1. **AI turn = checkpoint.** Every Claude Code turn auto-creates a shadow git checkpoint. The timeline scrubber + one-click revert falls out of this almost for free, and it's the safety net that makes "don't read the code" psychologically acceptable.
2. **"Unrequested extras" detector** as a headline feature. Compare the user's prompt scope (files/functions mentioned or focused) vs. what was actually touched. This directly attacks the "AI did extra stuff and I missed it" pain you described — I'd market the editor on this.
3. **Record-to-contract.** Instead of hand-writing contracts, run the app once and *record* real inputs/outputs of functions, then promote recordings to contracts with one click. Massively lowers the contract-writing cost.
4. **Side-effect badges on nodes.** Static analysis marks nodes that do network/fs/env access. A pure green node with passing contracts = safe to never read. A node with a 🌐 badge = look closer. Gives the "glance" trust model real teeth.
5. **Contracts as the deploy gate** (mentioned above) — turns the testing pillar into a workflow, not just a feature.
6. **Start TS/JS-only and say so loudly.** Flow parsing + contract running per language is the expensive part. One language done excellently beats three done poorly. Python is the obvious second.
7. **Flow-node decorators as the signature plugin API.** Every editor has commands and panels; nobody has "paint your data onto the code graph" (coverage, perf, security findings, ownership). It makes plugins feel native to *this* editor's worldview.
8. **Names to consider:** FlowDeck, Glance, Vouch, Atlas, Trellis. (The contract idea also suggests "Covenant"-style names.)
9. **Defer:** real-time collaboration, Windows/Linux, marketplace hosting for plugins (sideload only in v1), the debugger (as you said).
10. **Make it a dial, not a binary.** The startup question sets the *default*, but the lens should be a zoom control with three stops — Business → Module → Function. An engineer having a high-level day stays at Business; a curious founder can peek one level down. Cheap to build once both lenses exist.
11. **The feature map earns its keep twice.** Besides powering Builder mode, it sharpens the unrequested-extras detector: "this change doesn't belong to any capability you asked about" is a stronger, business-meaningful flag than "file outside prompt scope."
12. **Acceptance checks = the non-coder's contracts.** Builder-mode users write "signing up with a valid email creates an account"; AI compiles it to function contracts underneath. One test system, two languages — don't build a separate BDD engine.
13. **Guardrails on live infra:** every brick action shows a cost estimate + the generated Terraform before applying; a "destroy" requires typing the resource name. AI database access is read-only in v1. These are the trust features that make Lego-infra safe enough to ship.
14. **Highlight-as-you-talk.** Since the AI can highlight components (§2.13), have it highlight *while explaining* — each sentence in its answer lights up the nodes it's talking about, like a presenter pointing at slides. Very "new gen", nearly free once the MCP tools exist.

## 6. Decisions Log & Remaining Questions

**Decided (2026-06-12):**
1. ~~Electron vs Tauri~~ → **Tauri** (lighter, faster, "new gen" feel; accepted extra work on PTY + plugin sandbox).
2. ~~Contract storage~~ → ~~Sidecar JSON files~~ → **REVISED (2026-06-12): in-code `@contract` comments are the source of truth** (the agent can't edit code without the contract in view); the validator extracts a machine index into `.newgen/contracts.json`. Full standard in §2.3.
3. ~~Default view~~ → ~~Classic editor first~~ → **REVERSED after seeing M0 (2026-06-12): Flow View is the landing view** (eraser.io/Railway-style block canvas), Code view one keystroke away (⌘G). The **Claude chat panel is pre-opened** on the right when a project opens — the AI and the visual canvas are the product's identity and must be visible immediately.
4. ~~Distribution~~ → **Notarized DMG + auto-update** (`tauri-plugin-updater`).
5. ~~Persona question at first launch~~ → **DEFERRED (2026-06-12): v1 targets engineers only** — the goal is faster development for people who read code. The Builder lens and its first-run question move to post-v1. Flow View blocks instead carry **semantic roles** (Ignition / Inlet / Outlet / UI / Memory / Storage / Toolbox) + in/out badges + dependency counts, with optional AI-written one-line purposes (cached in `.newgen/flowmeta.json`).
6. **Terraform** is the IaC engine behind infra bricks (provisions AWS resources declaratively; generated `.tf` committed to the repo).
7. **Contract coverage** → exported symbols only; internal helpers exempt.
8. **Two-tier proof** → inline `ok:` examples (understanding + fast check) auto-synced into a durable regression suite (back-testing, corner cases); every bug fix must add a regression case.
9. **Enforcement** → gate + auto-fix loop (max 2 agent retries, then red badges); regression runs impacted-modules-only per turn, full suite gates deploy.
10. **Alignment shipped (2026-06-12):** every chat-spawned agent receives the contract standard via `--append-system-prompt` on every turn; `CLAUDE.md` is auto-created in projects lacking one (existing CLAUDE.md left untouched); **manual code editing is locked by default** — code enters the codebase only through the aligned agent channel (Settings → Editing policy to unlock). The deterministic validator (M4) is the remaining enforcement piece.

**Still open:**
1. Plugin API runtime: sandboxed iframe + postMessage (simplest) vs embedded QuickJS/Deno-core in Rust (tighter integration). Decide at M8, prototype both cheaply.
2. Monaco vs CodeMirror 6 in Tauri's WebView — benchmark at M0 on a large file/repo before committing.
3. Database bricks v1: confirmed Postgres + DynamoDB? And Postgres flavor — AWS RDS matches the AWS story but is slow/costly for dev; a managed option (Neon/Supabase) is faster to provision. Could ship RDS for "production" and Neon for "dev" within the same brick.
4. AWS credentials UX for bricks: local AWS profile (simplest, v1 recommendation) vs in-app guided setup.
5. Editor name (candidates in §5.8).
