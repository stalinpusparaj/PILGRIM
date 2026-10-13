# Decisions log

Choices the GDD is silent on, and deviations, with the reason. Newest at the bottom.

| # | Phase | Decision | Why |
|---|---|---|---|
| 1 | 0 | Built from build-pack **v2** (low-poly, in-house assets); v1 is superseded. | v2 says what changed and replaces the asset bible approach. |
| 2 | 0 | `CLAUDE.md` holds the master-prompt rules and imports `docs/GDD.md` and `docs/ARCHITECTURE.md` with `@` imports instead of duplicating Part 2. | One source of truth, no drift between two copies; Claude Code still loads the full spec. |
| 3 | 0 | `docs/GDD.md` = Part 2 plus Appendix A (Part 1 sections 1.4, 1.5, 1.6) and Appendix B (readiness check). | GDD 2.16 and 2.11 reference 1.4/1.5/1.6, which live in Part 1. No transcript text is included. |
| 4 | 0 | Pinned versions: three 0.186.1, @types/three 0.186.0, vite 8.3.1, typescript 7.0.2, @playwright/test 1.63.0, prettier 3.9.9. | Exact pins, each at least ~3 weeks old. `@types/three` added to dev deps: it is type definitions (code), needed for strict TS. |
| 5 | 0 | ESLint is **not installed yet**. | Linting TypeScript needs `typescript-eslint`, which is not on the allowlist. `tsc --strict` + Prettier cover it until the owner approves that package. |
| 6 | 0 | Playwright uses the installed Google Chrome (`channel: 'chrome'`). | Avoids downloading a browser binary; same engine family. |
| 7 | 0 | The original build-prompt `.md` files in the project root are git-ignored. | The repo carries only Part 2 (as the GDD); Part 1 film analysis stays out of history except the appendix sections the GDD references. |
| 8 | 0 | `IGNORANCE_EPILOGUE` is read via Vite `envPrefix: ['VITE_', 'IGNORANCE_']`. | The GDD names the flag without a `VITE_` prefix. |
