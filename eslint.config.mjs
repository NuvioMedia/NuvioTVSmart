import js from "@eslint/js";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

const runtimeGlobals = {
  ...globals.browser,
  ...globals.node,
  PalmSystem: "readonly",
  tizen: "readonly",
  webOS: "readonly",
  webOSSystem: "readonly"
};

export default [
  {
    ignores: [
      "assets/**",
      "build/**",
      "dist/**",
      "node_modules/**",
      "res/**",
      "services/**/runtime/**"
    ]
  },
  {
    files: ["js/**/*.{js,mjs,cjs}", "scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: runtimeGlobals
    },
    rules: {
      ...js.configs.recommended.rules,
      // New in ESLint 10's recommended set. The existing dead stores are
      // unrelated to this change: clean them up, then drop this line.
      "no-useless-assignment": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  eslintConfigPrettier
];
