// ClauseGuard theme boot: runs before first paint so the saved theme applies with no flash.
// Plain ES5 script, no modules, no DOM-ready wait. Keep in step with src/ui/theme.ts.
(function () {
  try {
    var value = window.localStorage.getItem("cg-theme");
    var root = document.documentElement;
    if (value === "light" || value === "dark") {
      root.setAttribute("data-theme", value);
    } else {
      root.removeAttribute("data-theme");
    }
  } catch (e) {
    // Storage can throw (private window, blocked site data). Fall back to the device setting.
  }
})();
