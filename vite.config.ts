import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// Multi-page build: add app pages (e.g. app: "app.html") to the input map.
export default defineConfig({
  plugins: [cloudflare()],
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: {
            main: "index.html",
            notFound: "404.html",
            app: "app.html",
            docs: "docs.html",
            contracts: "contracts.html",
            security: "security.html",
            status: "status.html",
            official: "official.html",
            changelog: "changelog.html",
          },
        },
      },
    },
  },
});
