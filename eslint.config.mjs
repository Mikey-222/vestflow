import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      "lib/bindings/**",
      "contracts/**",
      "test_snapshots/**",
      ".next/**",
      "node_modules/**",
      "public/workers/**",
      // The API server is a standalone package with its own eslint/typescript
      // install (type-checked rules need api/node_modules present).
      "api/**",
    ],
  },
  {
    // Downgrade rules that have widespread pre-existing violations in
    // contributor code so CI does not block on them. Fix incrementally.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-var-requires": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
];

export default eslintConfig;
