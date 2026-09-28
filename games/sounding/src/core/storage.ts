/** localStorage wrapper that never throws (private mode, blocked storage, sandboxed frames). */
const PREFIX = 'toukousen-sounding:';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable — keep running without persistence */
  }
}
