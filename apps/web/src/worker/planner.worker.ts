/// <reference lib="webworker" />
import { Network, Planner, type Itinerary, type PlanRequest } from '@madeirabus/engine';

/** Runs journey planning off the main thread so the UI never stutters. */
export type WorkerRequest =
  | { id: number; method: 'init'; json: string }
  | { id: number; method: 'plan'; request: PlanRequest }
  | { id: number; method: 'last'; request: PlanRequest };

export type WorkerResponse =
  | { id: number; ok: true; result: Itinerary[] | Itinerary | null | true }
  | { id: number; ok: false; error: string };

let planner: Planner | undefined;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  const reply = (r: WorkerResponse) =>
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(r);
  try {
    if (msg.method === 'init') {
      planner = new Planner(new Network(JSON.parse(msg.json)));
      reply({ id: msg.id, ok: true, result: true });
      return;
    }
    if (!planner) throw new Error('Planner not initialised');
    if (msg.method === 'plan') reply({ id: msg.id, ok: true, result: planner.plan(msg.request) });
    else reply({ id: msg.id, ok: true, result: planner.lastConnection(msg.request) ?? null });
  } catch (err) {
    reply({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
