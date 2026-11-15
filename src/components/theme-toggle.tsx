"use client";

import { useEffect } from "react";

export function ThemeToggle() {
  useEffect(() => {
    const saved = localStorage.getItem("gallery-theme");
    const enabled = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
  }, []);

  function toggle() {
    const next = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("gallery-theme", next ? "dark" : "light");
  }

  return <button className="quiet-button" onClick={toggle} type="button" aria-label="Alternar tema">
    Alternar tema
  </button>;
}
