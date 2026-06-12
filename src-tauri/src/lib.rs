mod chat;
mod pty;
mod scan;
mod standard;

use chat::ChatManager;
use pty::PtyManager;
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: file_type.is_dir(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err("Already exists".into());
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, "").map_err(|e| e.to_string())
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err("Already exists".into());
    }
    std::fs::create_dir_all(p).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    if std::path::Path::new(&to).exists() {
        return Err("Target already exists".into());
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_path(path: String) -> Result<(), String> {
    // Finder's trash API can be slow — keep it off the main thread.
    tauri::async_runtime::spawn_blocking(move || trash::delete(&path).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn load_profile(project: String) -> Result<Option<Value>, String> {
    let path = std::path::Path::new(&project).join(".newgen").join("profile.json");
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_profile(project: String, persona: String) -> Result<(), String> {
    let dir = std::path::Path::new(&project).join(".newgen");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let profile = serde_json::json!({ "version": 1, "persona": persona });
    std::fs::write(
        dir.join("profile.json"),
        serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyManager::default())
        .manage(ChatManager::default())
        .invoke_handler(tauri::generate_handler![
            list_dir,
            read_file,
            write_file,
            create_file,
            create_dir,
            rename_path,
            delete_path,
            load_profile,
            save_profile,
            scan::scan_project,
            scan::flow_annotate,
            scan::flow_features,
            scan::feature_trace,
            standard::ensure_standard,
            chat::chat_send,
            chat::chat_cancel,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running NewGen Editor");
}
