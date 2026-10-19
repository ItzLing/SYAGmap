/**
 * Tiny persistence layer. Today it is localStorage; the database is still
 * undecided, so everything goes through load/save and can be swapped for an API.
 */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app still works for this session */
  }
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
