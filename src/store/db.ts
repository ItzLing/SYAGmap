/**
 * Client for the local JSON database (server/api.mjs). If the API is not
 * reachable (e.g. a static deploy) it falls back to localStorage so the app
 * still works for one browser.
 */
export interface Doc {
  id: string;
  township: string;
  createdAt: number;
}

export let dbOffline = false;

export class Col<T extends Doc> {
  private ls: string;

  constructor(private name: string, private township: string) {
    this.ls = `syagmap:${name}:${township}`;
  }

  private readLocal(): T[] {
    try {
      return JSON.parse(localStorage.getItem(this.ls) ?? '[]') as T[];
    } catch {
      return [];
    }
  }

  private writeLocal(docs: T[]) {
    try {
      localStorage.setItem(this.ls, JSON.stringify(docs));
    } catch {
      /* storage unavailable */
    }
  }

  async list(): Promise<T[]> {
    try {
      const r = await fetch(`/api/db/${this.name}?township=${encodeURIComponent(this.township)}`);
      if (!r.ok) throw new Error(String(r.status));
      const type = r.headers.get('content-type') ?? '';
      if (!type.includes('json')) throw new Error('not json');
      dbOffline = false;
      return (await r.json()) as T[];
    } catch {
      dbOffline = true;
      return this.readLocal();
    }
  }

  async add(doc: Omit<T, 'id' | 'createdAt' | 'township'> & Partial<Pick<T, 'createdAt'>>): Promise<T> {
    const body = { ...doc, township: this.township, createdAt: doc.createdAt ?? Date.now() };
    try {
      if (dbOffline) throw new Error('offline');
      const r = await fetch(`/api/db/${this.name}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as T;
    } catch {
      dbOffline = true;
      const full = { ...body, id: Math.random().toString(36).slice(2, 10) } as unknown as T;
      this.writeLocal([...this.readLocal(), full]);
      return full;
    }
  }

  async patch(id: string, patch: Partial<T>): Promise<void> {
    try {
      if (dbOffline) throw new Error('offline');
      const r = await fetch(`/api/db/${this.name}/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      dbOffline = true;
      this.writeLocal(this.readLocal().map((d) => (d.id === id ? { ...d, ...patch } : d)));
    }
  }

  async remove(id: string): Promise<void> {
    try {
      if (dbOffline) throw new Error('offline');
      const r = await fetch(`/api/db/${this.name}/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      dbOffline = true;
      this.writeLocal(this.readLocal().filter((d) => d.id !== id));
    }
  }
}

export function localGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function localSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}
