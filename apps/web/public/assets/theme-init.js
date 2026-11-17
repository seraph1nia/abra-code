// Blocking, same-origin entry: resolve theme before styles or application paint.
// Keep the preference semantics aligned with ThemeProvider. No inline CSP exception.
(() => {
  let preference;
  try {
    preference = localStorage.getItem("abra-theme");
  } catch {
    // Storage is optional; the system preference remains available.
  }
  const dark =
    preference === "dark" ||
    (preference !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.classList.toggle("dark", dark);
})();
