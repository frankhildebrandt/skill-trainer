import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RunPicker } from "./RunPicker";
import "./styles.css";
import { I18nProvider } from "./i18n";

if (navigator.userAgent.includes("Macintosh")) document.documentElement.dataset.platform = "mac";

const picker = new URLSearchParams(window.location.search).get("picker") === "runs";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>{picker ? <RunPicker /> : <App />}</I18nProvider>
  </StrictMode>,
);
