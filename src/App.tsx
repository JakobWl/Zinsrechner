import React, { useState, useEffect, useCallback } from "react";
import { App as AntApp, ConfigProvider, theme } from "antd";
import deDE from "antd/locale/de_DE";
import dayjs from "dayjs";
import "dayjs/locale/de";
import { AppLayout } from "./AppLayout";

dayjs.locale("de");

function App() {
  const [darkMode, setDarkMode] = useState(false);
  const windowQuery = window.matchMedia("(prefers-color-scheme:dark)");

  const darkModeChange = useCallback((event: MediaQueryListEvent) => {
    console.log(event.matches);
    setDarkMode(event.matches);
  }, []);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => !prev);
  }, []);

  useEffect(() => {
    windowQuery.addEventListener("change", darkModeChange);
    return () => {
      windowQuery.removeEventListener("change", darkModeChange);
    };
  }, [windowQuery, darkModeChange]);

  useEffect(() => {
    setDarkMode(windowQuery.matches);
  }, []);

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
            borderRadiusLG: 12,
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
        <AppLayout isDarkMode={darkMode} setDarkMode={toggleDarkMode} />
      </AntApp>
    </ConfigProvider>
  );
}

export default App;