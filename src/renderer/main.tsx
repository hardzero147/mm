import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Apply saved theme before first render to prevent flash of wrong theme
try {
  const saved = localStorage.getItem("pm-theme");
  if (saved === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  }
} catch {
  // ignore — localStorage unavailable
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
