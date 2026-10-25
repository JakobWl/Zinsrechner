import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import "./index.less";
import { initializeDesktop, renderPrintPreview } from "./desktop/bridge";

initializeDesktop();

if (window.location.hash === "#print") {
  void renderPrintPreview();
} else {
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

postMessage({ payload: "removeLoading" }, "*");

}
