use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FuncInfo {
    name: String,
    start_line: usize,
    end_line: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowFileNode {
    id: String,
    name: String,
    dir: String,
    lang: String,
    functions: Vec<FuncInfo>,
    loc: usize,
    role: String,
    purpose: String,
    ai: bool,
    inlet: bool,
    outlet: bool,
    uses: usize,
    used_by: usize,
}

#[derive(Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct FlowFileEdge {
    from: String,
    to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    from_fn: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    to_fn: Option<String>,
    kind: String, // "call" | "import"
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowGraph {
    nodes: Vec<FlowFileNode>,
    edges: Vec<FlowFileEdge>,
    truncated: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct MetaEntry {
    fp: String,
    purpose: String,
}

type MetaCache = HashMap<String, MetaEntry>;

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    "target",
    ".next",
    "out",
    "coverage",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
];
const EXTS: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs"];
const MAX_FILES: usize = 400;
const MAX_FUNCTIONS: usize = 12;
const MAX_ANNOTATE: usize = 150;
/// Files bigger than this are almost certainly generated/bundled, not hand-written source.
const MAX_FILE_BYTES: u64 = 400_000;

/// Walk the project respecting .gitignore (even without a .git dir), nested ignore
/// files, and a project-specific `.newgenignore` (same syntax). The hardcoded
/// SKIP_DIRS list remains as a baseline for projects with no ignore files at all.
fn collect(root: &Path) -> (Vec<PathBuf>, bool) {
    let mut files = Vec::new();
    let mut truncated = false;
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(true)
        .git_ignore(true)
        .git_exclude(true)
        .require_git(false)
        .follow_links(false)
        .add_custom_ignore_filename(".newgenignore")
        .sort_by_file_name(std::cmp::Ord::cmp)
        .filter_entry(|entry| {
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let name = entry.file_name().to_string_lossy();
            !(is_dir && SKIP_DIRS.contains(&name.as_ref()))
        });

    for entry in builder.build().flatten() {
        if files.len() >= MAX_FILES {
            truncated = true;
            break;
        }
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy();
        let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
            continue;
        };
        if !EXTS.contains(&ext)
            || name.ends_with(".d.ts")
            || name.ends_with(".min.js")
            || name.ends_with(".bundle.js")
        {
            continue;
        }
        if std::fs::metadata(path)
            .map(|m| m.len() > MAX_FILE_BYTES)
            .unwrap_or(false)
        {
            continue;
        }
        files.push(path.to_path_buf());
    }
    (files, truncated)
}

/// Top-level declarations (functions / arrow consts / classes) with their byte offsets.
fn parse_decls(content: &str) -> Vec<(usize, String)> {
    let re_function =
        Regex::new(r"(?m)^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)")
            .unwrap();
    let re_arrow = Regex::new(
        r"(?m)^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?(?:\([^)\n]*\)|[A-Za-z0-9_$]+)\s*(?::[^=\n]+)?=>",
    )
    .unwrap();
    let re_class =
        Regex::new(r"(?m)^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)")
            .unwrap();
    let mut decls: Vec<(usize, String)> = Vec::new();
    for re in [&re_function, &re_arrow, &re_class] {
        for cap in re.captures_iter(content) {
            decls.push((cap.get(0).unwrap().start(), cap[1].to_string()));
        }
    }
    decls.sort_by_key(|d| d.0);
    decls
}

/// Declarations with line spans — a function's span runs to the next declaration.
fn functions_of(decls: &[(usize, String)], content: &str) -> Vec<FuncInfo> {
    let line_of = |offset: usize| content[..offset.min(content.len())].matches('\n').count() + 1;
    let total_lines = content.lines().count().max(1);
    let mut out: Vec<FuncInfo> = Vec::new();
    for (i, (start, name)) in decls.iter().enumerate() {
        if out.iter().any(|f| f.name == *name) {
            continue;
        }
        let start_line = line_of(*start);
        let end_line = match decls.get(i + 1) {
            Some((next, _)) => line_of(*next).saturating_sub(1).max(start_line),
            None => total_lines,
        };
        out.push(FuncInfo {
            name: name.clone(),
            start_line,
            end_line,
        });
    }
    out
}

/// Which top-level declaration contains this byte offset (approximate: spans run
/// from one declaration to the next).
fn caller_of(decls: &[(usize, String)], offset: usize) -> Option<String> {
    let mut current = None;
    for (start, name) in decls {
        if *start <= offset {
            current = Some(name.clone());
        } else {
            break;
        }
    }
    current
}

/// Word-boundary occurrences of `name`, skipping import/re-export lines.
fn usage_offsets(content: &str, name: &str) -> Vec<usize> {
    let bytes = content.as_bytes();
    let is_ident = |c: u8| c.is_ascii_alphanumeric() || c == b'_' || c == b'$';
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(pos) = content[from..].find(name) {
        let abs = from + pos;
        let end = abs + name.len();
        let before_ok = abs == 0 || !is_ident(bytes[abs - 1]);
        let after_ok = end >= bytes.len() || !is_ident(bytes[end]);
        if before_ok && after_ok {
            let line_start = content[..abs].rfind('\n').map(|i| i + 1).unwrap_or(0);
            let line_end = content[line_start..]
                .find('\n')
                .map(|i| line_start + i)
                .unwrap_or(content.len());
            let line = content[line_start..line_end].trim_start();
            let is_import_line =
                line.starts_with("import") || (line.starts_with("export") && line.contains(" from "));
            if !is_import_line {
                out.push(abs);
            }
        }
        from = end;
    }
    out
}

/// Resolve a relative import spec against the set of scanned project files.
fn resolve_import(from_dir: &str, spec: &str, known: &HashSet<String>) -> Option<String> {
    if !spec.starts_with('.') {
        return None;
    }
    let mut parts: Vec<&str> = if from_dir.is_empty() {
        Vec::new()
    } else {
        from_dir.split('/').collect()
    };
    for seg in spec.split('/') {
        match seg {
            "." | "" => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    let base = parts.join("/");
    let mut candidates = vec![base.clone()];
    for ext in EXTS {
        candidates.push(format!("{base}.{ext}"));
    }
    for ext in ["ts", "tsx", "js", "jsx"] {
        candidates.push(format!("{base}/index.{ext}"));
    }
    candidates.into_iter().find(|c| known.contains(c))
}

fn fingerprint(path: &Path) -> String {
    match std::fs::metadata(path) {
        Ok(m) => {
            let mtime = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            format!("{}-{}", m.len(), mtime)
        }
        Err(_) => "0-0".into(),
    }
}

fn cache_path(project: &Path) -> PathBuf {
    project.join(".newgen").join("flowmeta.json")
}

fn load_cache(project: &Path) -> MetaCache {
    std::fs::read_to_string(cache_path(project))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

struct Signals {
    net: bool,
    server: bool,
    db: bool,
    state: bool,
    ui: bool,
    types_only: bool,
    listener: bool,
    fs_proc: bool,
}

fn detect_signals(content: &str, ext: &str, functions: &[FuncInfo]) -> Signals {
    let re_net =
        Regex::new(r"\b(fetch\s*\(|axios|XMLHttpRequest|WebSocket|http\.request|got\(|ky\.)").unwrap();
    let re_server = Regex::new(
        r"\b(app\.listen|createServer|express\s*\(\)|fastify|app\.(get|post|put|delete)\s*\(|router\.(get|post|put|delete)|new Hono|\.listen\s*\(\s*\d)",
    )
    .unwrap();
    let re_db = Regex::new(
        r"\b(prisma|mongoose|knex|sequelize|drizzle|sqlite|postgres|mysql|mongodb|supabase)",
    )
    .unwrap();
    let re_state = Regex::new(
        r"\b(createContext|useReducer|zustand|createStore|configureStore|redux|writable\(|atom\()",
    )
    .unwrap();
    let re_listener = Regex::new(r"\b(addEventListener|process\.stdin|process\.argv|ipcMain)").unwrap();
    let re_fs_proc =
        Regex::new(r"\b(fs\.|readFileSync|writeFileSync|child_process|spawn\(|execSync)").unwrap();
    let re_types = Regex::new(r"(?m)^\s*(?:export\s+)?(?:interface|type)\s+[A-Za-z]").unwrap();

    Signals {
        net: re_net.is_match(content),
        server: re_server.is_match(content),
        db: re_db.is_match(content),
        state: re_state.is_match(content),
        ui: matches!(ext, "tsx" | "jsx")
            || content.contains("from \"react\"")
            || content.contains("from 'react'"),
        types_only: functions.is_empty() && re_types.is_match(content),
        listener: re_listener.is_match(content),
        fs_proc: re_fs_proc.is_match(content),
    }
}

fn role_for(s: &Signals, name: &str, dir: &str, is_test: bool, used_by: usize, uses: usize) -> &'static str {
    let stem = name.split('.').next().unwrap_or(name).to_lowercase();
    let is_config = Regex::new(
        r"(vite|next|tailwind|webpack|rollup|babel|jest|vitest|eslint|prettier|postcss)\.config",
    )
    .unwrap()
    .is_match(name)
        || stem == "config";
    let entry_name = matches!(stem.as_str(), "main" | "index" | "app" | "server" | "cli")
        && (dir.is_empty() || dir == "src");

    if is_test {
        "test"
    } else if is_config {
        "config"
    } else if s.server {
        "port"
    } else if s.types_only {
        "types"
    } else if s.db {
        "data"
    } else if entry_name && uses > 0 {
        "entry"
    } else if used_by == 0 && uses >= 2 && !s.ui {
        "entry"
    } else if s.state {
        "state"
    } else if s.ui {
        "ui"
    } else if s.net {
        "network"
    } else {
        "util"
    }
}

/// Filename-based domain detection: auth.js should say "Authentication", not "Toolbox".
fn domain_for(stem: &str) -> Option<(&'static str, &'static str)> {
    const DOMAINS: &[(&[&str], &str, &str)] = &[
        (&["auth", "login", "session", "oauth", "jwt", "passport"], "Authentication", "who gets in and how identity is verified"),
        (&["pay", "billing", "stripe", "invoice", "checkout", "subscription"], "Payments", "money flows and billing logic"),
        (&["user", "account", "profile", "member"], "User accounts", "user data and account behavior"),
        (&["mail", "email", "notif", "sms", "push"], "Notifications", "messages sent out to people"),
        (&["db", "database", "repo", "storage", "model", "schema", "migration"], "Data layer", "how data is stored and fetched"),
        (&["route", "endpoint", "controller", "handler", "middleware"], "API surface", "endpoints the outside world calls"),
        (&["search", "filter", "query"], "Search", "finding and filtering things"),
        (&["cache"], "Caching", "remembered results for speed"),
        (&["log", "telemetry", "metric", "analytic", "track"], "Telemetry", "logs and measurements"),
        (&["upload", "media", "image", "asset"], "Files & media", "file and media handling"),
        (&["valid", "sanitiz"], "Validation", "checking inputs are safe and correct"),
        (&["chat", "message", "socket"], "Messaging", "conversation and realtime messages"),
        (&["cart", "order", "product", "inventory", "catalog"], "Commerce", "products, carts and orders"),
        (&["admin", "dashboard"], "Admin", "administrative controls"),
        (&["security", "crypto", "encrypt", "hash"], "Security", "protection and cryptography"),
        (&["i18n", "locale", "translat"], "Localization", "languages and regional formats"),
    ];
    let s = stem.to_lowercase();
    for (keys, title, desc) in DOMAINS {
        if keys.iter().any(|k| s.contains(k)) {
            return Some((title, desc));
        }
    }
    None
}

fn purpose_for(role: &str, stem: &str, functions: &[FuncInfo], used_by: usize) -> String {
    if let Some((title, desc)) = domain_for(stem) {
        return format!("{title} — {desc}");
    }
    match role {
        "entry" => "Ignition — boots the app and wires the parts together".into(),
        "port" => "Inlet — where the outside world enters (server / API)".into(),
        "ui" => {
            let comps: Vec<&str> = functions
                .iter()
                .filter(|f| f.name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false))
                .map(|f| f.name.as_str())
                .take(2)
                .collect();
            if comps.is_empty() {
                "UI — draws part of the interface".into()
            } else {
                format!("UI — draws {}", comps.join(" & "))
            }
        }
        "state" => "Memory — shared state many parts read & write".into(),
        "data" => "Storage — reads and writes persistent data".into(),
        "network" => "Outlet — reaches out to external services".into(),
        "types" => "Contracts — the shapes data must follow".into(),
        "config" => "Settings — tells the tooling how to behave".into(),
        "test" => "Safety net — automatically checks behavior".into(),
        _ => {
            if used_by >= 3 {
                format!("Toolbox — helpers {used_by} other blocks rely on")
            } else {
                "Toolbox — supporting helpers".into()
            }
        }
    }
}

struct ParsedFile {
    rel: String,
    name: String,
    dir: String,
    lang: String,
    functions: Vec<FuncInfo>,
    decls: Vec<(usize, String)>,
    loc: usize,
    signals: Signals,
    is_test: bool,
    /// (local name, exported name, resolved target file)
    named_imports: Vec<(String, String, String)>,
    /// every resolved import target, including bare/side-effect imports
    import_targets: HashSet<String>,
    content: String,
}

#[tauri::command]
pub async fn scan_project(path: String) -> Result<FlowGraph, String> {
    // Off the main thread — a large project scan must never stall the window.
    tauri::async_runtime::spawn_blocking(move || scan_project_inner(&path))
        .await
        .map_err(|e| e.to_string())?
}

fn scan_project_inner(path: &str) -> Result<FlowGraph, String> {
    let root = Path::new(path);
    let (files, truncated) = collect(root);

    let rels: Vec<String> = files
        .iter()
        .filter_map(|p| p.strip_prefix(root).ok())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .collect();
    let known: HashSet<String> = rels.iter().cloned().collect();

    let re_any_import =
        Regex::new(r#"(?m)^\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]"#).unwrap();
    let re_export_from =
        Regex::new(r#"(?m)^\s*export\s+(?:\*|\{[^}]*\})\s*from\s+['"]([^'"]+)['"]"#).unwrap();
    let re_require = Regex::new(r#"require\(\s*['"]([^'"]+)['"]\s*\)"#).unwrap();
    let re_dyn_import = Regex::new(r#"import\(\s*['"]([^'"]+)['"]\s*\)"#).unwrap();
    let re_named = Regex::new(
        r#"import\s+(?:type\s+)?(?:[A-Za-z0-9_$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]"#,
    )
    .unwrap();
    let re_default =
        Regex::new(r#"import\s+([A-Za-z0-9_$]+)\s*(?:,\s*\{[^}]*\})?\s+from\s+['"]([^'"]+)['"]"#)
            .unwrap();

    // Pass 1: parse every file.
    let mut parsed: Vec<ParsedFile> = Vec::new();
    for (file, rel) in files.iter().zip(rels.iter()) {
        let Ok(bytes) = std::fs::read(file) else {
            continue;
        };
        let content = String::from_utf8_lossy(&bytes).into_owned();

        let name = rel.rsplit('/').next().unwrap_or(rel).to_string();
        let dir = match rel.rfind('/') {
            Some(i) => rel[..i].to_string(),
            None => String::new(),
        };
        let ext = file
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or_default();
        let lang = if matches!(ext, "ts" | "tsx") { "ts" } else { "js" };
        let decls = parse_decls(&content);
        let functions = functions_of(&decls, &content);
        let signals = detect_signals(&content, ext, &functions);
        let is_test =
            name.contains(".test.") || name.contains(".spec.") || rel.contains("__tests__");

        let mut import_targets = HashSet::new();
        for re in [&re_any_import, &re_export_from, &re_require, &re_dyn_import] {
            for cap in re.captures_iter(&content) {
                if let Some(target) = resolve_import(&dir, &cap[1], &known) {
                    if target != *rel {
                        import_targets.insert(target);
                    }
                }
            }
        }

        let mut named_imports = Vec::new();
        for cap in re_named.captures_iter(&content) {
            let Some(target) = resolve_import(&dir, &cap[2], &known) else {
                continue;
            };
            if target == *rel {
                continue;
            }
            for spec in cap[1].split(',') {
                let spec = spec.trim().trim_start_matches("type ").trim();
                if spec.is_empty() {
                    continue;
                }
                let (exported, local) = match spec.split_once(" as ") {
                    Some((e, l)) => (e.trim().to_string(), l.trim().to_string()),
                    None => (spec.to_string(), spec.to_string()),
                };
                named_imports.push((local, exported, target.clone()));
            }
        }
        for cap in re_default.captures_iter(&content) {
            if let Some(target) = resolve_import(&dir, &cap[2], &known) {
                if target != *rel {
                    named_imports.push((cap[1].to_string(), "default".to_string(), target));
                }
            }
        }

        parsed.push(ParsedFile {
            rel: rel.clone(),
            name,
            dir,
            lang: lang.to_string(),
            functions,
            decls,
            loc: content.lines().count(),
            signals,
            is_test,
            named_imports,
            import_targets,
            content,
        });
    }

    let functions_by_file: HashMap<String, Vec<String>> = parsed
        .iter()
        .map(|p| (p.rel.clone(), p.functions.iter().map(|f| f.name.clone()).collect()))
        .collect();

    // Pass 2: function-level call edges — which function uses which imported symbol.
    let mut edges: Vec<FlowFileEdge> = Vec::new();
    let mut seen: HashSet<(String, Option<String>, String, Option<String>)> = HashSet::new();
    let mut pairs_with_calls: HashSet<(String, String)> = HashSet::new();

    for p in &parsed {
        for (local, exported, target) in &p.named_imports {
            let target_fns = functions_by_file.get(target);
            let to_fn = if exported == "default" {
                target_fns.and_then(|fns| fns.first().cloned())
            } else if target_fns.map(|fns| fns.contains(exported)).unwrap_or(false) {
                Some(exported.clone())
            } else {
                None
            };
            for offset in usage_offsets(&p.content, local) {
                let from_fn = caller_of(&p.decls, offset);
                let key = (p.rel.clone(), from_fn.clone(), target.clone(), to_fn.clone());
                if seen.insert(key) {
                    pairs_with_calls.insert((p.rel.clone(), target.clone()));
                    edges.push(FlowFileEdge {
                        from: p.rel.clone(),
                        to: target.clone(),
                        from_fn,
                        to_fn: to_fn.clone(),
                        kind: "call".into(),
                    });
                }
            }
        }

        // Intra-file call edges: which function uses which sibling function.
        let names: Vec<String> = p.functions.iter().map(|f| f.name.clone()).collect();
        for callee in &names {
            for offset in usage_offsets(&p.content, callee) {
                if let Some(caller) = caller_of(&p.decls, offset) {
                    if caller != *callee {
                        let key = (
                            p.rel.clone(),
                            Some(caller.clone()),
                            p.rel.clone(),
                            Some(callee.clone()),
                        );
                        if seen.insert(key) {
                            edges.push(FlowFileEdge {
                                from: p.rel.clone(),
                                to: p.rel.clone(),
                                from_fn: Some(caller),
                                to_fn: Some(callee.clone()),
                                kind: "call".into(),
                            });
                        }
                    }
                }
            }
        }
    }

    // Fallback: file-level import edges for pairs with no attributable calls.
    for p in &parsed {
        for target in &p.import_targets {
            if !pairs_with_calls.contains(&(p.rel.clone(), target.clone())) {
                edges.push(FlowFileEdge {
                    from: p.rel.clone(),
                    to: target.clone(),
                    from_fn: None,
                    to_fn: None,
                    kind: "import".into(),
                });
            }
        }
    }

    // Dependency counts from distinct file pairs.
    let mut uses: HashMap<&str, usize> = HashMap::new();
    let mut used_by: HashMap<&str, usize> = HashMap::new();
    for p in &parsed {
        uses.insert(p.rel.as_str(), p.import_targets.len());
        for target in &p.import_targets {
            *used_by.entry(target.as_str()).or_default() += 1;
        }
    }

    let cache = load_cache(root);

    let nodes = parsed
        .iter()
        .map(|p| {
            let n_uses = uses.get(p.rel.as_str()).copied().unwrap_or(0);
            let n_used_by = used_by.get(p.rel.as_str()).copied().unwrap_or(0);
            let role = role_for(&p.signals, &p.name, &p.dir, p.is_test, n_used_by, n_uses);
            let stem = p.name.split('.').next().unwrap_or(&p.name).to_string();
            let (purpose, ai) = match cache.get(&p.rel) {
                Some(entry) if entry.fp == fingerprint(&root.join(&p.rel)) => {
                    (entry.purpose.clone(), true)
                }
                _ => (purpose_for(role, &stem, &p.functions, n_used_by), false),
            };
            let mut functions = p.functions.clone();
            functions.truncate(MAX_FUNCTIONS);
            FlowFileNode {
                id: p.rel.clone(),
                name: p.name.clone(),
                dir: p.dir.clone(),
                lang: p.lang.clone(),
                functions,
                loc: p.loc,
                role: role.to_string(),
                purpose,
                ai,
                inlet: p.signals.server || p.signals.listener || role == "entry",
                outlet: p.signals.net || p.signals.db || p.signals.fs_proc,
                uses: n_uses,
                used_by: n_used_by,
            }
        })
        .collect();

    Ok(FlowGraph {
        nodes,
        edges,
        truncated,
    })
}

type Needs = Vec<(String, Vec<String>)>;

const ANNOTATE_CHUNK: usize = 30;

fn compute_needs(project: &str) -> Needs {
    let root = Path::new(project);
    let (files, _truncated) = collect(root);
    let cache = load_cache(root);
    let mut needs: Needs = Vec::new();
    for file in &files {
        let Ok(rel) = file.strip_prefix(root) else {
            continue;
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        let fp = fingerprint(file);
        if cache.get(&rel).map(|e| e.fp == fp).unwrap_or(false) {
            continue;
        }
        let Ok(bytes) = std::fs::read(file) else {
            continue;
        };
        let content = String::from_utf8_lossy(&bytes);
        let decls = parse_decls(&content);
        let mut functions: Vec<String> = functions_of(&decls, &content)
            .into_iter()
            .map(|f| f.name)
            .collect();
        functions.truncate(6);
        needs.push((rel, functions));
        if needs.len() >= MAX_ANNOTATE {
            break;
        }
    }
    needs
}

fn annotate_chunk(project: &str, chunk: &[(String, Vec<String>)]) -> Result<usize, String> {
    let root = Path::new(project);
    let mut prompt = String::from(
        "You are labeling blocks in a visual code map for engineers.\n\
         For each file below, write ONE phrase (max 10 words) describing what the file exists FOR \
         at a high level — its role in the machine — not the language constructs it contains.\n\
         Good examples: \"boots the app and opens the main window\", \"the public HTTP inlet — requests enter here\", \
         \"draws the flow canvas\", \"talks to the Stripe API\".\n\
         Reply with ONLY a raw JSON object mapping each path to its phrase. No markdown fences, no commentary.\n\nFiles:\n",
    );
    for (rel, fns) in chunk {
        if fns.is_empty() {
            prompt.push_str(&format!("- {rel}\n"));
        } else {
            prompt.push_str(&format!("- {rel} (functions: {})\n", fns.join(", ")));
        }
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let output = Command::new(&shell)
        .arg("-lc")
        .arg("claude -p \"$NEWGEN_PROMPT\" --output-format json")
        .current_dir(root)
        .env("NEWGEN_PROMPT", &prompt)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "claude failed: {}",
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(400)
                .collect::<String>()
        ));
    }

    let envelope: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("bad claude output: {e}"))?;
    let mut result = envelope["result"].as_str().unwrap_or_default().trim().to_string();
    if result.starts_with("```") {
        result = result
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
            .to_string();
    }
    let purposes: HashMap<String, String> =
        serde_json::from_str(&result).map_err(|e| format!("could not parse annotations: {e}"))?;

    // Re-load and merge per chunk so partial progress is durable immediately.
    let mut cache = load_cache(root);
    let mut updated = 0;
    for (rel, _) in chunk {
        if let Some(purpose) = purposes.get(rel) {
            cache.insert(
                rel.clone(),
                MetaEntry {
                    fp: fingerprint(&root.join(rel)),
                    purpose: purpose.clone(),
                },
            );
            updated += 1;
        }
    }
    let dir = root.join(".newgen");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(
        cache_path(root),
        serde_json::to_string_pretty(&cache).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(updated)
}

/// Fire-and-forget: returns immediately with how many blocks were queued.
/// A background thread annotates in chunks and reports via events
/// (flow-annotate-progress / flow-annotate-done / flow-annotate-error),
/// so the window never lags while the LLM thinks.
#[tauri::command]
pub async fn flow_annotate(app: AppHandle, project: String) -> Result<usize, String> {
    let needs = {
        let project = project.clone();
        tauri::async_runtime::spawn_blocking(move || compute_needs(&project))
            .await
            .map_err(|e| e.to_string())?
    };
    let total = needs.len();
    if total == 0 {
        return Ok(0);
    }
    std::thread::spawn(move || {
        let mut done = 0usize;
        for chunk in needs.chunks(ANNOTATE_CHUNK) {
            match annotate_chunk(&project, chunk) {
                Ok(_) => {
                    done += chunk.len();
                    let _ = app.emit(
                        "flow-annotate-progress",
                        serde_json::json!({ "done": done, "total": total }),
                    );
                }
                Err(e) => {
                    let _ = app.emit("flow-annotate-error", e);
                    return;
                }
            }
        }
        let _ = app.emit("flow-annotate-done", total);
    });
    Ok(total)
}
