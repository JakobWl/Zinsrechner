use serde_json::Value;
use std::{fs, path::{Path, PathBuf}, sync::Mutex};

pub const DOCUMENTS: [&str; 3] = ["konten.json", "prognose.json", "history-groups.json"];
pub struct Storage { pub root: PathBuf, pub lock: Mutex<()> }

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
        let path = file(&self.root, name)?;
        if !path.exists() { return Ok(if name == "prognose.json" { "null" } else { "[]" }.into()); }
        let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
        validate(name, &raw)?;
        Ok(raw)
    }
    pub fn write(&self, name: &str, raw: &str) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let target = file(&self.root, name)?;
        validate(name, raw)?;
        // Refuse to replace corrupt data with the UI's empty initial state.
        if target.exists() { validate(name, &fs::read_to_string(&target).map_err(|e| e.to_string())?)?; }
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let temporary = self.root.join(format!(".{name}.tmp"));
        fs::write(&temporary, raw).map_err(|e| e.to_string())?;
        // Keep a last-known-good copy. std::fs::rename atomically replaces files on Windows too.
        if target.exists() {
            fs::copy(&target, self.root.join(format!("{name}.bak"))).map_err(|e| e.to_string())?;
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

pub fn legacy_candidates() -> Vec<PathBuf> {
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
    #[test] fn corrupt_legacy_profile_is_not_partially_imported() {
        let p = directory(); let old = p.join("old"); let new = p.join("new");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("konten.json"), "[]").unwrap();
        fs::write(old.join("prognose.json"), "{broken").unwrap();
        assert!(migrate(&new, &[old]).is_err());
        assert!(!new.join("konten.json").exists());
    }
    #[test] fn storage_rejects_traversal_invalid_json_and_protects_corrupt_data() {
        let p = directory(); let s = Storage { root: p, lock: Mutex::new(()) };
        assert!(s.write("../evil.json", "[]").is_err());
        assert!(s.write("konten.json", "{}").is_err());
        s.write("konten.json", "[]").unwrap();
        s.write("konten.json", "[1]").unwrap();
        assert_eq!(fs::read_to_string(s.root.join("konten.json.bak")).unwrap(), "[]");
        fs::write(s.root.join("konten.json"), "{broken").unwrap();
        assert!(s.write("konten.json", "[]").is_err());
    }
}
