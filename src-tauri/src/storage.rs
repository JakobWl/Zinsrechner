use serde_json::Value;
use std::{fs, path::{Path, PathBuf}, sync::Mutex};

pub const DOCUMENTS: [&str; 3] = ["konten.json", "prognose.json", "history-groups.json"];
pub struct Storage { pub root: Mutex<PathBuf> }

const IMPORT_JOURNAL: &str = ".zinsrechner-import.json";

pub fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => Ok(Some(raw)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn timestamp() -> Result<u128, String> {
    Ok(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?.as_nanos())
}

pub fn replace_file(path: &Path, raw: &str) -> Result<(), String> {
    use std::io::Write;
    let temporary = path.with_file_name(format!(".zinsrechner-{}-{}.tmp", std::process::id(), timestamp()?));
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary)
        .map_err(|error| error.to_string())?;
    let written = file.write_all(raw.as_bytes()).and_then(|_| file.sync_all());
    drop(file);
    let result = written.and_then(|_| fs::rename(&temporary, path));
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result.map_err(|error| error.to_string())
}

fn empty_document(name: &str) -> &'static str {
    if name == "prognose.json" { "null" } else { "[]" }
}

fn validate(name: &str, raw: &str) -> Result<(), String> {
    let value: Value = serde_json::from_str(raw).map_err(|e| format!("{name}: {e}"))?;
    match name {
        "konten.json" | "history-groups.json" if !value.is_array() => Err(format!("{name}: expected an array")),
        "prognose.json" if !(value.is_null() || value.is_object()) => Err(format!("{name}: expected an object")),
        _ => Ok(())
    }
}
fn file(root: &Path, name: &str) -> Result<PathBuf, String> {
    if !DOCUMENTS.contains(&name) { return Err("Unknown document".into()); }
    Ok(root.join(name))
}
impl Storage {
    pub fn read(&self, name: &str) -> Result<String, String> {
        let root = self.root.lock().map_err(|e| e.to_string())?;
        recover_import(&root)?;
        let path = file(&root, name)?;
        let raw = read_optional(&path)?.unwrap_or_else(|| empty_document(name).into());
        validate(name, &raw)?;
        Ok(raw)
    }
    pub fn write(&self, name: &str, raw: &str) -> Result<(), String> {
        let root = self.root.lock().map_err(|e| e.to_string())?;
        recover_import(&root)?;
        let target = file(&root, name)?;
        validate(name, raw)?;
        // Refuse to replace corrupt data with the UI's empty initial state.
        if target.exists() { validate(name, &fs::read_to_string(&target).map_err(|e| e.to_string())?)?; }
        fs::create_dir_all(&*root).map_err(|e| e.to_string())?;
        let temporary = root.join(format!(".{name}.tmp"));
        fs::write(&temporary, raw).map_err(|e| e.to_string())?;
        // Keep a last-known-good copy. std::fs::rename atomically replaces files on Windows too.
        if target.exists() {
            fs::copy(&target, root.join(format!("{name}.bak"))).map_err(|e| e.to_string())?;
        }
        fs::rename(temporary, target).map_err(|e| e.to_string())
    }
}

/// Copy (never move) one coherent Electron profile. Validate the whole batch first.
/// A failed/interrupted migration can be retried; an existing Tauri document always wins.
pub fn migrate(root: &Path, candidates: &[PathBuf]) -> Result<Option<PathBuf>, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let source = candidates.iter().find(|p| DOCUMENTS.iter().any(|n| p.join(n).exists()));
    let Some(source) = source else { return Ok(None); };
    let mut documents = Vec::new();
    for name in DOCUMENTS {
        let path = source.join(name);
        if !root.join(name).exists() && path.exists() {
            let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
            validate(name, &raw)?;
            documents.push((name, raw));
        }
    }
    for (name, raw) in documents {
        // create_new makes even a concurrent first launch non-destructive.
        use std::io::Write;
        let mut f = fs::OpenOptions::new().write(true).create_new(true).open(root.join(name)).map_err(|e| e.to_string())?;
        f.write_all(raw.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(Some(source.clone()))
}

pub fn bundle(root: &Path, version: &str) -> Result<String, String> {
    let mut documents = serde_json::Map::new();
    for name in DOCUMENTS {
        if let Some(raw) = read_optional(&root.join(name))? {
            validate(name, &raw)?;
            documents.insert(name.into(), serde_json::from_str(&raw).map_err(|e| e.to_string())?);
        }
    }
    serde_json::to_string_pretty(&serde_json::json!({
        "app": "Zinsrechner", "version": version, "createdAt": timestamp()? / 1_000_000_000,
        "documents": documents,
    })).map_err(|error| error.to_string())
}

pub fn backup(root: &Path, dir: &Path, version: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let target = dir.join(format!("Zinsrechner-v{version}-{}.bak", timestamp()?));
    replace_file(&target, &bundle(root, version)?)?;
    Ok(target)
}

fn parse_bundle(raw: &str) -> Result<serde_json::Map<String, Value>, String> {
    let value: Value = serde_json::from_str(raw).map_err(|error| error.to_string())?;
    let documents = value.get("documents").and_then(Value::as_object)
        .filter(|docs| docs.keys().all(|name| DOCUMENTS.contains(&name.as_str())))
        .filter(|_| value["app"] == "Zinsrechner")
        .ok_or("Die Datei ist kein Zinsrechner-Datenexport oder Backup.")?;
    for (name, value) in documents { validate(name, &value.to_string())?; }
    Ok(documents.clone())
}

// A leftover journal means the import did not finish. Restore the previous
// snapshot before allowing reads, writes, backups, or folder changes.
pub fn recover_import(root: &Path) -> Result<(), String> {
    if !root.is_dir() { return Err(format!("Datenordner nicht erreichbar: {}", root.display())); }
    let journal = root.join(IMPORT_JOURNAL);
    let Some(raw) = read_optional(&journal)? else { return Ok(()); };
    let documents = parse_bundle(&raw)?;
    for name in DOCUMENTS {
        let path = root.join(name);
        if let Some(value) = documents.get(name) {
            replace_file(&path, &value.to_string())?;
        } else if let Err(error) = fs::remove_file(&path) {
            if error.kind() != std::io::ErrorKind::NotFound { return Err(error.to_string()); }
        }
    }
    fs::remove_file(journal).map_err(|error| error.to_string())
}

pub fn import(root: &Path, raw: &str, version: &str) -> Result<(), String> {
    let documents = parse_bundle(raw)?;
    recover_import(root)?;
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let journal = root.join(IMPORT_JOURNAL);
    let previous = backup(root, root, version)?;
    replace_file(&journal, &fs::read_to_string(previous).map_err(|error| error.to_string())?)?;
    let result = (|| {
        for name in DOCUMENTS {
            let raw = documents.get(name).map(Value::to_string).unwrap_or_else(|| empty_document(name).into());
            replace_file(&root.join(name), &raw)?;
        }
        fs::remove_file(&journal).map_err(|error| error.to_string())
    })();
    if let Err(error) = result {
        recover_import(root).map_err(|recovery| format!("{error} (Wiederherstellung: {recovery})"))?;
        return Err(error);
    }
    Ok(())
}

pub fn relocate(root: &Path, destination: &Path, settings: &Path) -> Result<(), String> {
    use std::io::Write;
    recover_import(root)?;
    if destination.join(IMPORT_JOURNAL).symlink_metadata().is_ok() {
        return Err("Im Zielordner befinden sich bereits Zinsrechner-Daten.".into());
    }
    let mut documents = Vec::new();
    for name in DOCUMENTS {
        if destination.join(name).symlink_metadata().is_ok() {
            return Err("Im Zielordner befinden sich bereits Zinsrechner-Daten.".into());
        }
        let raw = read_optional(&root.join(name))?.unwrap_or_else(|| empty_document(name).into());
        validate(name, &raw)?;
        documents.push((destination.join(name), raw));
    }
    let mut created = Vec::new();
    let result = (|| {
        for (path, raw) in documents {
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path)
                .map_err(|error| error.to_string())?;
            created.push(path);
            file.write_all(raw.as_bytes()).and_then(|_| file.sync_all()).map_err(|error| error.to_string())?;
        }
        fs::create_dir_all(settings.parent().ok_or("Missing settings folder")?).map_err(|error| error.to_string())?;
        replace_file(settings, &serde_json::to_string(destination).map_err(|error| error.to_string())?)
    })();
    if result.is_err() {
        for path in created { let _ = fs::remove_file(path); }
    }
    result
}

pub fn legacy_candidates()-> Vec<PathBuf> {
    let mut result = Vec::new();
    if let Some(config) = dirs::config_dir() {
        for name in ["zinsrechner", "Zinsrechner"] { result.push(config.join(name)); }
    }
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let roaming = PathBuf::from(local).join("Packages/Wideve.U.BBGZinsrechner_svv3hhfbxqbc8/LocalCache/Roaming");
        for name in ["zinsrechner", "Zinsrechner"] { result.push(roaming.join(name)); }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> PathBuf {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.jait/artifacts/rust-tests").join(format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&p).unwrap(); p
    }
    #[test] fn migration_preserves_originals_and_never_overwrites() {
        let p = directory(); let old = p.join("electron"); let new = p.join("tauri");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("konten.json"), r#"[{"bankName":"Legacy"}]"#).unwrap();
        fs::write(old.join("prognose.json"), r#"{"horizon":5}"#).unwrap();
        migrate(&new, &[old.clone()]).unwrap();
        assert_eq!(fs::read(new.join("konten.json")).unwrap(), fs::read(old.join("konten.json")).unwrap());
        fs::write(new.join("konten.json"), "[]").unwrap();
        migrate(&new, &[old.clone()]).unwrap();
        assert_eq!(fs::read_to_string(new.join("konten.json")).unwrap(), "[]");
        assert!(old.join("prognose.json").exists());
    }
    #[test] fn backup_bundles_all_documents_into_one_bak_file() {
        let p = directory(); let data = p.join("data"); let out = p.join("backups");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("konten.json"), r#"[{"bankName":"A"}]"#).unwrap();
        let file = backup(&data, &out, "2.0.9").unwrap();
        assert_eq!(file.extension().unwrap(), "bak");
        let bundle: Value = serde_json::from_str(&fs::read_to_string(file).unwrap()).unwrap();
        assert_eq!(bundle["documents"]["konten.json"][0]["bankName"], "A");
    }
    #[test] fn corrupt_legacy_profile_is_not_partially_imported() {
        let p = directory(); let old = p.join("old"); let new = p.join("new");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("konten.json"), "[]").unwrap();
        fs::write(old.join("prognose.json"), "{broken").unwrap();
        assert!(migrate(&new, &[old]).is_err());
        assert!(!new.join("konten.json").exists());
    }
    #[test]
    fn transfers_preserve_originals_and_recover_interrupted_imports() {
        let root = directory();
        let destination = root.join("destination");
        let settings = root.join("config/data-settings.json");
        let accounts = r#"[{"bankName":"Original"}]"#;
        fs::write(root.join("konten.json"), accounts).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("konten.json"), "[]").unwrap();
        assert!(relocate(&root, &destination, &settings).is_err());
        assert!(!settings.exists());
        fs::remove_file(destination.join("konten.json")).unwrap();
        relocate(&root, &destination, &settings).unwrap();
        let persisted: PathBuf = serde_json::from_str(&fs::read_to_string(settings).unwrap()).unwrap();
        assert_eq!(persisted, destination);
        assert_eq!(fs::read_to_string(root.join("konten.json")).unwrap(), accounts);
        assert_eq!(fs::read_to_string(destination.join("konten.json")).unwrap(), accounts);

        let exported = bundle(&destination, "2.0.9").unwrap();
        fs::write(destination.join("konten.json"), "[]").unwrap();
        assert!(import(&destination, r#"{"app":"Zinsrechner","documents":{"prognose.json":[]}}"#, "2.0.9").is_err());
        assert_eq!(fs::read_to_string(destination.join("konten.json")).unwrap(), "[]");
        import(&destination, &exported, "2.0.9").unwrap();
        assert_eq!(fs::read_to_string(destination.join("konten.json")).unwrap(), accounts);
        assert!(!destination.join(IMPORT_JOURNAL).exists());
        let backup = fs::read_dir(&destination).unwrap().map(|entry| entry.unwrap().path())
            .find(|path| path.extension().and_then(|extension| extension.to_str()) == Some("bak")).unwrap();
        fs::copy(backup, destination.join(IMPORT_JOURNAL)).unwrap();
        let storage = Storage { root: Mutex::new(destination) };
        assert_eq!(storage.read("konten.json").unwrap(), "[]");
        fs::remove_dir_all(root).unwrap();
    }

    #[test] fn storage_rejects_traversal_invalid_json_and_protects_corrupt_data() {
        let p = directory(); let s = Storage { root: Mutex::new(p.clone()) };
        assert!(s.write("../evil.json", "[]").is_err());
        assert!(s.write("konten.json", "{}").is_err());
        s.write("konten.json", "[]").unwrap();
        s.write("konten.json", "[1]").unwrap();
        assert_eq!(fs::read_to_string(p.join("konten.json.bak")).unwrap(), "[]");
        fs::write(p.join("konten.json"), "{broken").unwrap();
        assert!(s.write("konten.json", "[]").is_err());
    }
}
