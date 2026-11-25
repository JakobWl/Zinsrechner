mod storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
// Document commands must be async: synchronous Tauri commands run on the main
// thread, which on Windows also answers the frameless window's per-mouse-move
// hit-testing. Disk I/O there (plus Defender scanning each file operation)
// made the cursor stutter over the window whenever a save was in flight.
// The frontend serializes writes per document (see desktop/bridge.ts), so
// running them off the main thread cannot reorder saves.
#[tauri::command]
async fn read_document(name: String, data: State<'_, Storage>, desktop: State<'_, DesktopState>) -> Result<String, String> {
    if let Some(error) = &desktop.migration_error { return Err(format!("Electron data migration failed: {error}. Original files were preserved.")); }
    data.read(&name)
}
#[tauri::command]
async fn write_document(name: String, content: String, data: State<'_, Storage>, desktop: State<'_, DesktopState>) -> Result<(), String> {
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
fn backup_settings_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("backup-settings.json"))
}
/// Backup folder chosen by the user; asks once (default Documents\ZinsrechnerBackups) and remembers it.
fn backup_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let settings = backup_settings_file(app)?;
    if let Ok(raw) = fs::read_to_string(&settings) {
        if let Some(dir) = serde_json::from_str::<Value>(&raw).ok().and_then(|v| v["dir"].as_str().map(std::path::PathBuf::from)) { return Ok(dir); }
    }
    let default = dirs::document_dir().map(|d| d.join("ZinsrechnerBackups")).ok_or("No Documents folder")?;
    #[cfg(feature = "e2e")]
    let chosen = std::env::var_os("ZINSRECHNER_E2E_BACKUP_DIR").map(std::path::PathBuf::from);
    #[cfg(not(feature = "e2e"))]
    let chosen: Option<std::path::PathBuf> = None;
    let chosen = match chosen {
        Some(dir) => dir,
        None => {
            fs::create_dir_all(&default).map_err(|e| e.to_string())?;
            app.dialog().file().set_title("Backup-Ordner für Updates wählen").set_directory(&default)
                .blocking_pick_folder().and_then(|p| p.into_path().ok()).unwrap_or(default)
        }
    };
    fs::create_dir_all(settings.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&settings, serde_json::json!({ "dir": chosen }).to_string()).map_err(|e| e.to_string())?;
    Ok(chosen)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupSettings { dir: String, configured: bool }
fn default_backup_dir() -> Result<std::path::PathBuf, String> {
    dirs::document_dir().map(|d| d.join("ZinsrechnerBackups")).ok_or("No Documents folder".into())
}
fn saved_backup_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let raw = fs::read_to_string(backup_settings_file(app).ok()?).ok()?;
    serde_json::from_str::<Value>(&raw).ok()?["dir"].as_str().map(std::path::PathBuf::from)
}
#[tauri::command]
fn get_backup_settings(app: tauri::AppHandle) -> Result<BackupSettings, String> {
    Ok(match saved_backup_dir(&app) {
        Some(dir) => BackupSettings { dir: dir.to_string_lossy().into(), configured: true },
        None => BackupSettings { dir: default_backup_dir()?.to_string_lossy().into(), configured: false },
    })
}
#[tauri::command]
async fn choose_backup_dir(app: tauri::AppHandle) -> Result<Option<BackupSettings>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let start = saved_backup_dir(&app).map(Ok).unwrap_or_else(default_backup_dir)?;
        fs::create_dir_all(&start).map_err(|e| e.to_string())?;
        let Some(picked) = app.dialog().file().set_title("Backup-Ordner wählen").set_directory(&start).blocking_pick_folder() else { return Ok(None); };
        let dir = picked.into_path().map_err(|e| e.to_string())?;
        let settings = backup_settings_file(&app)?;
        fs::create_dir_all(settings.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::write(&settings, serde_json::json!({ "dir": dir }).to_string()).map_err(|e| e.to_string())?;
        Ok(Some(BackupSettings { dir: dir.to_string_lossy().into(), configured: true }))
    }).await.map_err(|e| e.to_string())?
}
fn data_settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("data-settings.json"))
}

#[tauri::command]
async fn get_data_dir(data: State<'_, Storage>) -> Result<String, String> {
    Ok(data.root.lock().map_err(|e| e.to_string())?.to_string_lossy().into())
}

#[tauri::command]
async fn choose_data_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<Storage>();
        let start = data.root.lock().map_err(|e| e.to_string())?.clone();
        let mut dialog = app.dialog().file().set_title("Datenordner wählen");
        if start.is_dir() { dialog = dialog.set_directory(&start); }
        let Some(picked) = dialog.blocking_pick_folder() else { return Ok(None); };
        let destination = picked.into_path().map_err(|e| e.to_string())?;
        let mut root = data.root.lock().map_err(|e| e.to_string())?;
        if fs::canonicalize(&*root).map_err(|e| e.to_string())? != fs::canonicalize(&destination).map_err(|e| e.to_string())? {
            if let Some(error) = &app.state::<DesktopState>().migration_error { return Err(error.clone()); }
            storage::relocate(&root, &destination, &data_settings_file(&app)?)?;
            *root = destination;
        }
        Ok(Some(root.to_string_lossy().into()))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_data(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(picked) = app.dialog().file().set_title("Daten exportieren")
            .set_file_name("Zinsrechner-Daten.json").add_filter("JSON", &["json"]).blocking_save_file()
        else { return Ok(None); };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        // Reserve application file names even when saving into a different folder.
        let name = path.file_name().and_then(|name| name.to_str()).ok_or("Ungültiger Dateiname")?.trim_end_matches([' ', '.']);
        if storage::DOCUMENTS.iter().chain([".zinsrechner-import.json", "data-settings.json", "backup-settings.json", ".window-state.json"].iter())
            .any(|reserved| name.eq_ignore_ascii_case(reserved)) {
            return Err("Bitte einen anderen Dateinamen für den Export wählen.".into());
        }
        if let Some(error) = &app.state::<DesktopState>().migration_error { return Err(error.clone()); }
        let data = app.state::<Storage>();
        let root = data.root.lock().map_err(|e| e.to_string())?;
        storage::recover_import(&root)?;
        storage::replace_file(&path, &storage::bundle(&root, &app.package_info().version.to_string())?)?;
        Ok(Some(path.to_string_lossy().into()))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_data(app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(picked) = app.dialog().file().set_title("Datenimport oder Backup auswählen")
            .add_filter("Zinsrechner-Daten", &["json", "bak"]).blocking_pick_file()
        else { return Ok(false); };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let data = app.state::<Storage>();
        let root = data.root.lock().map_err(|e| e.to_string())?;
        if let Some(error) = &app.state::<DesktopState>().migration_error { return Err(error.clone()); }
        storage::import(&root, &raw, &app.package_info().version.to_string())?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn backup_before_update(app: tauri::AppHandle) -> Result<String, String> {
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let dir = backup_dir(&app)?;
        let data = app.state::<Storage>();
        let root = data.root.lock().map_err(|e| e.to_string())?;
        storage::recover_import(&root)?;
        storage::backup(&root, &dir, &version).map(|p| p.to_string_lossy().into())
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
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(tauri_plugin_window_state::StateFlags::all() & !(tauri_plugin_window_state::StateFlags::VISIBLE | tauri_plugin_window_state::StateFlags::DECORATIONS)).build())
        .setup(|app| {
            if app.config().plugins.0.get("updater").and_then(|v| v.get("pubkey")).and_then(Value::as_str).is_some_and(|key| !key.is_empty()) {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            // Store (MSIX) installs virtualize %APPDATA% into the package folder, which Windows
            // deletes on uninstall. Keep data in Documents\Zinsrechner instead and migrate
            // from the old app-data folder (and Electron locations) on first start.
            let app_data = app.path().app_data_dir()?;
            let root = dirs::document_dir().map(|d| d.join("Zinsrechner")).unwrap_or_else(|| app_data.clone());
            #[cfg(feature = "e2e")]
            let root = std::env::var_os("ZINSRECHNER_E2E_DATA_DIR").map(PathBuf::from).unwrap_or(root);
            let mut candidates = vec![app_data];
            candidates.extend(storage::legacy_candidates());
            #[cfg(feature = "e2e")]
            let candidates = std::env::var_os("ZINSRECHNER_E2E_LEGACY_DIR").map(|p| vec![PathBuf::from(p)]).unwrap_or(candidates);
            let configured: Option<PathBuf> = storage::read_optional(&data_settings_file(app.handle())?)?
                .map(|raw| serde_json::from_str(&raw)).transpose()?;
            let migration = if configured.is_some() { Ok(None) } else { storage::migrate(&root, &candidates) };
            let root = configured.unwrap_or(root);
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
            app.manage(Storage { root: Mutex::new(root) });
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
        .invoke_handler(tauri::generate_handler![backup_before_update, get_backup_settings, choose_backup_dir, get_data_dir, choose_data_dir, export_data, import_data, read_document, write_document, save_export, create_print_window, print_content, print_window, distribution_info, update_metadata, open_store, open_external])
        .run(tauri::generate_context!()).expect("Could not run Zinsrechner");
}
