import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Widget } from "./Widget";
import "./index.css";

// A second window loads the same bundle with ?view=widget.
const isWidget = new URLSearchParams(window.location.search).get("view") === "widget";
if (isWidget) document.body.style.background = "transparent";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isWidget ? <Widget /> : <App />}</StrictMode>,
);
