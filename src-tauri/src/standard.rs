/// The NewGen Contract Standard — injected into every chat-spawned agent turn via
/// --append-system-prompt, and written to CLAUDE.md so terminal sessions inherit it too.
pub const CONTRACT_STANDARD: &str = r#"# NewGen Contract Standard

This project is edited through NewGen Editor. ALL code you write or modify MUST follow this standard — it is what keeps the codebase predictable and the visual code map truthful.

## The @contract comment

Every EXPORTED function, class, or service carries a `@contract` comment directly above it:

```ts
/** @contract
 *  for: resolves a relative import to a real project file
 *  in:  fromDir (string), spec (string)
 *  out: resolved path, or null if it's an external package
 *  deps: lib/paths#normalize
 *  effects: none
 *  ok: resolve("src/lib", "./ipc") => "src/lib/ipc.ts"
 */
export function resolve(fromDir: string, spec: string): string | null {
```

Fields:
- `for:` what this exists FOR in the machine — one phrase, max 12 words. High-level and honest, not a restatement of the code.
- `in:` inputs with types, or `none`.
- `out:` what it returns, or `nothing`.
- `deps:` project files/symbols this intentionally depends on, comma-separated, or `none`.
- `effects:` `none`, or every category it touches: `network`, `fs`, `db`, `process`.
- `ok:` at least one runnable example `call => expected result` for pure functions. Side-effectful code declares `effects:` instead of pretending to be pure.

## Rules

1. Exported symbols only — internal helpers need no contract.
2. When you EDIT a function, update its `@contract` in the same edit. A stale contract is a bug.
3. Never add an import without reflecting it in `deps:` of the symbols that use it.
4. When you fix a bug, add a regression `ok:` example (or test) that would have caught it.
5. Follow the project's existing structure and style. No drive-by refactors outside the requested scope.
6. After a change, briefly state which contracts you added or updated.
"#;

#[tauri::command]
pub fn ensure_standard(project: String) -> Result<String, String> {
    let path = std::path::Path::new(&project).join("CLAUDE.md");
    if path.exists() {
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        if content.contains("NewGen Contract Standard") {
            return Ok("aligned".into());
        }
        // The project has its own CLAUDE.md — leave it untouched; chat turns still
        // receive the standard via the appended system prompt.
        return Ok("foreign".into());
    }
    std::fs::write(&path, CONTRACT_STANDARD).map_err(|e| e.to_string())?;
    Ok("created".into())
}
