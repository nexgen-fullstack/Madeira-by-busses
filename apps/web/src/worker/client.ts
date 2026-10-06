import type { Itinerary, PlanRequest } from '@madeirabus/engine';
import type { Ahead, WorkerRequest, WorkerResponse } from './planner.worker.ts';

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

  /** Loads the walking network (walk.bin) for street distances and drawn walks. */
  loadWalk(url: string): Promise<true> {
    return this.call({ method: 'walk', url });
  }

  plan(request: PlanRequest): Promise<Itinerary[]> {
    return this.call({ method: 'plan', request });
  }

  /** When no bus gets there any more on the day asked: the first later day one does. */
  ahead(request: PlanRequest): Promise<Ahead | null> {
    return this.call({ method: 'ahead', request });
  }

  lastConnection(request: PlanRequest): Promise<Itinerary | null> {
    return this.call({ method: 'last', request });
  }

  /** Stops the worker; pending calls are rejected. */
  dispose(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Planner disposed'));
    this.pending.clear();
  }
}
