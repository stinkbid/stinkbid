import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so unit tests run without the Cloudflare plugin.
export default defineConfig({
  test: {
    include: ["shared/**/*.test.ts", "worker/**/*.test.ts"],
    environment: "node",
  },
});
