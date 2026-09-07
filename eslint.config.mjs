import js from "@eslint/js";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

// ESLint's recommended rule set only, with no plugins. The repository is plain
// Node ES modules, so the Node globals are declared and nothing else is added.
export default defineConfig([
  globalIgnores(["out/", "content/.live-import-*/", "node_modules/"]),
  {
    files: ["**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
]);
