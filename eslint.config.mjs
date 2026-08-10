import next from "eslint-config-next";
import nextTs from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "generated/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...(Array.isArray(next) ? next : [next]),
  ...(Array.isArray(nextTs) ? nextTs : [nextTs]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
