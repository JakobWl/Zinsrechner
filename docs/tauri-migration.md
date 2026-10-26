# Tauri desktop migration

The active desktop runtime is Tauri 2. React, the calculation engines, forecast rules, and report table generation remain TypeScript. `src/desktop/bridge.ts` implements the UI desktop operations; `src-tauri/src` provides native storage, dialogs, windows, and Store integration. The Electron runtime source, preload bridge, builder configurations, baseline launcher, and editor tasks have been removed. Development, packaging, and release workflows use Tauri only. Legacy profile import remains supported without an Electron dependency.

## Development and validation

Install Node.js 22, Rust (minimum 1.90), and the Tauri platform build prerequisites. On Windows, install the C++ build tools and WebView2 runtime. On Linux, install WebKitGTK 4.1 development libraries.

```sh
npm ci --include=dev
npm run dev
npm test
npm run test:rust
npm run build:web
npx playwright install chromium
npm run test:e2e
npm run tauri -- build --debug --no-bundle --features e2e
cargo install tauri-driver --locked
```

Native tests require tauri-driver plus WebKitWebDriver on Linux or a matching msedgedriver on Windows. Set `TAURI_DRIVER` and `NATIVE_WEBDRIVER` to their executable paths. Run `xvfb-run -a npm run test:native` on headless Linux, or `npm run test:native` on Windows. Native artifacts are saved under `.jait/artifacts/native`; browser reports under `.jait/artifacts/playwright-report`; screenshots under `.jait/shots`.

The Linux job is the blocking native gate: it drives the compiled binary and the real WebKit webview over the same Tauri commands the Windows build uses. On hosted `windows-latest` the msedgedriver session cannot be created because the runner provides no interactive WebView2 desktop, so it fails with `DevToolsActivePort file doesn't exist` before any application assertion executes. That job therefore runs the suite as an advisory result and additionally performs a direct startup smoke test: it launches the built executable, requires it to stay alive for 15 seconds, and fails the job if the process exits early. Run `npm run test:native` on a real Windows desktop to obtain the actual Windows WebDriver result.

The `e2e` feature permits isolated storage and export destinations and a local Store catalog fixture. Release builds must omit it. Tests cover calculations, account edits, forecast persistence, groups, charts, themes, PDF and SpreadsheetML exports, cancellation, resizing, print previews, Store availability, and corrupt-data protection. Native tests exercise the compiled Rust bridge and real system webview. OS print dialogs, installed-package upgrades, and a signed updater installation need release validation on Windows.

## Release acceptance

The migration preserves the application features through a Rust desktop backend and the existing React/TypeScript UI and calculation engines. It is not a rewrite of the calculation engines in Rust. Native window decorations follow the operating system theme.

Before publishing the first Windows release:

- Confirm the Windows startup smoke test passes in the verification job, and run `npm run test:native` on a real Windows desktop for the full WebView2 suite.
- Install the NSIS package on Windows and check save dialogs and the physical print dialog.
- Upgrade an existing Electron Store installation using the AppX, confirming that accounts, forecast settings, and history groups survive.
- With signing configured, install a signed update from an older Tauri version and confirm restart and data persistence.
- Confirm that the release package version exceeds the version already published in the Store.

A successful Linux native suite or cross-compiled Windows executable does not complete these installation checks.

## Existing data

On first launch, the app copies `konten.json`, `prognose.json`, and `history-groups.json` from the existing Electron profile to Tauri's application data directory. Existing Tauri documents take precedence. Original Electron files remain intact, corrupt profiles produce an error, and writes retain a `.bak` copy. Electron window size is imported when no saved Tauri window state exists.

The old Chromium localStorage database is not imported. Users may need to select their theme again after migration; subsequent theme choices persist in the system webview.

## Windows distribution

`npm run build` creates a compact NSIS installer; `npm run build:store` creates the AppX using the existing Store identity. See [Microsoft Store submission](microsoft-store.md). Windows packaging and installation require Windows validation; a Linux native test cannot prove those paths.

For standalone automatic updates, configure repository variable `TAURI_UPDATER_PUBLIC_KEY` and secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The release workflow merges an updater configuration, signs the installer, and publishes `latest.json` plus its signature. Without keys, the installer builds with automatic updates disabled. Keep signing keys outside source control.

Existing Electron standalone installations require a one-time installation of the Tauri installer; the Electron update feed and Tauri signed update format are different. Store installations keep the existing package identity and update through Microsoft Store. Validate upgrading a real Electron Store installation before publishing the first Tauri version. Increase the package version above the published Store version for that release.
