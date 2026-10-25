import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { buildHistoryHtml, buildHistoryExcelXml, type HistoryRow, type HistoryGroup } from "./reports";
import { compareSemver, latestStoreVersion } from "./updateAvailability";
import type { DesktopBridge, DesktopListener } from "./types";

const documents: Record<string, string> = { data: "konten.json", forecast: "prognose.json", "history-groups": "history-groups.json" };
type Distribution = { store: boolean; version: string; updaterConfigured: boolean; market?: string };
let pending: Update | null = null;
let downloading: Promise<any> | null = null;
const listeners = new Map<string, Set<DesktopListener>>();
const emit = (channel: string, value: unknown) => listeners.get(channel)?.forEach(fn => fn(undefined, value));
const fail = (error: unknown) => {
  console.error(error);
  window.dispatchEvent(new CustomEvent("desktop-error", { detail: String(error) }));
};

async function exportHistory(kind: "pdf" | "excel", rows: HistoryRow[], groups: HistoryGroup[]) {
  let bytes: number[];
  if (kind === "pdf") {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const html = new DOMParser().parseFromString(buildHistoryHtml(rows, groups), "text/html");
    const pdf = new jsPDF({ orientation: groups.length > 3 ? "landscape" : "portrait" });
    pdf.setFontSize(16);
    pdf.text("Veranlagungshistorie", 14, 18);
    autoTable(pdf, { html: html.querySelector("table")!, startY: 25,
      styles: { fontSize: 9, cellPadding: 2, overflow: "linebreak" },
      headStyles: { fillColor: [22, 104, 220] },
      didParseCell: (cell) => {
        if (cell.row.raw instanceof HTMLTableRowElement && cell.row.raw.classList.contains("today-row")) {
          cell.cell.styles.fillColor = [22, 104, 220]; cell.cell.styles.textColor = [255, 255, 255];
        }
      },
    });
    bytes = Array.from(new Uint8Array(pdf.output("arraybuffer")));
  } else {
    bytes = Array.from(new TextEncoder().encode(buildHistoryExcelXml(rows, groups)));
  }
  return invoke("save_export", { name: `Veranlagungshistorie.${kind === "pdf" ? "pdf" : "xls"}`, bytes });
}

async function updateAvailable() {
  try {
    const dist = await invoke<Distribution>("distribution_info");
    const metadata = await invoke<any>("update_metadata");
    const latest = dist.store ? latestStoreVersion(metadata, "x64") : typeof metadata?.tag_name === "string" ? metadata.tag_name.replace(/^v/, "") : undefined;
    // A GitHub tag is not proof of an installable, signed Tauri update.
    if (!dist.store && !dist.updaterConfigured) return { available: false };
    return { available: !!latest && compareSemver(latest, dist.version) > 0, latest };
  } catch { return { available: false }; }
}

async function downloadUpdate() {
  const dist = await invoke<Distribution>("distribution_info");
  if (dist.store) {
    await invoke("open_store");
    return { store: true, status: "store-opened" };
  }
  if (!dist.updaterConfigured) return { store: false, status: "error", message: "Signierte Updates sind für diesen Build nicht konfiguriert." };
  try {
    if (pending) { await pending.close(); pending = null; }
    pending = await check();
    if (!pending) { emit("update-status", { status: "up-to-date" }); return { store: false, status: "up-to-date" }; }
    let total = 0, received = 0;
    const version = pending.version;
    emit("update-status", { status: "downloading", version });
    await pending.download(event => {
      if (event.event === "Started") total = event.data.contentLength || 0;
      if (event.event === "Progress") { received += event.data.chunkLength; emit("update-status", { status: "downloading", percent: total ? Math.round(received / total * 100) : undefined }); }
    });
    emit("update-status", { status: "downloaded", version });
    return { store: false, status: "downloaded", version };
  } catch (error) {
    pending = null;
    const message = String(error);
    emit("update-status", { status: "error", message });
    return { store: false, status: "error", message };
  }
}

export const desktopBridge: DesktopBridge = {
  async invoke(channel, ...args) {
    if (channel.startsWith("load-") && documents[channel.slice(5)]) return invoke("read_document", { name: documents[channel.slice(5)] });
    if (channel.startsWith("save-") && documents[channel.slice(5)]) return invoke("write_document", { name: documents[channel.slice(5)], content: args[0] });
    switch (channel) {
      case "export-history-pdf": return exportHistory("pdf", args[0], args[1] || []);
      case "export-history-excel": return exportHistory("excel", args[0], args[1] || []);
      case "create-print-window": return invoke("create_print_window", { html: args[0].content });
      case "check-update-available": return updateAvailable();
      case "check-for-updates":
        if (!downloading) downloading = downloadUpdate().finally(() => { downloading = null; });
        return downloading;
      case "install-update": {
        const dist = await invoke<Distribution>("distribution_info");
        if (dist.store) { await invoke("open_store"); return { ok: true }; }
        if (!pending) return { ok: false };
        try { await pending.install(); await relaunch(); return { ok: true }; }
        catch (error) { emit("update-status", { status: "error", message: String(error) }); return { ok: false }; }
      }
      // Native decorations follow the OS theme; content theme remains under app control.
      case "update-titlebar-overlay": return;
      default: throw new Error(`Unknown desktop operation: ${channel}`);
    }
  },
  send(channel, ...args) { void this.invoke(channel, ...args).catch(fail); },
  on(channel, listener) { if (!listeners.has(channel)) listeners.set(channel, new Set()); listeners.get(channel)!.add(listener); },
  off(channel, listener) { listeners.get(channel)?.delete(listener); },
};

export function initializeDesktop() {
  if (!isTauri()) return;
  window.desktop = desktopBridge;
  document.addEventListener("click", (event) => {
    const anchor = (event.target as Element).closest?.("a[href]");
    const href = anchor?.getAttribute("href");
    if (href?.startsWith("https://")) { event.preventDefault(); void invoke("open_external", { url: href }).catch(fail); }
  });
}

export async function renderPrintPreview() {
  const html = await invoke<string>("print_content");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  // Reports are text + CSS. Never run injected account data as code.
  parsed.querySelectorAll("script,iframe,object,embed,link,meta").forEach(el => el.remove());
  parsed.querySelectorAll("*").forEach(el => Array.from(el.attributes).forEach(attr => {
    if (attr.name.startsWith("on") || ["src", "href"].includes(attr.name)) el.removeAttribute(attr.name);
  }));
  document.head.querySelectorAll("style").forEach(el => el.remove());
  parsed.head.querySelectorAll("style").forEach(el => document.head.append(el));
  document.body.replaceChildren(...Array.from(parsed.body.childNodes));
  const toolbar = document.createElement("div");
  toolbar.className = "print-toolbar";
  const button = document.createElement("button");
  button.textContent = "Drucken";
  button.addEventListener("click", () => { void invoke("print_window").catch(fail); });
  toolbar.append(button);
  document.body.prepend(toolbar);
  const style = document.createElement("style");
  style.textContent = ".print-toolbar{padding:12px;background:white;position:sticky;top:0}.print-toolbar button{padding:8px 24px}@media print{.print-toolbar{display:none}}";
  document.head.append(style);
}
