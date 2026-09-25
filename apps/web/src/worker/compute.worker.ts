/// <reference lib="webworker" />
import { runCompute } from "./run";
import type { ComputeRequest } from "./protocol";

self.onmessage = (e: MessageEvent<ComputeRequest>) => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(runCompute(e.data));
};
