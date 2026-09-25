/** Runs compute in a Web Worker when available, else in-thread (jsdom tests, very old browsers). */
import type { ComputeRequest, ComputeResponse } from "./protocol";
import { runCompute } from "./run";

type Pending = (r: ComputeResponse) => void;
let worker: Worker | null | undefined;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined" || import.meta.env?.MODE === "test") return (worker = null);
  try {
    worker = new Worker(new URL("./compute.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<ComputeResponse>) => {
      pending.get(e.data.reqId)?.(e.data);
      pending.delete(e.data.reqId);
    };
    worker.onerror = (e) => console.error("compute worker error", e);
  } catch {
    worker = null;
  }
  return worker;
}

export async function requestCompute(req: ComputeRequest): Promise<ComputeResponse> {
  const w = getWorker();
  if (!w) return runCompute(req);
  return new Promise((resolve) => {
    pending.set(req.reqId, resolve);
    w.postMessage(req);
  });
}
