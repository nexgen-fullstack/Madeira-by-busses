import type { Itinerary, PlanRequest } from '@madeirabus/engine';
import type { WorkerRequest, WorkerResponse } from './planner.worker.ts';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** Promise-based wrapper around the planner worker. */
export class PlannerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
  }

  private call<T>(msg: WithoutId<WorkerRequest>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }

  init(json: string): Promise<true> {
    return this.call({ method: 'init', json });
  }

  plan(request: PlanRequest): Promise<Itinerary[]> {
    return this.call({ method: 'plan', request });
  }

  lastConnection(request: PlanRequest): Promise<Itinerary | null> {
    return this.call({ method: 'last', request });
  }
}
