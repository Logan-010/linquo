export const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type Level = typeof levels[number];
export interface LanguagePair { source: string; target: string }
// Offline/browser fallback; available pairs are refreshed from the Tauri API.
export const defaultPair: LanguagePair = { source: 'English', target: 'Korean' };
export const scoreKey = (pair: LanguagePair) => `score-${pair.source}-${pair.target}`;
export const statsKey = (pair: LanguagePair) => `linquo-stats-${pair.source}-${pair.target}-v1`;
export const languageName = (language: string) => translate(`languages.${language}`, { defaultValue: language });
export interface Text { text: string; romanization?: string | null }
export interface Tile extends Text { id: string }
interface BaseExercise {
  id: string;
  instruction: string;
  prompt?: Text | null;
  hint: string;
  explanation: string;
  grammar_focus: string[];
  vocabulary_focus: string[];
}
export type Exercise = BaseExercise & (
  | { type: 'word_bank_translation'; data: { tiles: Tile[]; joiner: string; accepted_orders: string[][]; solution: Text } }
  | { type: 'match_pairs'; data: { pairs: { id: string; source: Text; target: Text }[] } }
  | { type: 'fill_blank' | 'vocabulary_choice'; data: { options: Tile[]; correct_option_id: string; solution: Text } }
);
export interface Lesson {
  learning_level: Level;
  exercises: Exercise[];
  total_exercises: number;
}
export interface Settings extends LanguagePair {
  provider: string;
  credentials: string;
  baseUrl: string;
  count: number;
  romanize: boolean;
  speech: boolean;
  level: Level | 'auto';
}
export const defaults: Settings = {
  ...defaultPair,
  provider: '', credentials: '', baseUrl: '', count: 10, romanize: true, speech: false, level: 'auto',
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
  }
}
export const isTauri = () => Boolean(window.__TAURI_INTERNALS__);
export function invoke<T = void>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.__TAURI_INTERNALS__) return Promise.reject(new Error(translate('errors.nativeRequired')));
  return window.__TAURI_INTERNALS__.invoke<T>(command, args);
}
export const get = (key: string) => invoke<string | null>('kv_get', { key });
export const put = (key: string, value: unknown) => invoke('kv_put', { key, value: JSON.stringify(value) });
export const localProvider = (provider: string) => /^(ollama|llamacpp)/i.test(provider.trim());
export async function initialize(settings: Settings) {
  await invoke('init_generation', {
    source: settings.source,
    target: settings.target,
    provider: settings.provider.trim(),
    credentials: settings.credentials.trim() || null,
    baseUrl: localProvider(settings.provider) ? settings.baseUrl.trim() || null : null,
  });
}
export function parseSettings(value: string | null): Settings {
  if (!value) return { ...defaults };
  const saved = JSON.parse(value);
  return {
    source: typeof saved.source === 'string' ? saved.source : defaultPair.source,
    target: typeof saved.target === 'string' ? saved.target : defaultPair.target,
    provider: typeof saved.provider === 'string' ? saved.provider : '',
    credentials: typeof saved.credentials === 'string' ? saved.credentials : '',
    baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : '',
    count: Number.isInteger(saved.count) ? Math.min(30, Math.max(1, saved.count)) : 10,
    romanize: typeof saved.romanize === 'boolean' ? saved.romanize : true,
    speech: saved.speech === true,
    level: levels.includes(saved.level) ? saved.level : 'auto',
  };
}
import { translate } from './i18n';
