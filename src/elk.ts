/**
 * @yalehwang/plantuml-js/elk — ELK-only entry (no `@viz-js/viz`, no WASM).
 *
 * Import from here in browser bundles that only need the ELK engine, so the
 * Graphviz WASM is never fetched. Everything else — parser, transforms, views,
 * the ArchGuard bridge — is the same as the full build.
 */

export * from './core.js';
