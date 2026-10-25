import { mkdir, writeFile } from "node:fs/promises";
const key = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim();
if (!key) throw new Error("Set TAURI_UPDATER_PUBLIC_KEY to the public key matching your securely stored Tauri signing key.");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error("Set TAURI_SIGNING_PRIVATE_KEY when building signed update artifacts.");
const path = ".jait/artifacts/tauri-updater.conf.json";
await mkdir(".jait/artifacts", { recursive: true });
await writeFile(path, JSON.stringify({
 bundle: { createUpdaterArtifacts: true },
 plugins: { updater: { pubkey: key, endpoints: ["https://github.com/JakobWl/Zinsrechner/releases/latest/download/latest.json"] } },
}, null, 2));
console.log(path);
