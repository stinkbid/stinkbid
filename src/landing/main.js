import "./landing.css";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Header turns solid once the hero scrolls away; the hero image eases from a slight zoom as you scroll.
const top = document.querySelector(".top");
const hero = document.querySelector(".hero");
const backdrop = document.querySelector(".backdrop");
function onScroll() {
  const y = window.scrollY;
  top?.classList.toggle("is-scrolled", y > 40);
  if (hero && !reduceMotion) {
    const p = Math.min(1, y / Math.max(1, hero.offsetHeight));
    hero.style.setProperty("--p", p.toFixed(3));
    const doc = document.documentElement;
    const bp = Math.min(1, y / Math.max(1, doc.scrollHeight - innerHeight));
    backdrop?.style.setProperty("--bp", bp.toFixed(3));
  }
}
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Faint bid-red light follows a mouse pointer (not on touch, not with reduced motion).
if (backdrop && !reduceMotion && window.matchMedia("(pointer: fine)").matches) {
  window.addEventListener("pointermove", (e) => {
    backdrop.style.setProperty("--mx", `${e.clientX}px`);
    backdrop.style.setProperty("--my", `${e.clientY}px`);
    backdrop.style.setProperty("--glow", "1");
  }, { passive: true });
  document.addEventListener("pointerleave", () => backdrop.style.setProperty("--glow", "0"));
}

// Sections fade up once when they enter the viewport.
const revealables = document.querySelectorAll(".statement > *:not(img), .level-copy > *, .stage, .fill-body, .wall-copy, .wall-art, .fine");
if (!reduceMotion && "IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  revealables.forEach((el) => {
    el.classList.add("reveal");
    io.observe(el);
  });
}

// Simulator: depths only, no prices. The axis runs from 0% at 14% of the stage height to -50% at 92%.
const stage = document.getElementById("stage");
if (stage) wireSimulator(stage);

function wireSimulator(stage) {
  const bid = document.getElementById("bid");
  const bidOut = document.getElementById("bid-out");
  const blade = document.getElementById("blade");
  const tag = document.getElementById("blade-tag");
  const drop = document.getElementById("drop");
  const priceLine = document.getElementById("price-line");
  const run = document.getElementById("run");
  const reset = document.getElementById("reset");
  const result = document.getElementById("result");
  const AXIS_TOP = 14;
  const AXIS_SPAN = 78;
  const MAX_DEPTH = 50;
  let running = false;
  let done = false;

  const toTop = (depth) => AXIS_TOP + (depth / MAX_DEPTH) * AXIS_SPAN;
  const crashDepth = () => Number(document.querySelector('input[name="crash"]:checked')?.value ?? 20);

  function setDrop(depth) {
    const t = `${toTop(depth)}%`;
    drop.style.top = t;
    priceLine.style.top = t;
  }

  function idleText() {
    return `Waiting. Your bid sits ${bid.value}% under the price.`;
  }

  function renderBid() {
    const v = Number(bid.value);
    bidOut.textContent = `−${v}%`;
    tag.textContent = `Bid −${v}%`;
    blade.style.top = `${toTop(v)}%`;
    stage.style.setProperty("--glow-y", `${toTop(v)}%`);
    const fill = ((v - Number(bid.min)) / (Number(bid.max) - Number(bid.min))) * 100;
    bid.style.setProperty("--fill", `${fill}%`);
  }

  function resetSim() {
    running = false;
    done = false;
    setDrop(0);
    result.className = "result";
    result.textContent = idleText();
    run.disabled = false;
    reset.disabled = true;
  }

  function finish(filled, b, c) {
    running = false;
    done = true;
    run.disabled = false;
    reset.disabled = false;
    if (filled) {
      blade.classList.remove("is-hit");
      void blade.offsetWidth;
      blade.classList.add("is-hit");
      result.className = "result is-filled";
      result.textContent =
        c === b
          ? `The market fell ${c}% and touched your bid. Bought at −${b}%.`
          : `The market fell ${c}%. Your order bought at −${b}% on the way down.`;
    } else {
      result.className = "result is-missed";
      result.textContent = `The market fell ${c}%, short of your bid at −${b}%. Nothing happened and your USDG stayed in your wallet.`;
    }
  }

  function start() {
    if (running) return;
    if (done) resetSim();
    const b = Number(bid.value);
    const c = crashDepth();
    const filled = c >= b;
    const target = filled ? b : c;
    running = true;
    run.disabled = true;
    reset.disabled = true;
    result.className = "result";
    result.textContent = `Market falling toward −${c}%…`;

    if (reduceMotion) {
      setDrop(target);
      finish(filled, b, c);
      return;
    }
    const duration = 500 + target * 22;
    const t0 = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - t0) / duration);
      setDrop(target * t * t); // ease-in, like a fall
      if (t < 1) requestAnimationFrame(frame);
      else finish(filled, b, c);
    }
    requestAnimationFrame(frame);
  }

  bid.addEventListener("input", () => {
    renderBid();
    if (!running) resetSim();
  });
  document.querySelectorAll('input[name="crash"]').forEach((r) =>
    r.addEventListener("change", () => {
      if (!running) resetSim();
    }),
  );
  run.addEventListener("click", start);
  reset.addEventListener("click", resetSim);

  // Drag the blade itself; it drives the same range input, so keyboard and pointer stay in sync.
  blade.addEventListener("pointerdown", (e) => {
    if (running) return;
    blade.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = stage.getBoundingClientRect();
      const pct = ((ev.clientY - r.top) / r.height) * 100;
      const depth = Math.round(((pct - AXIS_TOP) / AXIS_SPAN) * MAX_DEPTH);
      const clamped = Math.min(Number(bid.max), Math.max(Number(bid.min), depth));
      if (String(clamped) !== bid.value) {
        bid.value = String(clamped);
        bid.dispatchEvent(new Event("input"));
      }
    };
    const up = () => {
      blade.removeEventListener("pointermove", move);
      blade.removeEventListener("pointerup", up);
      blade.removeEventListener("pointercancel", up);
    };
    blade.addEventListener("pointermove", move);
    blade.addEventListener("pointerup", up);
    blade.addEventListener("pointercancel", up);
  });

  renderBid();
  resetSim();
}

document.documentElement.dataset.ready = "1";

// The book: live totals, per stock and latest fills. Shown as empty when it is empty.
const EXPLORER = "https://robinhoodchain.blockscout.com";
const usdg = (base) => (Number(base || 0) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 });
async function loadBook() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  try {
    const res = await fetch("/api/book");
    if (!res.ok) throw new Error(String(res.status));
    const b = await res.json();
    set("b-open", String(b.totals?.open ?? 0));
    set("b-usdg", usdg(b.totals?.usdg_open));
    set("b-filled", String(b.totals?.filled ?? 0));
    set("b-usdg-filled", usdg(b.totals?.usdg_filled));
    const mk = document.getElementById("b-markets");
    const fl = document.getElementById("b-fills");
    mk.innerHTML = b.markets.length
      ? b.markets.map((m) => `<li><span>${m.symbol}</span><span>${m.open} open · ${usdg(m.usdg)} USDG · −${Math.round(m.shallowest / 100)}% to −${Math.round(m.deepest / 100)}%</span></li>`).join("")
      : `<li class="empty">No open bids yet. The first one shows here within a minute.</li>`;
    fl.innerHTML = b.fills.length
      ? b.fills.map((f) => `<li><span>${f.symbol} · −${Math.round(f.depth_bps / 100)}%</span><span>${usdg(f.amount_in)} USDG · <a href="${EXPLORER}/tx/${f.fill_tx}" target="_blank" rel="noopener">tx</a></span></li>`).join("")
      : `<li class="empty">No fills yet.</li>`;
  } catch {
    set("b-open", "–");
  }
}
if (document.getElementById("b-open")) {
  loadBook();
  setInterval(loadBook, 30_000);
}
