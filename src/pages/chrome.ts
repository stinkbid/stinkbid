// Shared page behaviour: solid header after scrolling, the backdrop light, and the contract badge in the footer.
import { ADDR, EXPLORER } from "../../shared/addresses";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const top = document.querySelector(".top");
const onScroll = () => top?.classList.toggle("is-scrolled", window.scrollY > 24);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

const backdrop = document.querySelector<HTMLElement>(".backdrop");
if (backdrop && !reduceMotion && window.matchMedia("(pointer: fine)").matches) {
  window.addEventListener("pointermove", (e) => {
    backdrop.style.setProperty("--mx", `${e.clientX}px`);
    backdrop.style.setProperty("--my", `${e.clientY}px`);
    backdrop.style.setProperty("--glow", "1");
  }, { passive: true });
  document.addEventListener("pointerleave", () => backdrop.style.setProperty("--glow", "0"));
}

document.querySelectorAll<HTMLAnchorElement>("[data-contract-link]").forEach((a) => {
  a.href = `${EXPLORER}/address/${ADDR.stinkbid}`;
});
document.querySelectorAll<HTMLElement>("[data-contract]").forEach((el) => {
  el.textContent = ADDR.stinkbid;
});

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;
export const explorerAddr = (a: string) => `${EXPLORER}/address/${a}`;
