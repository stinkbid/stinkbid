import "../landing/landing.css";
import "./pages.css";
import "./chrome";

// Copy buttons next to addresses.
document.querySelectorAll<HTMLButtonElement>("button[data-copy]").forEach((b) => {
  b.addEventListener("click", async () => {
    await navigator.clipboard.writeText(b.dataset.copy!).catch(() => {});
    const was = b.textContent;
    b.textContent = "Copied";
    setTimeout(() => (b.textContent = was), 1400);
  });
});
