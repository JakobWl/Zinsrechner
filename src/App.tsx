import React, { useCallback, useEffect, useState } from "react";
import { App as AntApp, ConfigProvider, theme } from "antd";
import deDE from "antd/locale/de_DE";
import dayjs from "dayjs";
import "dayjs/locale/de";
import { AppLayout } from "./AppLayout";

dayjs.locale("de");

function App() {
  const [darkMode, setDarkMode] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => !prev);
  }, []);

  useEffect(() => {
    const windowQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const darkModeChange = (event: MediaQueryListEvent) => {
      setDarkMode(event.matches);
    };

    windowQuery.addEventListener("change", darkModeChange);
    return () => {
      windowQuery.removeEventListener("change", darkModeChange);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
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
        <AppLayout isDarkMode={darkMode} onToggleDarkMode={toggleDarkMode} />
      </AntApp>
    </ConfigProvider>
  );
}

export default App;
