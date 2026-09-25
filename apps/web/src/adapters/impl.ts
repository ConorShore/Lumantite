// Real implementations. `engine.ts` / `project.ts` bind these to the EngineApi / ProjectApi
// interfaces in `contract.ts`, so any signature drift fails the typecheck.
export * as engineImpl from "@optiplanner/engine";
export * as projectImpl from "@optiplanner/project";
