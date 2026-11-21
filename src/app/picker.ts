// Wallet picker. Lists every wallet the browser announces over EIP-6963, then the
// wallets traders use most that are not installed, with a download link (desktop)
// or a link that opens this page inside the wallet's own browser (phone).
import { discoverWallets, type Wallet } from "./wallet";

type Known = { rdns: string; name: string; logo: string; get: string; open?: (url: string) => string };

// Logos in /img/wallets: web3icons (MIT, github.com/0xa3k5/web3icons); Bitget Wallet from web3.bitget.com.
// Each of these can add Robinhood Chain as a custom network. Phantom is left out: it only connects to its own EVM chains.
const POPULAR: Known[] = [
  { rdns: "io.metamask", name: "MetaMask", logo: "/img/wallets/metamask.svg", get: "https://metamask.io/download", open: (u) => `https://metamask.app.link/dapp/${u.replace(/^https?:\/\//, "")}` },
  { rdns: "io.rabby", name: "Rabby", logo: "/img/wallets/rabby.svg", get: "https://rabby.io" },
  { rdns: "com.okex.wallet", name: "OKX Wallet", logo: "/img/wallets/okx.svg", get: "https://web3.okx.com/download", open: (u) => `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(u)}` },
  { rdns: "com.coinbase.wallet", name: "Coinbase Wallet", logo: "/img/wallets/coinbase.svg", get: "https://www.coinbase.com/wallet/downloads", open: (u) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}` },
  { rdns: "com.trustwallet.app", name: "Trust Wallet", logo: "/img/wallets/trust.svg", get: "https://trustwallet.com/download", open: (u) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(u)}` },
  { rdns: "com.bitget.web3", name: "Bitget Wallet", logo: "/img/wallets/bitget.png", get: "https://web3.bitget.com/wallet-download" },
  { rdns: "me.rainbow", name: "Rainbow", logo: "/img/wallets/rainbow.svg", get: "https://rainbow.me/download" },
  { rdns: "io.zerion.wallet", name: "Zerion", logo: "/img/wallets/zerion.svg", get: "https://zerion.io/download" },
];

const LAST = "stinkbid:wallet";
const remembered = () => { try { return localStorage.getItem(LAST); } catch { return null; } };
const remember = (id: string) => { try { localStorage.setItem(LAST, id); } catch { /* private mode */ } };
const isPhone = () => window.matchMedia("(pointer: coarse)").matches && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function mark(name: string, icon: string | null) {
  if (icon && (/^data:image\/(svg\+xml|png|webp|jpeg)[;,]/.test(icon) || icon.startsWith("/img/wallets/"))) {
    const img = el("img", "wp-icon");
    img.src = icon;
    img.alt = "";
    img.width = 28;
    img.height = 28;
    return img;
  }
  return el("span", "wp-icon wp-mono", name.slice(0, 1));
}

let dialog: HTMLDialogElement | null = null;

/** Opens the picker. Resolves with the chosen wallet, or null if closed. */
export async function pickWallet(): Promise<Wallet | null> {
  const found = await discoverWallets();
  const last = remembered();
  found.sort((a, b) => Number(b.id === last) - Number(a.id === last));

  dialog?.remove();
  dialog = el("dialog", "wp");
  dialog.setAttribute("aria-labelledby", "wp-title");
  const head = el("div", "wp-head");
  head.append(el("h2", "", "Connect a wallet"));
  head.firstElementChild!.id = "wp-title";
  const close = el("button", "wp-close", "Close");
  close.type = "button";
  head.append(close);
  dialog.append(head);

  return new Promise((resolve) => {
    const done = (w: Wallet | null) => {
      if (w) remember(w.id);
      dialog!.close();
      resolve(w);
    };
    close.addEventListener("click", () => done(null));
    dialog!.addEventListener("cancel", () => resolve(null));

    if (found.length) {
      dialog!.append(el("p", "wp-k", "In this browser"));
      const list = el("ul", "wp-list");
      for (const w of found) {
        const li = el("li");
        const b = el("button", "wp-row");
        b.type = "button";
        b.append(mark(w.name, w.icon ?? POPULAR.find((k) => k.rdns === w.id)?.logo ?? null), el("span", "wp-name", w.name), el("span", "wp-tag", w.id === last ? "Last used" : "Detected"));
        b.addEventListener("click", () => done(w));
        li.append(b);
        list.append(li);
      }
      dialog!.append(list);
    }

    const ids = new Set(found.map((w) => w.id));
    const rest = POPULAR.filter((k) => !ids.has(k.rdns));
    if (rest.length) {
      const phone = isPhone();
      dialog!.append(el("p", "wp-k", found.length ? "Other wallets" : phone ? "Open this page in a wallet app" : "Install a wallet"));
      const list = el("ul", "wp-list");
      for (const k of rest) {
        const li = el("li");
        const a = el("a", "wp-row");
        const url = phone && k.open ? k.open(location.href) : k.get;
        a.href = url;
        if (!url.startsWith("okx:")) { a.target = "_blank"; a.rel = "noopener"; }
        a.append(mark(k.name, k.logo), el("span", "wp-name", k.name), el("span", "wp-tag", phone && k.open ? "Open in app" : "Get ↗"));
        li.append(a);
        list.append(li);
      }
      dialog!.append(list);
    }

    dialog!.append(el("p", "wp-fine", "The wallet adds Robinhood Chain (4663) when you connect. StinkBid never asks for a seed phrase."));
    document.body.append(dialog!);
    dialog!.showModal();
  });
}
