# Generates the inner pages from one shell, so header, footer and head tags stay identical.
# Usage: python3 _pages/shell.py   (reads _pages/*.body.html, writes <name>.html at the project root)
import pathlib, re
SOC = '<span class="soc"><a class="soc-a" href="https://x.com/stinkbid_app" target="_blank" rel="noopener" aria-label="STINKBID on X"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg></a><a class="soc-a" href="https://github.com/stinkbid/stinkbid" target="_blank" rel="noopener" aria-label="STINKBID source on GitHub"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a></span>'
root = pathlib.Path(__file__).resolve().parent.parent
NAV = [("/docs", "Docs"), ("/status", "Status")]
FOOT = [("/app", "App"), ("/docs", "Docs"), ("/contracts", "Contracts"), ("/security", "Security"), ("/status", "Status"), ("/official", "Official links"), ("/changelog", "Changelog")]

def shell(name, title, desc, body, script):
    nav = "".join(f'<a class="top-link" href="{h}"{" aria-current=\"page\"" if h == "/" + name else ""}>{t}</a>' for h, t in NAV)
    foot = "".join(f'<a href="{h}">{t}</a>' for h, t in FOOT)
    return f'''<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>{title} · STINKBID</title>
    <meta name="description" content="{desc}" />
    <meta name="theme-color" content="#0B0708" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="canonical" href="https://stinkbid.pro/{name}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="STINKBID" />
    <meta property="og:title" content="{title} · STINKBID" />
    <meta property="og:description" content="{desc}" />
    <meta property="og:image" content="https://stinkbid.pro/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="module" src="{script}"></script>
  </head>
  <body class="inner">
    <a class="skip" href="#main">Skip to content</a>
    <div class="backdrop" aria-hidden="true">
      <picture>
        <source media="(max-width: 700px)" srcset="/img/hall-m-900.webp" />
        <img src="/img/hall-1280.webp" srcset="/img/hall-1280.webp 1280w, /img/hall-2048.webp 2048w" sizes="100vw" width="2048" height="1152" alt="" />
      </picture>
    </div>
    <header class="top">
      <a class="brand" href="/" aria-label="STINKBID home">
        <img src="/brand/stinkbid-mark.svg" width="34" height="34" alt="" />
        <span>STINKBID</span>
      </a>
      <nav aria-label="Site">{nav}{SOC}<a class="top-cta" href="/app">Open the app</a></nav>
    </header>
    <main id="main">
{body}
    </main>
    <footer class="foot">
      <span class="foot-brand"><img src="/brand/stinkbid-mark.svg" width="22" height="22" alt="" /> STINKBID</span>
      <nav class="foot-links" aria-label="Footer">{foot}</nav>
      {SOC}
      <p>Nothing here is financial advice. STINKBID is independent and not affiliated with Robinhood. Not audited.</p>
    </footer>
  </body>
</html>
'''

for src in sorted((root / "_pages").glob("*.body.html")):
    name = src.name.removesuffix(".body.html")
    text = src.read_text()
    meta = dict(re.findall(r"<!--\s*(\w+):\s*(.*?)\s*-->", text.split("\n\n", 1)[0]))
    body = re.sub(r"^(<!--.*?-->\s*)+", "", text, flags=re.S)
    (root / f"{name}.html").write_text(shell(name, meta["title"], meta["desc"], body.rstrip(), meta.get("script", "/src/pages/page.ts")))
    print("wrote", f"{name}.html")
