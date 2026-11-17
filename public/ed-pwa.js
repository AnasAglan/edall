(() => {
  "use strict";
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(registration => {
      registration.update().catch(() => {});
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            if (typeof window.showToast === "function") {
              window.showToast(
                document.documentElement.lang === "ar"
                  ? "يتوفر تحديث جديد للمنصة. أعد تحميل الصفحة لتطبيقه."
                  : "A platform update is available. Reload to apply it.",
                "info"
              );
            }
          }
        });
      });
    }).catch(error => console.warn("ED-ALL PWA registration failed", error));
  });
})();
