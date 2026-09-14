// Flat config, Node/TS project. Keeps the same rules the AXI ecosystem
// references use: strict TS, no unused code, no explicit any without a note.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off", // JSON payloads are dynamic by nature
    },
  },
);
