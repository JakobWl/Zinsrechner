(() => {
  const startup = document.getElementById("startup");
  if (!startup) return;
  if (window.location.hash === "#print") {
    startup.remove();
    return;
  }

  const theme = localStorage.getItem("themeMode");
  if (theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    startup.dataset.theme = "dark";
  }

  const appWindow = window.__TAURI__?.window.getCurrentWindow();
  const controls = startup.querySelector(".startup-controls");
  if (!appWindow) {
    controls.remove();
    return;
  }

  const run = (action) => void action.catch((error) => console.error(error));
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button && controls.contains(button)) run(appWindow[button.dataset.action]());
  });
  startup.querySelector(".startup-header").addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();
    run(event.detail === 2 ? appWindow.toggleMaximize() : appWindow.startDragging());
  });
})();