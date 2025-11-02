export interface PersistedState<T> {
  version: number;
  data: T;
}

export function loadState<T>(key: string, defaultValue: T): T {
  if (typeof localStorage === 'undefined') return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultValue;
    const parsed = JSON.parse(raw) as PersistedState<T> | T;
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return (parsed as PersistedState<T>).data;
    }
    return parsed as T;
  } catch (error) {
    console.warn('Failed to load state', error);
    return defaultValue;
  }
}

export function saveState<T>(key: string, value: T): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const wrapped: PersistedState<T> = { version: 1, data: value };
    localStorage.setItem(key, JSON.stringify(wrapped));
  } catch (error) {
    console.warn('Failed to save state', error);
  }
}
