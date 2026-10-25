mod storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(feature = "e2e")]
use std::path::PathBuf;
use std::{collections::HashMap, fs, sync::{atomic::{AtomicUsize, Ordering}, Mutex}};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use storage::Storage;

struct DesktopState {
    prints: Mutex<HashMap<String, String>>,
    next_print: AtomicUsize,
    migration_error: Option<String>,
}
#[tauri::command]
fn read_document(name: String, data: State<Storage>, desktop: State<DesktopState>) -> Result<String, String> {
    if let Some(error) = &desktop.migration_error { return Err(format!("Electron data migration failed: {error}. Original files were preserved.")); }
    data.read(&name)
}
#[tauri::command]
fn write_document(name: String, content: String, data: State<Storage>, desktop: State<DesktopState>) -> Result<(), String> {
    if let Some(error) = &desktop.migration_error { return Err(error.clone()); }
    data.write(&name, &content)
}
#[derive(Serialize)]
struct Saved { saved: bool, path: Option<String> }
#[tauri::command]
async fn save_export(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<Saved, String> {
    if !["Veranlagungshistorie.pdf", "Veranlagungshistorie.xls"].contains(&name.as_str()) { return Err("Unknown export".into()); }
    #[cfg(feature = "e2e")]
    if let Some(dir) = std::env::var_os("ZINSRECHNER_E2E_EXPORT_DIR") {
        let path = PathBuf::from(dir).join(&name);
        fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
        return Ok(Saved { saved: true, path: Some(path.to_string_lossy().into()) });
    }
    tauri::async_runtime::spawn_blocking(move || {
        let extension = if name.ends_with(".pdf") { "pdf" } else { "xls" };
        let mut dialog = app.dialog().file().set_file_name(&name).add_filter(extension, &[extension]);
        if let Some(documents) = dirs::document_dir() { dialog = dialog.set_directory(documents); }
        let Some(path) = dialog.blocking_save_file() else { return Ok(Saved { saved: false, path: None }); };
        let path = path.into_path().map_err(|e| e.to_string())?;
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
        Ok(Saved { saved: true, path: Some(path.to_string_lossy().into()) })
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn create_print_window(app: tauri::AppHandle, html: String, state: State<'_, DesktopState>) -> Result<String, String> {
    let label = format!("print-{}", state.next_print.fetch_add(1, Ordering::Relaxed));
    state.prints.lock().map_err(|e| e.to_string())?.insert(label.clone(), html);
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html#print".into()))
        .title("Druckvorschau – Zinsrechner").inner_size(1000.0, 800.0)
        .build().map_err(|e| e.to_string())?;
    Ok(label)
}
#[tauri::command]
fn print_content(window: tauri::WebviewWindow, state: State<DesktopState>) -> Result<String, String> {
    state.prints.lock().map_err(|e| e.to_string())?.get(window.label()).cloned().ok_or("No print document".into())
}
#[tauri::command]
fn print_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if !window.label().starts_with("print-") { return Err("Printing requires a preview window".into()); }
    window.print().map_err(|e| e.to_string())
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DistributionInfo { store: bool, version: String, updater_configured: bool, market: Option<String> }
fn store_install() -> bool {
    #[cfg(feature = "e2e")]
    if std::env::var("ZINSRECHNER_E2E_STORE").as_deref() == Ok("1") { return true; }
    std::env::current_exe().ok().is_some_and(|p| p.to_string_lossy().to_lowercase().contains("windowsapps"))
}
#[tauri::command]
fn distribution_info(app: tauri::AppHandle) -> DistributionInfo {
    let market = sys_locale::get_locale().and_then(|s| s.replace('_', "-").split('-').find(|s| s.len()==2 && s.chars().all(|c| c.is_ascii_uppercase())).map(str::to_owned));
    let config = app.config();
    let configured = config.plugins.0.get("updater").and_then(|v| v.get("pubkey")).and_then(Value::as_str).is_some_and(|s| !s.is_empty());
    DistributionInfo { store: store_install(), version: app.package_info().version.to_string(), updater_configured: configured, market }
}
#[tauri::command]
async fn update_metadata(app: tauri::AppHandle) -> Result<Value, String> {
    let info = distribution_info(app);
    #[cfg(feature = "e2e")]
    if let Some(path) = std::env::var_os("ZINSRECHNER_E2E_UPDATE_FIXTURE") {
        return serde_json::from_str(&fs::read_to_string(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string());
    }
    let url = if info.store {
        let Some(market) = info.market else { return Ok(Value::Null); };
        format!("https://displaycatalog.mp.microsoft.com/v7.0/products/9P5VH8M435QN?market={market}&languages=en-us")
    } else { "https://api.github.com/repos/JakobWl/Zinsrechner/releases/latest".into() };
    reqwest::Client::builder().timeout(std::time::Duration::from_secs(8)).user_agent("Zinsrechner-Updater").build().map_err(|e| e.to_string())?
        .get(url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())
}
#[tauri::command]
fn open_store(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url("ms-windows-store://downloadsandupdates", None::<&str>).map_err(|e| e.to_string())
}
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !url.starts_with("https://") { return Err("Only HTTPS links are allowed".into()); }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") { let _ = w.unminimize(); let _ = w.set_focus(); }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE).build())
        .setup(|app| {
            if app.config().plugins.0.get("updater").and_then(|v| v.get("pubkey")).and_then(Value::as_str).is_some_and(|key| !key.is_empty()) {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            let root = app.path().app_data_dir()?;
            #[cfg(feature = "e2e")]
            let root = std::env::var_os("ZINSRECHNER_E2E_DATA_DIR").map(PathBuf::from).unwrap_or(root);
            let candidates = storage::legacy_candidates();
            #[cfg(feature = "e2e")]
            let candidates = std::env::var_os("ZINSRECHNER_E2E_LEGACY_DIR").map(|p| vec![PathBuf::from(p)]).unwrap_or(candidates);
            let migration = storage::migrate(&root, &candidates);
            // Window-state plugin handles subsequent launches; import Electron bounds once.
            if !app.path().app_config_dir()?.join(".window-state.json").exists() {
                if let Ok(Some(source)) = &migration {
                    if let Ok(raw) = fs::read_to_string(source.join("window-state.json")) {
                        if let Ok(state) = serde_json::from_str::<Value>(&raw) {
                            if let Some(w) = app.get_webview_window("main") {
                                if let (Some(width), Some(height)) = (state["width"].as_f64(), state["height"].as_f64()) {
                                    if width >= 800.0 && height >= 550.0 { let _ = w.set_size(tauri::LogicalSize::new(width, height)); }
                                }
                                if state["maximized"].as_bool() == Some(false) { let _ = w.unmaximize(); }
                            }
                        }
                    }
                }
            }
            app.manage(Storage { root, lock: Mutex::new(()) });
            app.manage(DesktopState { prints: Mutex::new(HashMap::new()), next_print: AtomicUsize::new(1), migration_error: migration.err() });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label().starts_with("print-") {
                if let Some(state) = window.app_handle().try_state::<DesktopState>() {
                    if let Ok(mut prints) = state.prints.lock() { prints.remove(window.label()); }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![read_document, write_document, save_export, create_print_window, print_content, print_window, distribution_info, update_metadata, open_store, open_external])
        .run(tauri::generate_context!()).expect("Could not run Zinsrechner");
}
