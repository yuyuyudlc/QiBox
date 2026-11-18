#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod owned_child;
use owned_child::OwnedChild;

use serde_json::{json, Value};
use tauri::Emitter;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{ChildStdin, Command, Stdio},
    collections::HashMap,
    sync::{Arc, Mutex, mpsc, atomic::{AtomicBool, AtomicU64, Ordering}},
    time::Duration,
};

struct ConsoleState {
    root: PathBuf,
    busy: Arc<Mutex<()>>,
    agent: Arc<Mutex<Option<Arc<AgentHost>>>>,
}

struct AgentHost {
    child: Mutex<OwnedChild>,
    input: Mutex<Option<ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>,
    next: AtomicU64,
    connected: Arc<AtomicBool>,
    log_path: PathBuf,
}
fn open_host_log(root: &PathBuf) -> (PathBuf, Stdio) {
    let runtime_dir = root.join(".runtime");
    let log_path = runtime_dir.join("host-agent.log");
    let _ = std::fs::create_dir_all(&runtime_dir);
    if let Ok(meta) = std::fs::metadata(&log_path) {
        if meta.len() > 1_048_576 {
            let _ = std::fs::write(&log_path, b"");
        }
    }
    let stderr = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());
    (log_path, stderr)
}
fn host_log_hint(log_path: &PathBuf) -> String {
    if let Ok(text) = std::fs::read_to_string(log_path) {
        if let Some(last) = text.lines().rev().map(|l| l.trim()).find(|l| !l.is_empty()) {
            let clipped: String = last.chars().take(180).collect();
            return format!("（{clipped}；详情见 .runtime/host-agent.log）");
        }
    }
    "（详情见 .runtime/host-agent.log）".to_string()
}
impl AgentHost {
    fn start(root: &PathBuf, app: tauri::AppHandle) -> Result<Arc<Self>, String> {
        let (log_path, stderr) = open_host_log(root);
        let mut command = Command::new(node_executable());
        command.arg(root.join("src/agent-server.mjs")).current_dir(root)
            .env_remove("NODE_OPTIONS").env_remove("NODE_PATH")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(stderr);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = OwnedChild::spawn(&mut command).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "未找到 Node.js 运行时，请先安装 Node.js 22+（推荐 Node.js 24）后重试".to_string()
            } else {
                format!("无法启动受管会话服务：{e}")
            }
        })?;
        let input = child.stdin.take().ok_or("会话输入不可用")?;
        let output = child.stdout.take().ok_or("会话输出不可用")?;
        let pending: Arc<Mutex<HashMap<u64,mpsc::Sender<Value>>>> = Arc::new(Mutex::new(HashMap::new()));
        let readers = pending.clone();
        let connected = Arc::new(AtomicBool::new(true));
        let reader_connected = connected.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                let mut line = Vec::new();
                if reader.by_ref().take(1_600_001).read_until(b'\n', &mut line).is_err() || line.last() != Some(&b'\n') || line.len() > 1_600_000 { break; }
                if let Ok(frame) = serde_json::from_slice::<Value>(&line) {
                    if frame["method"] == "agent.event" { let _ = app.emit("agent-event", &frame["params"]); }
                    else if let Some(id) = frame["id"].as_u64() {
                        if let Ok(mut pending) = readers.lock() { if let Some(sender) = pending.remove(&id) { let _ = sender.send(frame); } }
                    }
                } else { break; }
            }
            reader_connected.store(false, Ordering::Release);
            if let Ok(mut pending) = readers.lock() { pending.clear(); }
            let _ = app.emit("agent-event", json!({"kind":"connection.lost","sessionId":null}));
        });
        Ok(Arc::new(Self { child:Mutex::new(child), input:Mutex::new(Some(input)), pending, next:AtomicU64::new(0), connected, log_path }))
    }
    fn alive(&self) -> bool { self.connected.load(Ordering::Acquire) && self.child.lock().ok().and_then(|mut c| c.try_wait().ok()).map(|result|result.is_none()).unwrap_or(false) }
    fn call(&self, method: String, params: Value) -> Result<Value,String> {
        self.call_with_timeout(method, params, Duration::from_secs(210))
    }
    fn call_with_timeout(&self, method: String, params: Value, timeout: Duration) -> Result<Value,String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().map_err(|_|"会话队列不可用")?.insert(id,sender);
        let bytes = format!("{}\n", json!({"id":id,"method":method,"params":params}));
        let result = (|| {
            if !self.connected.load(Ordering::Acquire) {
                return Err(format!("会话连接已关闭{}", host_log_hint(&self.log_path)));
            }
            if bytes.len() > 1_600_000 { return Err("RPC_FRAME_TOO_LARGE".to_string()); }
            self.input.lock().map_err(|_|"会话输入不可用")?.as_mut()
                .ok_or_else(|| format!("会话连接已关闭{}", host_log_hint(&self.log_path)))?
                .write_all(bytes.as_bytes())
                .map_err(|_| format!("会话连接已关闭{}", host_log_hint(&self.log_path)))?;
            let frame = receiver.recv_timeout(timeout)
                .map_err(|_| format!("会话请求超时或连接已关闭{}", host_log_hint(&self.log_path)))?;
            if frame.get("error").is_some() { return Err(frame["error"]["code"].as_str().unwrap_or("会话请求失败").to_string()); }
            Ok(frame["result"].clone())
        })();
        if let Ok(mut pending) = self.pending.lock() { pending.remove(&id); }
        result
    }
}
fn terminate_child_process(child: &mut OwnedChild, grace_ms: u64) {
    let steps = (grace_ms / 25).max(1);
    for _ in 0..steps {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    if let Ok(Some(_)) = child.try_wait() {
        return;
    }
    child.terminate_tree();
    for _ in 0..20 {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
impl Drop for AgentHost {
    fn drop(&mut self) {
        self.connected.store(false, Ordering::Release);
        if let Ok(mut input) = self.input.lock() {
            drop(input.take());
        }
        if let Ok(mut child) = self.child.lock() {
            terminate_child_process(&mut child, 2500);
        }
    }
}
impl Drop for ConsoleState {
    fn drop(&mut self) {
        if let Ok(mut agent) = self.agent.lock() {
            drop(agent.take());
        }
    }
}

fn ensure_agent_host(
    root: &PathBuf,
    agent_slot: &Mutex<Option<Arc<AgentHost>>>,
    app: &tauri::AppHandle,
) -> Result<Arc<AgentHost>, String> {
    let mut slot = agent_slot.lock().map_err(|_| "会话服务不可用".to_string())?;
    if slot.as_ref().map(|h| !h.alive()).unwrap_or(true) {
        *slot = Some(AgentHost::start(root, app.clone())?);
    }
    Ok(slot.as_ref().unwrap().clone())
}

#[tauri::command]
async fn agent_request(state: tauri::State<'_,ConsoleState>, app:tauri::AppHandle, method:String, params:Value) -> Result<Value,String> {
    let host = ensure_agent_host(&state.root, &state.agent, &app)?;
    tauri::async_runtime::spawn_blocking(move ||host.call(method,params)).await.map_err(|e|e.to_string())?
}

fn project_root() -> Result<PathBuf, String> {
    let mut candidates = vec![];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.to_path_buf());
        }
    }
    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
    }
    candidates
        .into_iter()
        .find(|p| {
            p.join("src/desktop-api.mjs").is_file()
                && (p.join("config/isolation.json").is_file() || p.join("config/isolation.example.json").is_file())
        })
        .ok_or_else(|| {
            "请将 Isolation Console.exe 放在包含 config 和 src 的 agent-isolation 项目目录中".into()
        })
}
fn node_executable() -> PathBuf {
    #[cfg(windows)]
    {
        for var in ["ProgramFiles", "LOCALAPPDATA", "NVM_SYMLINK"] {
            if let Some(base) = std::env::var_os(var) {
                let candidate = if var == "LOCALAPPDATA" {
                    PathBuf::from(base).join("Programs/nodejs/node.exe")
                } else if var == "NVM_SYMLINK" {
                    PathBuf::from(base).join("node.exe")
                } else {
                    PathBuf::from(base).join("nodejs/node.exe")
                };
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }
    PathBuf::from("node")
}
fn is_mutating_request(action: &str, payload: &Value) -> bool {
    match action {
        "snapshot" | "validate" => false,
        "claude_sync" => ![Some("info"), Some("codex_info")].contains(&payload["operation"].as_str()),
        _ => true,
    }
}
fn request_timeout(action: &str, payload: &Value) -> Duration {
    if action == "operation" && payload["operation"].as_str() == Some("up") {
        Duration::from_secs(930)
    } else {
        Duration::from_secs(210)
    }
}
async fn request(
    state: &tauri::State<'_, ConsoleState>,
    app: &tauri::AppHandle,
    action: &'static str,
    payload: Value,
) -> Result<Value, String> {
    let root = state.root.clone();
    let gate = state.busy.clone();
    let agent = state.agent.clone();
    let app = app.clone();
    let mutating = is_mutating_request(action, &payload);
    let timeout = request_timeout(action, &payload);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = if mutating {
            Some(
                gate.lock()
                    .map_err(|_| "本地操作队列不可用，请重新打开程序".to_string())?,
            )
        } else {
            None
        };
        let params = json!({"action": action, "payload": payload});
        let host = ensure_agent_host(&root, &agent, &app)?;
        let response = match host.call_with_timeout("console.request".into(), params.clone(), timeout) {
            Ok(value) => value,
            Err(err) if !mutating && err.starts_with("会话连接已关闭") => {
                let fresh = ensure_agent_host(&root, &agent, &app)?;
                fresh.call_with_timeout("console.request".into(), params, timeout)?
            }
            Err(err) => return Err(err),
        };
        if response["ok"] != true {
            return Err(response["error"]
                .as_str()
                .unwrap_or("本地操作失败")
                .to_string());
        }
        Ok(response["result"].clone())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn get_snapshot(
    state: tauri::State<'_, ConsoleState>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    request(&state, &app, "snapshot", json!({})).await
}
#[tauri::command]
async fn validate_policy(
    state: tauri::State<'_, ConsoleState>,
    app: tauri::AppHandle,
    policy: Value,
) -> Result<Value, String> {
    request(&state, &app, "validate", json!({"policy":policy})).await
}
#[tauri::command]
async fn save_policy(
    state: tauri::State<'_, ConsoleState>,
    app: tauri::AppHandle,
    policy: Value,
    expected_hash: String,
) -> Result<Value, String> {
    request(
        &state,
        &app,
        "save",
        json!({"policy":policy,"expectedHash":expected_hash}),
    )
    .await
}
#[tauri::command]
async fn setup_wsl(
    state: tauri::State<'_, ConsoleState>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    #[cfg(not(windows))]
    return Err("WSL 配置需要 Windows。".into());

    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::CREATE_NEW_CONSOLE;

        let root = state.root.clone();
        if !root.join("scripts/setup-wsl.sh").is_file() {
            return Err("找不到 scripts/setup-wsl.sh，请完整解压发布包。".into());
        }
        let snapshot = request(&state, &app, "snapshot", json!({})).await?;
        if snapshot["runtime"]["engineAvailable"] != true {
            return Err(snapshot["runtime"]["reason"]
                .as_str()
                .unwrap_or("请先安装并初始化 WSL2 发行版。")
                .into());
        }
        let gate = state.busy.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let policy = &snapshot["policy"];
            let [Some(distro), Some(user), Some(workspace)] = [
                policy["runtime"]["distro"].as_str(),
                policy["runtime"]["user"].as_str(),
                policy["workspace"]["defaultRoot"].as_str(),
            ] else {
                return Err("无法读取 WSL 配置，请刷新运行环境。".into());
            };
            let _guard = gate.lock().map_err(|_| "本地操作队列不可用，请重新打开程序".to_string())?;
            let status = Command::new("wsl.exe")
                .args(["--distribution", distro, "--user", user, "--cd"])
                .arg(root)
                .args(["--exec", "/bin/bash", "scripts/setup-wsl.sh", "--wait", workspace])
                .env("WSL_UTF8", "1")
                .creation_flags(CREATE_NEW_CONSOLE)
                .status()
                .map_err(|e| format!("无法打开 WSL 配置终端：{e}"))?;
            Ok(status.success())
        })
        .await
        .map_err(|e| e.to_string())?
    }
}
#[tauri::command]
async fn run_operation(
    state: tauri::State<'_, ConsoleState>,
    app: tauri::AppHandle,
    operation: String,
) -> Result<Value, String> {
    if !["up", "stop"].contains(&operation.as_str()) {
        return Err("不允许的操作".into());
    }
    request(&state, &app, "operation", json!({"operation":operation})).await
}
#[tauri::command]
async fn claude_sync(
    state: tauri::State<'_, ConsoleState>,
    app: tauri::AppHandle,
    operation: String,
    expected_source_hash: Option<String>,
) -> Result<Value, String> {
    if !["info", "sync", "reset", "codex_info", "codex_sync"].contains(&operation.as_str()) {
        return Err("不允许的 Claude 配置操作".into());
    }
    request(
        &state,
        &app,
        "claude_sync",
        json!({"operation":operation,"expectedSourceHash":expected_source_hash}),
    )
    .await
}
#[tauri::command]
fn open_in_editor(
    state: tauri::State<'_, ConsoleState>,
    editor: String,
    wsl_path: String,
    distro: Option<String>,
) -> Result<Value, String> {
    let trimmed_path = wsl_path.trim();
    if trimmed_path.is_empty()
        || !trimmed_path.starts_with('/')
        || trimmed_path.contains('\0')
        || trimmed_path.contains('\r')
        || trimmed_path.contains('\n')
    {
        return Err("无效的 WSL 路径".into());
    }
    let distro_name = distro
        .filter(|d| !d.trim().is_empty())
        .or_else(|| {
            let p = state.root.join("config/isolation.json");
            std::fs::read_to_string(p)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .and_then(|v| v["runtime"]["distro"].as_str().map(|s| s.to_string()))
        })
        .unwrap_or_else(|| "Ubuntu".to_string());
    if distro_name.contains('\0') || distro_name.contains('\r') || distro_name.contains('\n') {
        return Err("无效的 WSL 发行版名称".into());
    }
    let win_subpath = trimmed_path.replace('/', r"\");
    let unc_path = format!(r"\\wsl.localhost\{}{}", distro_name, win_subpath);
    let remote_uri = format!("vscode-remote://wsl+{}{}", distro_name, trimmed_path);

    let spawn_editor = |candidates: Vec<PathBuf>, cli_name: &str| -> Result<(), String> {
        for bin in candidates {
            if bin.is_file() {
                let mut cmd = Command::new(&bin);
                cmd.arg("--folder-uri").arg(&remote_uri);
                #[cfg(windows)]
                cmd.creation_flags(0x08000000);
                if cmd.spawn().is_ok() {
                    return Ok(());
                }
            }
        }
        let mut fallback = Command::new("cmd.exe");
        fallback.args(["/C", cli_name, "--folder-uri", &remote_uri]);
        #[cfg(windows)]
        fallback.creation_flags(0x08000000);
        fallback
            .spawn()
            .map(|_| ())
            .map_err(|_| format!("未找到 {}，请确认已在 Windows 安装该编辑器", cli_name))
    };

    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let program_files = std::env::var_os("ProgramFiles").map(PathBuf::from);

    match editor.as_str() {
        "explorer" => {
            Command::new("explorer.exe")
                .arg(&unc_path)
                .spawn()
                .map_err(|e| format!("无法打开资源管理器: {e}"))?;
        }
        "vscode" => {
            let mut list = Vec::new();
            if let Some(ref base) = local_app_data {
                list.push(base.join(r"Programs\Microsoft VS Code\bin\code.cmd"));
            }
            if let Some(ref base) = program_files {
                list.push(base.join(r"Microsoft VS Code\bin\code.cmd"));
            }
            spawn_editor(list, "code")?;
        }
        "cursor" => {
            let mut list = Vec::new();
            if let Some(ref base) = local_app_data {
                list.push(base.join(r"Programs\cursor\resources\app\bin\cursor.cmd"));
                list.push(base.join(r"cursor\resources\app\bin\cursor.cmd"));
            }
            spawn_editor(list, "cursor")?;
        }
        "antigravity" => {
            let mut list = Vec::new();
            if let Some(ref base) = local_app_data {
                list.push(base.join(r"Programs\Antigravity\bin\antigravity.cmd"));
                list.push(base.join(r"Programs\Antigravity\bin\agy.cmd"));
            }
            spawn_editor(list, "agy")?;
        }
        "zed" => {
            let mut list = Vec::new();
            if let Some(ref base) = local_app_data {
                list.push(base.join(r"Programs\Zed\bin\Zed.exe"));
                list.push(base.join(r"Programs\Zed\Zed.exe"));
                list.push(base.join(r"Zed\bin\Zed.exe"));
            }
            if let Some(ref base) = program_files {
                list.push(base.join(r"Zed\bin\Zed.exe"));
            }
            let mut launched = false;
            for bin in list {
                if bin.is_file() {
                    let mut cmd = Command::new(&bin);
                    cmd.args(["--wsl", &distro_name, trimmed_path]);
                    #[cfg(windows)]
                    cmd.creation_flags(0x08000000);
                    if cmd.spawn().is_ok() {
                        launched = true;
                        break;
                    }
                }
            }
            if !launched {
                let mut fallback = Command::new("cmd.exe");
                fallback.args(["/C", "zed", "--wsl", &distro_name, trimmed_path]);
                #[cfg(windows)]
                fallback.creation_flags(0x08000000);
                fallback
                    .spawn()
                    .map(|_| ())
                    .map_err(|_| "未找到 Zed，请确认已在 Windows 安装 Zed".to_string())?;
            }
        }
        "terminal" => {
            let mut wt = Command::new("wt.exe");
            wt.args(["-w", "0", "nt", "wsl.exe", "-d", &distro_name, "--cd", trimmed_path]);
            if wt.spawn().is_err() {
                Command::new("wsl.exe")
                    .args(["-d", &distro_name, "--cd", trimmed_path])
                    .spawn()
                    .map_err(|e| format!("无法打开 WSL 终端: {e}"))?;
            }
        }
        _ => return Err("不支持的打开方式".into()),
    }
    Ok(json!({"opened": true, "editor": editor, "path": trimmed_path}))
}
#[tauri::command]
fn ensure_window_width(
    window: tauri::WebviewWindow,
    target_inner_width: u32,
    allow_shrink: Option<bool>,
) -> Result<Value, String> {
    if window.is_maximized().unwrap_or(false)
        || window.is_fullscreen().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
    {
        return Ok(json!({ "resized": false, "reason": "window_state" }));
    }

    let scale = window.scale_factor().unwrap_or(1.0).clamp(0.5, 4.0);
    let inner_size = window.inner_size().map_err(|e| e.to_string())?;
    let outer_size = window.outer_size().map_err(|e| e.to_string())?;
    let outer_pos = window.outer_position().map_err(|e| e.to_string())?;

    let cur_inner_logical = ((inner_size.width as f64) / scale).round() as u32;
    let frame_extra_phys = (outer_size.width as i32 - inner_size.width as i32).max(0);
    let shrink = allow_shrink.unwrap_or(false);

    if !shrink && cur_inner_logical >= target_inner_width {
        return Ok(json!({
            "resized": false,
            "previousInnerWidth": cur_inner_logical,
            "innerWidth": cur_inner_logical,
        }));
    }

    let clamped_target_logical = target_inner_width.max(980);
    let mut desired_inner_phys = ((clamped_target_logical as f64) * scale).round() as i32;

    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let mut target_pos_x = outer_pos.x;
    if let Some(m) = monitor {
        let area = m.work_area();
        let max_inner_phys = (area.size.width as i32 - frame_extra_phys).max(320);
        if desired_inner_phys > max_inner_phys {
            desired_inner_phys = max_inner_phys;
        }
        let target_outer_phys = desired_inner_phys + frame_extra_phys;
        let area_right = area.position.x + area.size.width as i32;
        if target_pos_x + target_outer_phys > area_right {
            target_pos_x = (area_right - target_outer_phys).max(area.position.x);
        }
    }

    let final_inner_phys = desired_inner_phys.max(1) as u32;
    let final_inner_logical = ((final_inner_phys as f64) / scale).round() as u32;

    if final_inner_phys == inner_size.width {
        return Ok(json!({
            "resized": false,
            "previousInnerWidth": cur_inner_logical,
            "innerWidth": cur_inner_logical,
        }));
    }

    if target_pos_x != outer_pos.x {
        let _ = window.set_position(tauri::PhysicalPosition::new(target_pos_x, outer_pos.y));
    }
    window
        .set_size(tauri::PhysicalSize::new(final_inner_phys, inner_size.height))
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "resized": true,
        "previousInnerWidth": cur_inner_logical,
        "innerWidth": final_inner_logical,
    }))
}
#[cfg(windows)]
fn show_startup_error(message: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let title: Vec<u16> = OsStr::new("栖盒 Qibox 启动失败").encode_wide().chain(Some(0)).collect();
    let text: Vec<u16> = OsStr::new(message).encode_wide().chain(Some(0)).collect();
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR);
    }
}
#[cfg(not(windows))]
fn show_startup_error(message: &str) {
    eprintln!("{message}");
}
fn main() {
    let root = project_root().unwrap_or_else(|error| {
        show_startup_error(&error);
        std::process::exit(1);
    });
    if let Err(err) = tauri::Builder::default()
        .manage(ConsoleState {
            root,
            busy: Arc::new(Mutex::new(())),
            agent: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            validate_policy,
            save_policy,
            setup_wsl,
            run_operation,
            claude_sync,
            agent_request,
            open_in_editor,
            ensure_window_width
        ])
        .run(tauri::generate_context!())
    {
        show_startup_error(&format!("无法启动桌面窗口（请确认系统已安装 WebView2 Runtime）：\n{err}"));
        std::process::exit(1);
    }
}
