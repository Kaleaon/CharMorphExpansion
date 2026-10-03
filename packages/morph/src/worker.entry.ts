// Entry point executed inside the Web Worker.
import { createWorkerHandler, type FromWorker, type ToWorker } from "./worker.ts";

const ctx = self as unknown as {
  onmessage: ((e: { data: ToWorker }) => void) | null;
  postMessage(msg: FromWorker, transfer: Transferable[]): void;
};
const handle = createWorkerHandler((msg, transfer) => ctx.postMessage(msg, transfer));
ctx.onmessage = (e) => handle(e.data);
