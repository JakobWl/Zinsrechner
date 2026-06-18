import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import * as fs from "node:fs";

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

  const browserWindowOptions: Electron.BrowserWindowConstructorOptions = {
    title: "Main window",
    autoHideMenuBar: true,
    width: state.width,
    height: state.height,
    icon: path.join(process.env.VITE_PUBLIC, "favicon.ico"),
    webPreferences: {
      preload,
    },
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

function buildHistoryHtml(rows: HistoryRow[]): string {
  const body = rows
    .map((r) => {
      const color =
        r.aenderung === "up"
          ? "#008000"
          : r.aenderung === "down"
            ? "#cc0000"
            : "#333333";
      const arrow =
        r.aenderung === "up" ? " ▲" : r.aenderung === "down" ? " ▼" : "";
      const prozentText = `${r.prozent.toLocaleString("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}%${arrow}`;
      const mengeText = r.menge.toLocaleString("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `<tr>
          <td>${r.datum}</td>
          <td>${escapeXml(r.bankName)}</td>
          <td style="text-align:right">${mengeText}</td>
          <td style="text-align:right;color:${color};font-weight:bold">${prozentText}</td>
          <td>${escapeXml(r.ereignis)}</td>
        </tr>`;
    })
    .join("");
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
</style>
</head>
<body>
  <h1>Chronologische Historie aller Banken</h1>
  <div class="meta">Erstellt am ${generated}</div>
  <table>
    <thead>
      <tr>
        <th style="width:14%">Datum</th>
        <th style="width:30%">Bankname</th>
        <th style="width:20%; text-align:right">Menge (€)</th>
        <th style="width:20%; text-align:right">Prozent</th>
        <th style="width:16%">Ereignis</th>
      </tr>
    </thead>
    <tbody>
      ${body}
    </tbody>
  </table>
</body>
</html>`;
}

function buildHistoryExcelXml(rows: HistoryRow[]): string {
  // SpreadsheetML 2003 XML — opens natively in Microsoft Excel and supports
  // per-cell font colors (green for increase, red for decrease).
  const headerStyle =
    ' ss:StyleID="headerRow"';
  const cells = rows
    .map((r) => {
      const styleId =
        r.aenderung === "up"
          ? "up"
          : r.aenderung === "down"
            ? "down"
            : "normal";
      const prozentText = `${r.prozent.toLocaleString("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}%`;
      const mengeText = r.menge.toLocaleString("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `<Row>
        <Cell${headerStyle}><Data ss:Type="String">${escapeXml(
          r.datum,
        )}</Data></Cell>
        <Cell${headerStyle}><Data ss:Type="String">${escapeXml(
          r.bankName,
        )}</Data></Cell>
        <Cell ss:StyleID="${styleId}"><Data ss:Type="String">${escapeXml(
          mengeText,
        )}</Data></Cell>
        <Cell ss:StyleID="${styleId}"><Data ss:Type="String">${escapeXml(
          prozentText,
        )}</Data></Cell>
        <Cell${headerStyle}><Data ss:Type="String">${escapeXml(
          r.ereignis,
        )}</Data></Cell>
      </Row>`;
    })
    .join("\n");

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
  <Style ss:ID="up">
   <Alignment ss:Horizontal="Right"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#008000"/>
  </Style>
  <Style ss:ID="down">
   <Alignment ss:Horizontal="Right"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#CC0000"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Historie">
  <Table>
   <Column ss:Width="110"/>
   <Column ss:Width="200"/>
   <Column ss:Width="120"/>
   <Column ss:Width="100"/>
   <Column ss:Width="110"/>
   <Row>
    <Cell${headerStyle}><Data ss:Type="String">Datum</Data></Cell>
    <Cell${headerStyle}><Data ss:Type="String">Bankname</Data></Cell>
    <Cell${headerStyle}><Data ss:Type="String">Menge (€)</Data></Cell>
    <Cell${headerStyle}><Data ss:Type="String">Prozent</Data></Cell>
    <Cell${headerStyle}><Data ss:Type="String">Ereignis</Data></Cell>
   </Row>
   ${cells}
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
  async (_, rows: HistoryRow[]): Promise<{ saved: boolean; path?: string }> => {
    const html = buildHistoryHtml(rows);
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
      return await saveHistoryFile("Historie.pdf", pdfBuffer, [
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
  async (_, rows: HistoryRow[]): Promise<{ saved: boolean; path?: string }> => {
    const xml = buildHistoryExcelXml(rows);
    return await saveHistoryFile("Historie.xls", xml, [
      { name: "Excel (XML)", extensions: ["xls"] },
      { name: "XML", extensions: ["xml"] },
    ]);
  },
);

// New window example arg: new windows url
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
