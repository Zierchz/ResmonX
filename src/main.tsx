import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Widget } from "./Widget";
import { ConfirmProvider } from "./components/process/ConfirmProvider";
import { ProcessMenuProvider } from "./components/process/ProcessMenu";
import { Toaster } from "./components/ui/sonner";
import { I18nProvider } from "./lib/i18n";
import "./index.css";

// A second window loads the same bundle with ?view=widget.
const isWidget = new URLSearchParams(window.location.search).get("view") === "widget";
if (isWidget) {
  document.body.style.background = "transparent";
  document.body.classList.add("widget-view");
}

// The widget's process table shares the row menu with the main window, so it
// needs the same providers around it (App wraps its own).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      {isWidget ? (
        <ConfirmProvider>
          <ProcessMenuProvider>
            <Widget />
          </ProcessMenuProvider>
          <Toaster position="bottom-right" />
        </ConfirmProvider>
      ) : (
        <App />
      )}
    </I18nProvider>
  </StrictMode>,
);
