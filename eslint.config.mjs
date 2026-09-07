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
      // Let the pinned ESLint release decide the newest final syntax it can
      // parse, so a module that Node 24 runs is never rejected by the linter.
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
]);
