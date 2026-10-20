import type { Progress } from './types';
export const PROGRESS_KEY = 'aym.home.v1';
export const SAVED_KEY = 'aym.saved.v1';
export const THEME_KEY = 'aym.theme.v1';
export type Theme = 'light' | 'dark';
export function readTheme(): Theme {
  try {
    return JSON.parse(localStorage.getItem(THEME_KEY) || 'null') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
export function readProgress(): Progress | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null');
    if (
      value &&
      typeof value === 'object' &&
      'id' in value &&
      typeof value.id === 'string' &&
      'index' in value &&
      typeof value.index === 'number' &&
      Number.isFinite(value.index)
    ) {
      return {
        id: value.id,
        index: value.index,
        version: 'version' in value && typeof value.version === 'string' ? value.version : '',
      };
    }
  } catch {
    /* Blocked or corrupt storage: continue in memory. */
  }
  return null;
}
export function readSaved(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === 'string'))]
      : [];
  } catch {
    return [];
  }
}
export function persist(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
