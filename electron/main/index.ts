import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import * as fs from "node:fs";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater as typeof import("electron-updater");

createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, "../..");

export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

// Microsoft Store (AppX) packages are installed under WindowsApps and cannot
// be self-updated by electron-updater — the Store handles updates. We detect
// that case so the "Aktualisieren" button opens the Store's updates page.
function isMicrosoftStoreInstall(): boolean {
  try {
    if (process.platform !== "win32") return false;
    // AppX apps run from C:\Program Files\WindowsApps\<identity>\
    const exePath = app.getPath("exe");
    if (exePath && exePath.toLowerCase().includes("windowsapps")) return true;
    // The packaged app resources live under WindowsApps as well.
    if (process.resourcesPath &&
        process.resourcesPath.toLowerCase().includes("windowsapps")) {
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

// ---- Update availability check (shared by Store + NSIS builds) ----
// The Microsoft Store package cannot be queried for available updates from
// inside the sandboxed AppX process, and electron-updater does not run for
// Store builds. Instead we compare the running app version against the latest
// GitHub release tag (the Store version always mirrors the GitHub release
// version, since both are published from the same package.json version). This
// lets the renderer show the "Aktualisieren" button ONLY when a newer version
// actually exists, for both Store and NSIS installs.
const GITHUB_OWNER = "JakobWl";
const GITHUB_REPO = "Zinsrechner";

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function fetchLatestGithubRelease(): Promise<{ tag: string } | null> {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: "api.github.com",
        path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        headers: { "User-Agent": "Zinsrechner-Updater", Accept: "application/vnd.github+json" },
        timeout: 8000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              const json = JSON.parse(body);
              resolve(json && json.tag_name ? { tag: json.tag_name } : null);
            } catch {
              resolve(null);
            }
          });
        } else {
          res.resume();
          resolve(null);
        }
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

// Returns { available: boolean, latest?: string } so the renderer can decide
// whether to render the "Aktualisieren" button at all.
ipcMain.handle("check-update-available", async (): Promise<{
  available: boolean;
  latest?: string;
}> => {
  const release = await fetchLatestGithubRelease();
  if (!release || !release.tag) return { available: false };
  const current = app.getVersion();
  const latest = release.tag.replace(/^v/, "");
  return { available: compareSemver(latest, current) > 0, latest };
});

// ---- Auto-updater (NSIS / GitHub release builds) ----
// For non-Store builds we delegate to electron-updater, which reads the
// provider config baked into app-update.yml at build time.
let updaterEventsBound = false;
function bindUpdaterEvents() {
  if (updaterEventsBound) return;
  updaterEventsBound = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) => {
    win?.webContents.send("update-status", {
      status: "downloading",
      version: info.version,
    });
  });
  autoUpdater.on("update-not-available", () => {
    win?.webContents.send("update-status", { status: "up-to-date" });
  });
  autoUpdater.on("update-downloaded", () => {
    win?.webContents.send("update-status", { status: "downloaded" });
  });
  autoUpdater.on("error", (err) => {
    win?.webContents.send("update-status", {
      status: "error",
      message: err?.message ?? String(err),
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    win?.webContents.send("update-status", {
      status: "downloading",
      percent: Math.round(progress.percent),
    });
  });
}

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith("6.1")) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === "win32") app.setAppUserModelId(app.getName());

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win: BrowserWindow | null = null;
const preload = path.join(__dirname, "../preload/index.mjs");
const indexHtml = path.join(RENDERER_DIST, "index.html");

// ---- Window state persistence ----
// Stores the last window position/size and maximized state so that the app
// reopens exactly where the user left it (like a normal Windows program).
// On first launch (no stored state) the window opens maximized (fullscreen-like).
const windowStateFile = path.join(app.getPath("userData"), "window-state.json");

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
  firstLaunch: boolean;
}

const defaultWindowState: WindowState = {
  width: 1600,
  height: 800,
  maximized: true, // default to maximized on first launch
  firstLaunch: true,
};

function loadWindowState(): WindowState {
  try {
    if (!fs.existsSync(windowStateFile)) return { ...defaultWindowState };
    const raw = fs.readFileSync(windowStateFile, "utf8");
    const parsed = JSON.parse(raw) as WindowState;
    return {
      ...defaultWindowState,
      ...parsed,
      firstLaunch: false,
    };
  } catch {
    return { ...defaultWindowState };
  }
}

let saveStateTimeout: NodeJS.Timeout | null = null;
function saveWindowStateDebounced() {
  if (!win) return;
  if (saveStateTimeout) clearTimeout(saveStateTimeout);
  saveStateTimeout = setTimeout(() => {
    try {
      const maximized = win?.isMaximized() ?? false;
      const bounds = win?.getNormalBounds() ?? win?.getBounds();
      if (!bounds) return;
      const state: WindowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized,
        firstLaunch: false,
      };
      fs.writeFileSync(windowStateFile, JSON.stringify(state, null, 2), "utf8");
    } catch (error) {
      console.error("Error saving window state:", error);
    }
  }, 400);
}

async function createWindow() {
  const state = loadWindowState();

  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  const browserWindowOptions: Electron.BrowserWindowConstructorOptions = {
    title: "Zinsrechner",
    autoHideMenuBar: true,
    width: state.width,
    height: state.height,
    icon: path.join(process.env.VITE_PUBLIC, "favicon.ico"),
    webPreferences: {
      preload,
    },
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac ? {} : { frame: false }),
    ...(isWindows
      ? {
          titleBarOverlay: {
            height: 58,
            color: "#ffffff",
            symbolColor: "#333333",
          },
        }
      : {}),
  };
  // Only restore position when it is a sane value (within a screen).
  if (
    typeof state.x === "number" &&
    typeof state.y === "number" &&
    Number.isFinite(state.x) &&
    Number.isFinite(state.y)
  ) {
    browserWindowOptions.x = state.x;
    browserWindowOptions.y = state.y;
  }

  win = new BrowserWindow(browserWindowOptions);

  // Maximize on first launch OR if the user last left it maximized.
  if (state.firstLaunch || state.maximized) {
    win.maximize();
  }

  // Persist window state whenever it changes (move/resize/maximize/restore).
  win.on("resize", saveWindowStateDebounced);
  win.on("move", saveWindowStateDebounced);
  win.on("maximize", saveWindowStateDebounced);
  win.on("unmaximize", saveWindowStateDebounced);
  win.on("close", () => {
    if (saveStateTimeout) clearTimeout(saveStateTimeout);
    try {
      const maximized = win?.isMaximized() ?? false;
      const bounds = win?.getNormalBounds() ?? win?.getBounds();
      if (bounds) {
        const finalState: WindowState = {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          maximized,
          firstLaunch: false,
        };
        fs.writeFileSync(
          windowStateFile,
          JSON.stringify(finalState, null, 2),
          "utf8",
        );
      }
    } catch (error) {
      console.error("Error saving window state on close:", error);
    }
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(indexHtml);
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  win = null;
  if (process.platform !== "darwin") app.quit();
});

app.on("second-instance", () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("activate", () => {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length) {
    allWindows[0].focus();
  } else {
    createWindow();
  }
});

ipcMain.on("update-titlebar-overlay", (_event, isDark: boolean) => {
  if (win && process.platform === "win32") {
    win.setTitleBarOverlay({
      color: isDark ? "#141414" : "#ffffff",
      symbolColor: isDark ? "#f2f2f2" : "#333333",
    });
  }
});

ipcMain.handle("load-data", async () => {
  try {
    const userDataPath = app.getPath("userData"); // Get user data directory
    const filePath = path.join(userDataPath, "konten.json"); // Construct full file path
    if (!fs.existsSync(filePath)) {
      return "[]"; // Return an empty array if file does not exist
    }
    return fs.readFileSync(filePath, "utf8"); // Read and return the file content
  } catch (error) {
    console.error("Error loading data:", error);
    return "[]"; // Return an empty array on error
  }
});

ipcMain.on("save-data", (event, data) => {
  try {
    const userDataPath = app.getPath("userData"); // Get user data directory
    const filePath = path.join(userDataPath, "konten.json"); // Construct full file path
    fs.writeFileSync(filePath, data, "utf8"); // Save data to the file
  } catch (error) {
    console.error("Error saving data:", error);
  }
});

ipcMain.handle("load-history-groups", async () => {
  try {
    const userDataPath = app.getPath("userData");
    const filePath = path.join(userDataPath, "history-groups.json");
    if (!fs.existsSync(filePath)) return "[]";
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.error("Error loading history groups:", error);
    return "[]";
  }
});

ipcMain.on("save-history-groups", (_, data) => {
  try {
    const userDataPath = app.getPath("userData");
    const filePath = path.join(userDataPath, "history-groups.json");
    fs.writeFileSync(filePath, data, "utf8");
  } catch (error) {
    console.error("Error saving history groups:", error);
  }
});

ipcMain.on("create-print-window", (event, data) => {
  let printWindow = new BrowserWindow({
    width: 1000,
    height: 600,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load the HTML content provided by the renderer process
  printWindow.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(data.content),
  );

  const printOptions = {
    silent: false,
    printBackground: true,
    color: true,
    margin: {
      marginType: "printableArea",
    },
    landscape: false,
    pagesPerSheet: 1,
    collate: false,
    copies: 1,
    header: "Page header",
    footer: "Page footer",
  };

  // Wait until the content is loaded, then print
  printWindow.webContents.on("did-finish-load", () => {
    const printRootId = "print-root";
    printWindow.webContents.send("print-window-ready", printRootId);
    printWindow.webContents.print(printOptions, (success, failureReason) => {
      if (!success) {
        console.error("Print failed:", failureReason);
      }
      // Close the print window after printing
      printWindow.close();
    });
  });
});

// ---- Chronological history export ----
// The renderer sends an array of history rows (sorted by date) and we produce
// either a PDF (via a hidden BrowserWindow + printToPDF) or an Excel-compatible
// SpreadsheetML 2003 XML file. Percentage changes are shown in green (increase)
// or red (decrease).
interface HistoryGroup {
  name: string;
  banks: string[];
}

interface HistoryRow {
  datum: string; // DD.MM.YYYY
  bankName: string;
  menge: number; // nominal amount
  prozent: number; // interest rate
  ereignis: string; // e.g. "Eröffnung" / "Ablauf"
  aenderung: "up" | "down" | "none"; // change vs previous entry for same bank
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildHistoryHtml(rows: HistoryRow[], groups: HistoryGroup[]): string {
  const hasGroups = groups.length > 0;
  const veranlagungCols = hasGroups
    ? groups.map((g) => g.name)
    : ["Betrag"];

  // Compute today's date string and find insertion point
  const todayStr = new Date().toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
  // Parse DD.MM.YYYY to comparable value
  const parseDatum = (d: string) => {
    const [day, month, year] = d.split(".");
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  };
  const todayTime = parseDatum(todayStr);

  // Compute running totals to find sum at today
  let todaySumTotal = 0;
  const todayGroupSums: Record<string, number> = {};
  if (hasGroups) groups.forEach((g) => (todayGroupSums[g.name] = 0));
  let todayRowInserted = false;

  const body = rows
    .map((r, idx) => {
      // Update running totals
      if (r.ereignis === "Eröffnung") {
        todaySumTotal += r.menge;
        if (hasGroups) {
          groups.forEach((g) => {
            if (g.banks.includes(r.bankName)) todayGroupSums[g.name] += r.menge;
          });
        }
      }
      if (r.ereignis === "Ablauf") {
        todaySumTotal -= r.menge;
        if (hasGroups) {
          groups.forEach((g) => {
            if (g.banks.includes(r.bankName)) todayGroupSums[g.name] -= r.menge;
          });
        }
      }

      const mengeText = r.menge.toLocaleString("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      const groupCells = hasGroups
        ? groups
            .map((g) => {
              const val =
                r.ereignis === "Eröffnung" && g.banks.includes(r.bankName)
                  ? mengeText
                  : "";
              return `<td style="text-align:right">${val}</td>`;
            })
            .join("")
        : `<td style="text-align:right">${r.ereignis === "Eröffnung" ? mengeText : ""}</td>`;

      const ablaufCell = `<td style="text-align:right;background:#f5f5f5">${r.ereignis === "Ablauf" ? mengeText : ""}</td>`;

      const row = `<tr>
          <td>${r.datum}</td>
          <td>${escapeXml(r.bankName)}</td>
          ${groupCells}
          ${ablaufCell}
        </tr>`;

      // Check if we need to insert the today summary row after this row
      let todayRow = "";
      if (!todayRowInserted) {
        const currentTime = parseDatum(r.datum);
        const nextTime = idx < rows.length - 1 ? parseDatum(rows[idx + 1].datum) : Infinity;
        if (currentTime <= todayTime && nextTime > todayTime) {
          todayRowInserted = true;
          const sumText = todaySumTotal.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const todayGroupCells = hasGroups
            ? groups.map((g) => {
                const val = todayGroupSums[g.name].toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return `<td style="text-align:right;color:#fff;font-weight:bold">${val}</td>`;
              }).join("")
            : `<td style="text-align:right;color:#fff;font-weight:bold">${sumText}</td>`;
          todayRow = `<tr style="background:#1677ff !important;color:#fff;font-weight:bold">
            <td style="color:#fff;font-weight:bold">${todayStr}</td>
            <td style="color:#fff;font-weight:bold">⟶ Summe heute</td>
            ${todayGroupCells}
            <td style="text-align:right;color:#fff;font-weight:bold">${sumText}</td>
          </tr>`;
        }
      }

      return row + todayRow;
    })
    .join("");

  // If today is after all rows, append summary at end
  let todayAppendRow = "";
  if (!todayRowInserted && rows.length > 0) {
    const sumText = todaySumTotal.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const todayGroupCells = hasGroups
      ? groups.map((g) => {
          const val = todayGroupSums[g.name].toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return `<td style="text-align:right;color:#fff;font-weight:bold">${val}</td>`;
        }).join("")
      : `<td style="text-align:right;color:#fff;font-weight:bold">${sumText}</td>`;
    todayAppendRow = `<tr style="background:#1677ff !important;color:#fff;font-weight:bold">
      <td style="color:#fff;font-weight:bold">${todayStr}</td>
      <td style="color:#fff;font-weight:bold">⟶ Summe heute</td>
      ${todayGroupCells}
      <td style="text-align:right;color:#fff;font-weight:bold">${sumText}</td>
    </tr>`;
  }

  const colCount = 2 + veranlagungCols.length + 1;
  const colWidth = Math.floor(56 / (veranlagungCols.length + 1));

  const generated = new Date().toLocaleString("de-AT");
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>Chronologische Historie</title>
<style>
  body, html { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
  h1 { text-align: center; margin-bottom: 4px; }
  .meta { text-align: center; color: #666; margin-bottom: 20px; font-size: 0.9em; }
  table { width: 100%; border-collapse: collapse; }
  table, th, td { border: 1px solid #ddd; }
  th { background-color: #f2f2f2; padding: 10px; text-align: left; }
  td { padding: 8px 10px; }
  tr:nth-child(even) { background-color: #f9f9f9; }
  .group-header { text-align: center; font-weight: bold; }
</style>
</head>
<body>
  <h1>Chronologische Historie aller Veranlagungen</h1>
  <div class="meta">Erstellt am ${generated}</div>
  <table>
    <thead>
      <tr>
        <th rowspan="2" style="width:12%">Datum</th>
        <th rowspan="2" style="width:30%">Bankname</th>
        <th colspan="${veranlagungCols.length + 1}" class="group-header" style="text-align:center">Veranlagung (€)</th>
      </tr>
      <tr>
        ${veranlagungCols.map((c) => `<th style="width:${colWidth}%; text-align:right">${escapeXml(c)}</th>`).join("")}
        <th style="width:${58 - veranlagungCols.length * colWidth}%; text-align:right; background:#f5f5f5">Ablauf</th>
      </tr>
    </thead>
    <tbody>
      ${body}${todayAppendRow}
    </tbody>
  </table>
</body>
</html>`;
}

function buildHistoryExcelXml(rows: HistoryRow[], groups: HistoryGroup[]): string {
  const hasGroups = groups.length > 0;
  const veranlagungCols = hasGroups ? groups.map((g) => g.name) : ["Betrag"];
  const headerStyle = ' ss:StyleID="headerRow"';

  const parseDatumExcel = (d: string) => {
    const [day, month, year] = d.split(".");
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  };
  const todayStrExcel = new Date().toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
  const todayTimeExcel = parseDatumExcel(todayStrExcel);
  let excelSum = 0;
  const excelGroupSums: Record<string, number> = {};
  if (hasGroups) groups.forEach((g) => (excelGroupSums[g.name] = 0));
  let excelTodayInserted = false;

  const cells = rows
    .map((r, idx) => {
      if (r.ereignis === "Eröffnung") {
        excelSum += r.menge;
        if (hasGroups) groups.forEach((g) => { if (g.banks.includes(r.bankName)) excelGroupSums[g.name] += r.menge; });
      }
      if (r.ereignis === "Ablauf") {
        excelSum -= r.menge;
        if (hasGroups) groups.forEach((g) => { if (g.banks.includes(r.bankName)) excelGroupSums[g.name] -= r.menge; });
      }

      const mengeText = r.menge.toLocaleString("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      const groupCells = hasGroups
        ? groups
            .map((g) => {
              const val =
                r.ereignis === "Eröffnung" && g.banks.includes(r.bankName)
                  ? mengeText
                  : "";
              return `<Cell ss:StyleID="normal"><Data ss:Type="String">${escapeXml(val)}</Data></Cell>`;
            })
            .join("\n        ")
        : `<Cell ss:StyleID="normal"><Data ss:Type="String">${escapeXml(r.ereignis === "Eröffnung" ? mengeText : "")}</Data></Cell>`;

      const ablaufVal = r.ereignis === "Ablauf" ? mengeText : "";

      let row = `<Row>
        <Cell${headerStyle}><Data ss:Type="String">${escapeXml(r.datum)}</Data></Cell>
        <Cell${headerStyle}><Data ss:Type="String">${escapeXml(r.bankName)}</Data></Cell>
        ${groupCells}
        <Cell ss:StyleID="ablauf"><Data ss:Type="String">${escapeXml(ablaufVal)}</Data></Cell>
      </Row>`;

      // Insert today summary row
      if (!excelTodayInserted) {
        const currentTime = parseDatumExcel(r.datum);
        const nextTime = idx < rows.length - 1 ? parseDatumExcel(rows[idx + 1].datum) : Infinity;
        if (currentTime <= todayTimeExcel && nextTime > todayTimeExcel) {
          excelTodayInserted = true;
          const sumText = excelSum.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const todayGroupCells = hasGroups
            ? groups.map((g) => {
                const val = excelGroupSums[g.name].toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return `<Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(val)}</Data></Cell>`;
              }).join("\n        ")
            : `<Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(sumText)}</Data></Cell>`;
          row += `\n      <Row>
        <Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(todayStrExcel)}</Data></Cell>
        <Cell ss:StyleID="todayRow"><Data ss:Type="String">\u27f6 Summe heute</Data></Cell>
        ${todayGroupCells}
        <Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(sumText)}</Data></Cell>
      </Row>`;
        }
      }

      return row;
    })
    .join("\n");

  // Append if today is after all rows
  let excelTodayAppendRow = "";
  if (!excelTodayInserted && rows.length > 0) {
    const sumText = excelSum.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const todayGroupCells = hasGroups
      ? groups.map((g) => {
          const val = excelGroupSums[g.name].toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return `<Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(val)}</Data></Cell>`;
        }).join("\n        ")
      : `<Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(sumText)}</Data></Cell>`;
    excelTodayAppendRow = `\n      <Row>
      <Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(todayStrExcel)}</Data></Cell>
      <Cell ss:StyleID="todayRow"><Data ss:Type="String">\u27f6 Summe heute</Data></Cell>
      ${todayGroupCells}
      <Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(sumText)}</Data></Cell>
    </Row>`;
  }

  const columns = [
    '<Column ss:Width="110"/>',
    '<Column ss:Width="200"/>',
    ...veranlagungCols.map(() => '<Column ss:Width="140"/>'),
    '<Column ss:Width="140"/>',
  ].join("\n   ");

  const headerCells = [
    `<Cell${headerStyle}><Data ss:Type="String">Datum</Data></Cell>`,
    `<Cell${headerStyle}><Data ss:Type="String">Bankname</Data></Cell>`,
    ...veranlagungCols.map(
      (c) => `<Cell${headerStyle}><Data ss:Type="String">${escapeXml(c)}</Data></Cell>`,
    ),
    `<Cell${headerStyle}><Data ss:Type="String">Ablauf</Data></Cell>`,
  ].join("\n    ");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#333333"/>
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="headerRow">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#333333"/>
   <Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DDDDDD"/>
   </Borders>
  </Style>
  <Style ss:ID="normal">
   <Alignment ss:Horizontal="Right"/>
  </Style>
  <Style ss:ID="ablauf">
   <Alignment ss:Horizontal="Right"/>
   <Interior ss:Color="#F5F5F5" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="todayRow">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1677FF" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Historie">
  <Table>
   ${columns}
   <Row>
    ${headerCells}
   </Row>
   ${cells}${excelTodayAppendRow}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <Selected/>
   <Panes><Pane><Number>3</Number></Pane></Panes>
   <ProtectObjects>False</ProtectObjects>
   <ProtectScenarios>False</ProtectScenarios>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

async function saveHistoryFile(
  defaultName: string,
  content: string | Buffer,
  filters: Electron.FileFilter[],
): Promise<{ saved: boolean; path?: string }> {
  if (!win) return { saved: false };
  const result = await dialog.showSaveDialog(win, {
    title: "Historie speichern",
    defaultPath: path.join(app.getPath("documents"), defaultName),
    filters,
  });
  if (result.canceled || !result.filePath) return { saved: false };
  fs.writeFileSync(result.filePath, content);
  return { saved: true, path: result.filePath };
}

ipcMain.handle(
  "export-history-pdf",
  async (_, rows: HistoryRow[], groups: HistoryGroup[] = []): Promise<{ saved: boolean; path?: string }> => {
    const html = buildHistoryHtml(rows, groups);
    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true },
    });
    try {
      await pdfWindow.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
      const pdfBuffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        landscape: false,
        margins: { marginType: "default" },
      });
      return await saveHistoryFile("Veranlagungshistorie.pdf", pdfBuffer, [
        { name: "PDF", extensions: ["pdf"] },
      ]);
    } catch (error) {
      console.error("Error generating PDF:", error);
      return { saved: false };
    } finally {
      pdfWindow.destroy();
    }
  },
);

ipcMain.handle(
  "export-history-excel",
  async (_, rows: HistoryRow[], groups: HistoryGroup[] = []): Promise<{ saved: boolean; path?: string }> => {
    const xml = buildHistoryExcelXml(rows, groups);
    return await saveHistoryFile("Veranlagungshistorie.xls", xml, [
      { name: "Excel (XML)", extensions: ["xls"] },
      { name: "XML", extensions: ["xml"] },
    ]);
  },
);

// New window example arg: new windows url
// ---- Update handling (Aktualisieren button) ----
// The renderer calls "check-for-updates" when the user clicks "Aktualisieren".
// Store builds open the Microsoft Store updates page; NSIS builds use
// electron-updater to check + download, then the renderer triggers install.
ipcMain.handle("check-for-updates", async (): Promise<{
  store: boolean;
  status: string;
  version?: string;
  message?: string;
}> => {
  if (isMicrosoftStoreInstall()) {
    // Open the Store's "Downloads and updates" page so the user can pull the
    // latest version published via Partner Center.
    shell.openExternal("ms-windows-store://downloadsandupdates");
    return { store: true, status: "store-opened" };
  }
  try {
    bindUpdaterEvents();
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo) {
      return { store: false, status: "up-to-date" };
    }
    return {
      store: false,
      status: "available",
      version: result.updateInfo.version,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { store: false, status: "error", message };
  }
});

ipcMain.handle("install-update", async (): Promise<{ ok: boolean }> => {
  try {
    if (isMicrosoftStoreInstall()) {
      shell.openExternal("ms-windows-store://downloadsandupdates");
      return { ok: true };
    }
    // quitAndInstall restarts the app and applies the downloaded update.
    autoUpdater.quitAndInstall();
    return { ok: true };
  } catch (error) {
    console.error("Error installing update:", error);
    return { ok: false };
  }
});

ipcMain.handle("open-win", (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`);
  } else {
    childWindow.loadFile(indexHtml, { hash: arg });
  }
});
