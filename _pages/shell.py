# Generates the inner pages from one shell, so header, footer and head tags stay identical.
# Usage: python3 _pages/shell.py   (reads _pages/*.body.html, writes <name>.html at the project root)
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
NAV = [("/app", "App"), ("/docs", "Docs"), ("/status", "Status")]
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
      <nav aria-label="Site">{nav}</nav>
    </header>
    <main id="main">
{body}
    </main>
    <footer class="foot">
      <span class="foot-brand"><img src="/brand/stinkbid-mark.svg" width="22" height="22" alt="" /> STINKBID</span>
      <nav class="foot-links" aria-label="Footer">{foot}</nav>
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
