import { defineConfig } from "tsup";

// Self-contained bundle: the CLI ships as one ESM file with axi-sdk-js (and
// its @toon-format/toon dependency) bundled in, so `npx -y asana-axi@latest`
// and global installs have no extra runtime packages to resolve.
export default defineConfig({
  entry: { "bin/asana-axi": "src/bin/asana-axi.ts" },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Single self-contained file: keeps the shebang banner on line 1 (code
  // splitting hoists imports above the banner, breaking the interpreter
  // directive) and gives npx/global installs one file to run.
  splitting: false,
  banner: { js: "#!/usr/bin/env node" },
});
