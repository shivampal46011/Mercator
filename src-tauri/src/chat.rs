use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct ChatManager(pub Mutex<HashMap<String, Arc<Mutex<Child>>>>);

#[tauri::command]
pub fn chat_send(
    app: AppHandle,
    state: State<ChatManager>,
    id: String,
    project: String,
    message: String,
    session: Option<String>,
) -> Result<(), String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let resume = session
        .map(|s| {
            let safe: String = s
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect();
            format!(" --resume {safe}")
        })
        .unwrap_or_default();
    // The message and standard travel via env vars so no shell-escaping is needed.
    // Every turn carries the contract standard as part of the agent's system prompt —
    // alignment is enforced per-turn, not hoped for.
    let cmd_line = format!(
        "claude -p \"$NEWGEN_MSG\" --output-format stream-json --verbose --permission-mode acceptEdits --append-system-prompt \"$NEWGEN_STANDARD\"{resume}"
    );

    let mut child = Command::new(&shell)
        .arg("-lc")
        .arg(&cmd_line)
        .current_dir(&project)
        .env("NEWGEN_MSG", &message)
        .env("NEWGEN_STANDARD", crate::standard::CONTRACT_STANDARD)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let child = Arc::new(Mutex::new(child));
    state.0.lock().unwrap().insert(id.clone(), child.clone());

    {
        let app = app.clone();
        let id = id.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    let _ = app.emit(&format!("chat-event-{id}"), line);
                }
            }
        });
    }
    {
        let app = app.clone();
        let id = id.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = app.emit(&format!("chat-stderr-{id}"), line);
            }
        });
    }
    thread::spawn(move || {
        let code = loop {
            {
                let mut c = child.lock().unwrap();
                match c.try_wait() {
                    Ok(Some(status)) => break status.code(),
                    Ok(None) => {}
                    Err(_) => break None,
                }
            }
            thread::sleep(Duration::from_millis(120));
        };
        app.state::<ChatManager>().0.lock().unwrap().remove(&id);
        let _ = app.emit(&format!("chat-done-{id}"), serde_json::json!({ "code": code }));
    });

    Ok(())
}

#[tauri::command]
pub fn chat_cancel(state: State<ChatManager>, id: String) -> Result<(), String> {
    if let Some(child) = state.0.lock().unwrap().get(&id).cloned() {
        let _ = child.lock().unwrap().kill();
    }
    Ok(())
}
