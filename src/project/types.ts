// PROJECT BOUNDARY — the project package contract: the facts of one building in the shape the engine loads.
// The engine (src/home, src/document, …) never imports building data files; it receives them only through this contract
// (project() from ./active). The types are defined in the pure core (packages/core/src/package/types.ts, ADR 0023) and
// re-exported here for the app. Packages are runtime-loaded JSON directories (projects/<id>/project.json); their structure
// is validated by the zod schema (@home-sim/core/package/schema) and their semantics by ./validate. Field reference:
// docs/PROJECT_PACKAGE_SPEC.md.
export * from '@home-sim/core/package/types';
