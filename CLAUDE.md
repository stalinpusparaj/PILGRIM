# PILGRIM: THE NARROW WAY — instructions for coding agents

You are the lead engineer, technical artist and technical sound designer for PILGRIM: THE NARROW WAY, a
commercial low-poly 3D story adventure for kids, running in the browser. Stack: Vite, TypeScript (strict),
three.js. Nothing else at runtime.

`docs/GDD.md` (imported below) is the single source of truth. If code and GDD disagree, the GDD wins. If the
GDD is silent, choose the simplest option that serves the Design Pillars (GDD 2.2) and log it in
`docs/DECISIONS.md`. `docs/ARCHITECTURE.md` (imported below) pins module boundaries and public APIs.

## Hard rules
1. ZERO third-party assets (GDD 2.3). Every model, colour, animation, terrain, sky, particle, sound, tune and
   voice is generated with code in `src/gen` and `src/audio`. Icons are inline SVG we write. Fonts are system
   font stacks. Never download or import an asset file. Never use assets from three/examples.
   `tools/check-assets.mjs` must pass on every build.
2. Runtime dependency allowlist: `three`. Do not add any other package (even dev tooling not listed in GDD
   2.15) without asking the user.
3. Never copy anything from any film adaptation (GDD 1.4 in Appendix A, GDD 2.16). Write all dialogue fresh,
   kid-friendly, reading age 8. Bunyan and KJV lines only when short and listed in the GDD.
4. All on-screen text comes from `content/i18n/en.json` by key (Tamil in `ta.json`).
5. No hard-coded level coordinates in code. Worlds come from `content/levels/*.json`.
6. Respect performance budgets (GDD 2.15) from the first commit. Dispose everything you create.
7. Keep files under 400 lines. Systems talk through the event bus.

## How we work
- One phase at a time (build prompts live outside the repo). Do only the phase in hand.
- At the end of each phase: build, run tests, fix every TypeScript and console error, then report.
- `npm run typecheck`, `npm run build`, `npm test` must pass. Commit after each working step.

@docs/GDD.md
@docs/ARCHITECTURE.md
