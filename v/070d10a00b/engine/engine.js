// The inference engine the app, the review site and the tools use.
//
// To switch engines, change the one line below:
//   './engine-v1.js'  the first engine: every clue counts both ways, one lag per change
//   './engine-v2.js'  one-way evidence from data/evidence.json, plate staleness, joint answers
//                     per feature, per-question misread rates (docs/ENGINE_V2.md)
//   './engine-v3.js'  v2's model; questions from anywhere on the globe, picked at random among
//                     near-ties, more so early on (docs/ENGINE_V3.md)
//
// All three export the same API (createSession, stateProbabilities, optionsFor, depictionP,
// normaliseName, lagCdf, nowDecimalYear, mulberry32, DEFAULTS, ENGINE_VERSION), and all read the
// same bundle: v1 ignores the evidence that engine/compile.js attaches. Run `npm test` and
// `npm run compare` after switching. Code that must use one engine in particular (tools/compare.mjs,
// the engine tests) imports engine-v1.js, engine-v2.js or engine-v3.js directly.

export * from './engine-v3.js';
