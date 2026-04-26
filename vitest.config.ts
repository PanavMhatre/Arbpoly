import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "@config": new URL("./config", import.meta.url).pathname
    }
  }
});
