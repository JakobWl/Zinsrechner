import React, { useCallback, useEffect, useState } from "react";
import { App as AntApp, ConfigProvider, theme } from "antd";
import deDE from "antd/locale/de_DE";
import dayjs from "dayjs";
import "dayjs/locale/de";
import { AppLayout } from "./AppLayout";

dayjs.locale("de");

type ThemeMode = "system" | "light" | "dark";

function getSystemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem("themeMode");
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    return "system";
  });

  const darkMode = themeMode === "dark" || (themeMode === "system" && getSystemDark());
  const [, forceUpdate] = useState(0);

  const handleThemeModeChange = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    localStorage.setItem("themeMode", mode);
  }, []);

  useEffect(() => {
    if (themeMode !== "system") return;
    const windowQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => forceUpdate((n) => n + 1);
    windowQuery.addEventListener("change", onChange);
    return () => windowQuery.removeEventListener("change", onChange);
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
    if (window.ipcRenderer) {
      window.ipcRenderer.send("update-titlebar-overlay", darkMode);
    }
  }, [darkMode]);

  return (
    <ConfigProvider
      locale={deDE}
      theme={{
        cssVar: true,
        algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: "#1668dc",
          colorInfo: "#1668dc",
          borderRadius: 8,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          controlHeight: 36,
        },
        components: {
          Layout: {
            headerBg: darkMode ? "#141414" : "#ffffff",
            headerHeight: 60,
            headerPadding: "0 24px",
            bodyBg: darkMode ? "#0f1115" : "#f5f7fa",
          },
          Card: {
            borderRadiusLG: 8,
            headerHeight: 52,
          },
          Button: { controlHeight: 36 },
          Input: { controlHeight: 36 },
          InputNumber: { controlHeight: 36 },
          Select: { controlHeight: 36 },
        },
      }}
    >
      <AntApp>
        <AppLayout isDarkMode={darkMode} themeMode={themeMode} onThemeModeChange={handleThemeModeChange} />
      </AntApp>
    </ConfigProvider>
  );
}

export default App;
