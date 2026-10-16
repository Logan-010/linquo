import { useEffect, useState } from 'preact/hooks';
import {
  defaultPair, defaults, get, initialize, invoke, isTauri, languageName, levels,
  parseSettings, put, scoreKey, statsKey, type Exercise, type LanguagePair, type Lesson, type Level, type Settings,
} from '../api';
import type { SessionItem } from '../ExerciseSession';
import { useTranslation } from '../i18n';
import appIcon from '../../../linquo-app/icons/icon.png';
import type { Busy, Page, Stats } from '../types';

const settingsKey = 'linquo-settings-v1';
interface Session { items: SessionItem[]; assessment: boolean }

export function useApp() {
  const { t, language } = useTranslation();
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaults);
  const [pairs, setPairs] = useState<LanguagePair[]>([defaultPair]);
  const [stats, setStats] = useState<Stats>({ lessons: 0, answers: 0, correct: 0 });
  const [known, setKnown] = useState(false);
  const [level, setLevel] = useState<Level>('A1');
  const [available, setAvailable] = useState<Partial<Record<Level, number>>>({});
  const [page, setPage] = useState<Page>('learn');
  const [busy, setBusy] = useState<Busy>('');
  const [generationStatus, setGenerationStatus] = useState<{ key: 'busy.connecting' | 'busy.assessment' | 'busy.generating'; values?: Record<string, string | number> }>({ key: 'busy.connecting' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [summary, setSummary] = useState<{ correct: number; total: number; assessment: boolean; level: Level } | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const pair: LanguagePair = { source: settings.source, target: settings.target };
  const pairLabel = t('app.pair', { source: languageName(pair.source), target: languageName(pair.target) });

  function report(error: unknown) { setError(error instanceof Error ? error.message : String(error)); }
  async function refreshLibrary(activePair = pair) {
    const counts = await Promise.all(levels.map(async level => {
      const exercises = await invoke<SessionItem['exercise'][]>('fetch_excercises', { ...activePair, level, n: 1000 });
      return [level, exercises.length] as const;
    }));
    setAvailable(Object.fromEntries(counts));
  }
  async function loadPair(activePair: LanguagePair) {
    const [score, storedStats] = await Promise.all([get(scoreKey(activePair)), get(statsKey(activePair))]);
    setKnown(Boolean(score));
    setLevel(score ? await invoke<Level>('load_score', { ...activePair, quiz: false }) : 'A1');
    if (storedStats) {
      const data = JSON.parse(storedStats);
      setStats({ lessons: Math.max(0, Number(data.lessons) || 0), answers: Math.max(0, Number(data.answers) || 0), correct: Math.max(0, Number(data.correct) || 0) });
    } else setStats({ lessons: 0, answers: 0, correct: 0 });
    await refreshLibrary(activePair);
  }
  async function boot() {
    setError('');
    const [storedSettings, supported] = await Promise.all([
      get(settingsKey), invoke<[string, string][]>('supported_language_pairs'),
    ]);
    if (!supported.length) throw new Error(t('errors.unsupportedPair'));
    const nextPairs = supported.map(([source, target]) => ({ source, target }));
    const next = parseSettings(storedSettings);
    if (!nextPairs.some(p => p.source === next.source && p.target === next.target)) Object.assign(next, nextPairs[0]);
    setPairs(nextPairs);
    setSettings(next);
    await loadPair(next);
    setReady(true);
  }
  useEffect(() => { if (isTauri()) void boot().catch(report); else setReady(true); }, []);
  useEffect(() => {
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.type = 'image/png';
    favicon.href = appIcon;
    document.head.append(favicon);
    return () => favicon.remove();
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t('app.name');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
  }, [language]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  async function saveSettings(next: Settings) {
    setBusy('settings'); setError(''); setNotice('');
    try {
      if (!/^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?:\S+$/i.test(next.provider.trim())) throw new Error(t('errors.providerFormat'));
      if (!pairs.some(p => p.source === next.source && p.target === next.target)) throw new Error(t('errors.unsupportedPair'));
      await put(settingsKey, next);
      if (next.source !== pair.source || next.target !== pair.target) await loadPair(next);
      setSettings(next);
      setNotice(t('notices.settingsSaved'));
    } catch (error) { report(error); }
    finally { setBusy(''); }
  }
  async function imported() {
    setSummary(null); setSession(null); setPage('learn');
    await boot();
    setNotice(t('notices.imported'));
  }
  async function exportDatabase() {
    setBusy('export'); setError(''); setNotice('');
    try {
      const path = await invoke<string>('export_database');
      setNotice(t('notices.exported', { path }));
    } catch (error) { report(error); }
    finally { setBusy(''); }
  }
  async function disconnect() {
    setBusy('disconnect'); setError(''); setNotice('');
    try {
      const next = { ...settings, provider: '', credentials: '', baseUrl: '' };
      await put(settingsKey, next);
      setSettings(next); setNotice(t('notices.disconnected'));
    } catch (error) { report(error); }
    finally { setBusy(''); }
  }
  async function startAssessment() {
    setBusy('assessment'); setError(''); setNotice('');
    try {
      if (await get(scoreKey(pair))) { await boot(); return; }
      const groups = await Promise.all(levels.map(async level => {
        const exercises = await invoke<SessionItem['exercise'][]>('fetch_excercises', { ...pair, level, n: 2 });
        return exercises.map(exercise => ({ exercise, level }));
      }));
      const items = groups.flat();
      if (!items.length) throw new Error(t('errors.emptyLibrary'));
      await invoke('load_score', { ...pair, quiz: true });
      setSession({ items, assessment: true }); setSummary(null);
    } catch (error) { report(error); }
    finally { setBusy(''); }
  }
  async function startLesson(practiceLevel = level) {
    setBusy('lesson'); setError(''); setNotice('');
    try {
      await invoke('load_score', { ...pair, quiz: false });
      const exercises = await invoke<Exercise[]>('fetch_excercises', { ...pair, level: practiceLevel, n: settings.count });
      if (!exercises.length) throw new Error(t('errors.noLesson', { level: practiceLevel }));
      setSession({ items: exercises.map(exercise => ({ exercise, level: practiceLevel })), assessment: false });
      setSummary(null);
    } catch (error) { report(error); }
    finally { setBusy(''); }
  }
  async function generate(assessment: boolean) {
    setBusy('generation'); setGenerationStatus({ key: 'busy.connecting' }); setError(''); setNotice('');
    try {
      if (!settings.provider.trim()) { setPage('settings'); throw new Error(t('errors.providerRequired')); }
      await initialize(settings);
      if (assessment) {
        for (const targetLevel of levels) {
          const existing = await invoke<SessionItem['exercise'][]>('fetch_excercises', { ...pair, level: targetLevel, n: 2 });
          if (existing.length >= 2) continue;
          setGenerationStatus({ key: 'busy.assessment', values: { level: targetLevel, current: levels.indexOf(targetLevel) + 1, total: levels.length } });
          await invoke<Lesson>('generate_lesson', { ...pair, n: 2, romanize: settings.romanize, level: targetLevel });
        }
        await refreshLibrary();
        setNotice(t('notices.assessmentReady')); setPage('learn');
      } else {
        const generationLevel = settings.level === 'auto' ? level : settings.level;
        setGenerationStatus({ key: 'busy.generating', values: { count: settings.count, level: generationLevel } });
        const lesson = await invoke<Lesson>('generate_lesson', { ...pair, n: settings.count, romanize: settings.romanize, level: generationLevel });
        await refreshLibrary();
        setNotice(t('notices.generated', { count: lesson.exercises.length, level: lesson.learning_level })); setPage('learn');
      }
    } catch (error) { report(error); await refreshLibrary().catch(() => { }); }
    finally { setBusy(''); }
  }
  async function finish(correct: number, total: number) {
    await invoke('save_score');
    const currentLevel = await invoke<Level | null>('score');
    const nextStats = { lessons: stats.lessons + 1, answers: stats.answers + total, correct: stats.correct + correct };
    await put(statsKey(pair), nextStats);
    setStats(nextStats); setKnown(true); setLevel(currentLevel || 'A1');
    setSummary({ correct, total, assessment: session!.assessment, level: currentLevel || 'A1' }); setSession(null);
  }
  const totalExercises = Object.values(available).reduce((sum, count) => sum + (count || 0), 0);
  const setup = ready && isTauri() && !settings.provider && totalExercises === 0;
  const disabled = Boolean(busy) || !isTauri();
  const generationMessage = t(generationStatus.key, generationStatus.values);

  function exitSession() {
    setSession(null);
    if (known) void invoke<Level>('load_score', { ...pair, quiz: false }).then(setLevel).catch(report);
  }

  return {
    ready, settings, pairs, stats, known, level, available, page, busy, error, notice,
    session, summary, offline, pair, pairLabel, totalExercises, setup, disabled, generationMessage,
    setPage, setSummary, setNotice, setError,
    boot, report, saveSettings, imported, exportDatabase, disconnect,
    startAssessment, startLesson, generate, finish, exitSession,
  };
}
