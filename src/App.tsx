import React, { useState, useEffect, useCallback } from "react";
import { ConfigProvider, theme } from "antd";
import { AppLayout } from "./AppLayout";

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
      theme={{
        cssVar: true,
        algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <AppLayout isDarkMode={darkMode} setDarkMode={toggleDarkMode} />
    </ConfigProvider>
  );
}

export default App;
