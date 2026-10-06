/// <reference lib="webworker" />
import { Network, Planner, WalkGraph, type Itinerary, type PlanRequest } from '@madeirabus/engine';

/** Runs journey planning off the main thread so the UI never stutters. */
export type WorkerRequest =
  | { id: number; method: 'init'; json: string }
  | { id: number; method: 'walk'; url: string }
  | { id: number; method: 'plan'; request: PlanRequest }
  | { id: number; method: 'ahead'; request: PlanRequest }
  | { id: number; method: 'last'; request: PlanRequest };

/** The first later day a bus gets there, and its options. */
export type Ahead = { date: string; itineraries: Itinerary[] };

export type WorkerResponse =
  | { id: number; ok: true; result: Itinerary[] | Itinerary | Ahead | null | true }
  | { id: number; ok: false; error: string };

let planner: Planner | undefined;
/** Settles once the streets for walking are loaded (or failed to load). */
let walkReady: Promise<unknown> = Promise.resolve();
/** How long a search waits for the streets before walking as the crow flies. */
const WALK_WAIT = 4000;

const reply = (r: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(r);
const failure = (id: number, err: unknown): WorkerResponse => ({
  id,
  ok: false,
  error: err instanceof Error ? err.message : String(err),
});

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.method === 'init') {
      const net = new Network(JSON.parse(msg.json));
      planner = new Planner(net);
      reply({ id: msg.id, ok: true, result: true });
      // Build the walking transfers now rather than during the first search.
      void net.footpaths;
      return;
    }
    const ready = planner;
    if (!ready) throw new Error('Planner not initialised');
    if (msg.method === 'walk') {
      // The streets arrive just after the timetable; searches wait for them a moment.
      walkReady = fetch(msg.url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((buf) => {
          ready.setWalk(WalkGraph.decode(buf));
          reply({ id: msg.id, ok: true, result: true });
        })
        .catch((err: unknown) => reply(failure(msg.id, err)));
      return;
    }
    const timeout = new Promise((resolve) => setTimeout(resolve, WALK_WAIT));
    void Promise.race([walkReady, timeout]).then(() => {
      try {
        if (msg.method === 'plan') reply({ id: msg.id, ok: true, result: ready.plan(msg.request) });
        else if (msg.method === 'ahead')
          reply({ id: msg.id, ok: true, result: ready.planAhead(msg.request) ?? null });
        else reply({ id: msg.id, ok: true, result: ready.lastConnection(msg.request) ?? null });
      } catch (err) {
        reply(failure(msg.id, err));
      }
    });
  } catch (err) {
    reply(failure(msg.id, err));
  }
};
