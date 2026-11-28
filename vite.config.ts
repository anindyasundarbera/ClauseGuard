import path from "node:path";
import { defineConfig } from "vite";

const firebaseAiBrowserEsm = path.resolve(
  __dirname,
  "node_modules/@firebase/ai/dist/esm/index.esm.js"
);

export default defineConfig({
  base: "./",
  resolve: {
    conditions: ["browser", "import", "module", "default"],
    alias: {
      "@firebase/ai": firebaseAiBrowserEsm,
      "firebase/ai": firebaseAiBrowserEsm,
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        guide: path.resolve(__dirname, "guide.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts"],
    server: {
      deps: {
        inline: [/^firebase/, /^@firebase/],
      },
    },
  },
});
