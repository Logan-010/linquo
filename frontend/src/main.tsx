import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  defaultPair, defaults, get, initialize, invoke, isTauri, languageName, levels,
  parseSettings, put, scoreKey, statsKey, type LanguagePair, type Lesson, type Level, type Settings,
} from './api';
import { Icon, ImportButton, SettingsForm } from './components';
import { ExerciseSession, type SessionItem } from './ExerciseSession';
import { useTranslation } from './i18n';
import appIcon from '../../linquo-app/icons/icon.png';
import './style.css';

const settingsKey = 'linquo-settings-v1';
interface Stats { lessons: number; answers: number; correct: number }
interface Session { items: SessionItem[]; assessment: boolean }
type Page = 'learn' | 'generate' | 'settings';
type Busy = '' | 'settings' | 'assessment' | 'lesson' | 'generation' | 'disconnect' | 'export';

function App() {
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
  const proficiency = (value: Level) => t(`levels.${value}`);
  const percent = (value: number) => t('common.percent', { value: Math.round(value) });

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
      const lesson = await invoke<Lesson | null>('fetch_lesson', { ...pair, level: practiceLevel });
      if (!lesson?.exercises.length) throw new Error(t('errors.noLesson', { level: practiceLevel }));
      setSession({ items: lesson.exercises.map(exercise => ({ exercise, level: lesson.learning_level })), assessment: false });
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
  const activeLevels = levels.filter(level => (available[level] || 0) > 0);
  const formKey = JSON.stringify(settings);
  const disabled = Boolean(busy) || !isTauri();
  const generationMessage = t(generationStatus.key, generationStatus.values);

  return <div class="app-shell">
    <aside class="sidebar">
      <a href="#" class="brand" onClick={e => { e.preventDefault(); if (!session && !busy) { setPage('learn'); setSummary(null); } }} aria-label={t('app.home')}>
        <img class="brand-mark" src={appIcon} alt="" width={32} height={32} />{t('app.wordmark')}<span class="brand-dot">.</span>
      </a>
      <span class="sidebar-label">{t('app.tagline')}</span>
      <nav aria-label={t('app.navigation')}>
        {([{ id: 'learn', icon: 'book' }, { id: 'generate', icon: 'spark' }, { id: 'settings', icon: 'settings' }] as const).map(item =>
          <button key={item.id} disabled={Boolean(session) || Boolean(busy)} class={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); setSummary(null); setNotice(''); setError(''); }}>
            <Icon name={item.icon} /><span>{t(`nav.${item.id}`)}</span>{item.id === 'generate' && <span class="nav-plus" aria-hidden="true">+</span>}
          </button>,
        )}
      </nav>
      <div class="sidebar-footer">
        <div class="offline-mark"><span />{t(offline ? 'app.offlineNotice' : 'app.offlineFirst')}</div>
        <p>{t('app.sidebarNote')}</p><span class="version">{t('app.version', { version: '0.1' })}</span>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="language-pill"><Icon name="globe" /><span>{languageName(pair.target)} <span class="muted">{t('app.from', { language: languageName(pair.source) })}</span></span></div>
        <span class="device-status"><span class="status-dot" />{t(offline ? 'app.offline' : 'app.local')}</span>
      </header>
      <main id="main-content">
        {!isTauri() && <div class="notice" role="status"><strong>{t('app.previewTitle')}</strong> {t('app.previewBody')}</div>}
        {error && <div class="notice error" role="alert"><span>{error}</span><button class="icon-button" aria-label={t('common.dismissError')} onClick={() => setError('')}><Icon name="close" size={16} /></button></div>}
        {notice && <div class="notice success" role="status"><Icon name="check" /><span>{notice}</span></div>}
        {busy === 'generation' && page !== 'generate' && <div class="notice" role="status"><span class="spinner" />{generationMessage}</div>}
        {busy === 'export' && <div class="notice" role="status"><span class="spinner" />{t('busy.exporting')}</div>}
        {!ready ? <div class="loading-state">
          <span class="spinner" /><h2>{t('app.opening')}</h2>
          {error && <div class="actions"><button class="btn secondary" onClick={() => void boot().catch(report)}>{t('common.retry')}</button><ImportButton onImport={imported} onError={report} /></div>}
        </div>
          : session ? <ExerciseSession items={session.items} assessment={session.assessment} romanize={settings.romanize} onFinish={finish} onExit={() => {
            setSession(null);
            if (known) void invoke<Level>('load_score', { ...pair, quiz: false }).then(setLevel).catch(report);
          }} />
            : summary ? <section class="card summary">
              <span class="summary-icon"><Icon name={summary.assessment ? 'chart' : 'check'} size={40} /></span>
              <span class="eyebrow">{t(summary.assessment ? 'summary.assessmentEyebrow' : 'summary.eyebrow')}</span>
              <h1>{summary.assessment ? t('summary.assessmentTitle', { level: summary.level }) : t('summary.title')}</h1>
              <p>{summary.assessment ? t('summary.assessmentDescription', { proficiency: proficiency(summary.level), language: languageName(pair.target) }) : t('summary.description')}</p>
              <div class="summary-stats">
                <div><strong>{t('common.fraction', { current: summary.correct, total: summary.total })}</strong><span>{t('summary.correct')}</span></div>
                <div><strong>{percent(summary.correct / summary.total * 100)}</strong><span>{t('summary.accuracy')}</span></div>
                <div><strong>{summary.level}</strong><span>{t('summary.level')}</span></div>
              </div>
              <button class="btn primary" onClick={() => { setSummary(null); setPage('learn'); }}>{t('summary.back')}<Icon name="arrow" /></button>
            </section>
              : setup ? <section class="onboarding">
                <div class="page-heading"><span class="eyebrow">{t('setup.eyebrow')}</span><h1>{t('setup.title')}</h1><p>{t('setup.description')}</p></div>
                <div class="card setup-card">
                  <div class="step-label"><span>{t('setup.step')}</span>{t('setup.stepLabel')}</div>
                  <h2>{t('setup.providerTitle')}</h2><p>{t('setup.providerDescription')}</p>
                  <SettingsForm key="setup" initial={settings} pairs={pairs} busy={Boolean(busy)} setup onSave={saveSettings} />
                  <div class="import-divider"><span>{t('setup.existing')}</span></div><ImportButton onImport={imported} onError={report} disabled={Boolean(busy)} />
                </div>
                <p class="onboarding-note"><Icon name="globe" size={16} />{t('setup.note')}</p>
              </section>
                : <>
                  {page === 'learn' && <>
                    <div class="page-heading">
                      <span class="eyebrow">{t('home.eyebrow')}</span><h1>{t(known ? 'home.title' : 'home.newTitle')}</h1><p>{t(known ? 'home.description' : 'home.newDescription')}</p>
                    </div>
                    <div class="dashboard-grid">
                      <section class="card hero-card">
                        <div class="hero-copy">
                          <span class="badge">{known ? t('common.levelName', { level, name: proficiency(level) }) : t('home.badge')}</span>
                          <h2>{t(known ? 'home.heroTitle' : 'home.newHeroTitle')}</h2><p>{t(known ? 'home.heroDescription' : 'home.newHeroDescription')}</p>
                          {known ? <button class="btn primary" disabled={disabled} onClick={() => available[level] ? void startLesson() : setPage('generate')}>
                            {t(busy === 'lesson' ? 'home.opening' : available[level] ? 'home.startLesson' : 'home.createLesson')}<Icon name="arrow" />
                          </button> : <div class="hero-actions">
                            <button class="btn primary" disabled={disabled} onClick={() => totalExercises ? void startAssessment() : void generate(true)}>
                              {t(busy ? 'home.preparing' : totalExercises ? 'home.startAssessment' : 'home.generateAssessment')}<Icon name={totalExercises ? 'arrow' : 'spark'} />
                            </button>
                            {totalExercises > 0 && activeLevels.length < levels.length && <small>{t('home.partialCheck')}</small>}
                          </div>}
                        </div>
                      </section>
                      <section class="card progress-card">
                        <div class="card-title"><Icon name="chart" /><h3>{t('home.progress')}</h3></div>
                        <div class="current-level">{known ? level : t('common.unknown')}<span>{known ? proficiency(level) : t('home.discover')}</span></div>
                        <div class="level-steps" aria-label={known ? t('home.proficiency', { level }) : t('home.unassessed')}>
                          {levels.map(l => <span key={l} class={known && levels.indexOf(l) <= levels.indexOf(level) ? 'filled' : ''}>{l}</span>)}
                        </div>
                        <div class="progress-bottom"><div><strong>{stats.lessons}</strong><span>{t('home.sessions')}</span></div><div><strong>{stats.answers ? percent(stats.correct / stats.answers * 100) : t('common.unknown')}</strong><span>{t('home.accuracy')}</span></div></div>
                      </section>
                    </div>
                    <section class="library-section">
                      <div class="section-heading"><div><span class="eyebrow">{t('home.libraryEyebrow')}</span><h2>{t('home.library')}</h2></div><span class="count-label">{t('home.saved', { count: totalExercises, suffix: Object.values(available).includes(1000) ? '+' : '' })}</span></div>
                      {activeLevels.length ? <div class="library-grid">
                        {activeLevels.map(l => <button key={l} class="card level-card" disabled={disabled} onClick={() => known ? void startLesson(l) : void startAssessment()}>
                          <span class="level-icon">{l}</span><div><h3>{proficiency(l)}</h3><p>{t('home.saved', { count: available[l] || 0, suffix: available[l] === 1000 ? '+' : '' })}</p></div><Icon name="arrow" />
                        </button>)}
                      </div> : <div class="card empty-library">
                        <div class="empty-icon"><Icon name="book" size={28} /></div><div><h3>{t('home.emptyTitle')}</h3><p>{t('home.emptyDescription')}</p></div>
                        <button class="btn secondary" disabled={Boolean(busy)} onClick={() => setPage('generate')}>{t('home.addExercises')}<Icon name="spark" /></button>
                      </div>}
                    </section>
                    <div class="quiet-note"><Icon name="globe" size={18} /><p>{t('home.note')}</p></div>
                  </>}
                  {page === 'generate' && <>
                    <div class="page-heading"><span class="eyebrow">{t('generation.eyebrow')}</span><h1>{t('generation.title')}</h1><p>{t('generation.description')}</p></div>
                    <div class="settings-layout">
                      <section class="card settings-card">
                        <div class="card-title"><Icon name="spark" /><h2>{t(known ? 'generation.lessonTitle' : 'generation.assessmentTitle')}</h2></div>
                        <p>{t(known ? 'generation.lessonDescription' : 'generation.assessmentDescription')}</p>
                        <dl class="generation-details">
                          <div><dt>{t('generation.language')}</dt><dd>{pairLabel}</dd></div>
                          <div><dt>{t('generation.provider')}</dt><dd>{settings.provider || t('common.notConfigured')}</dd></div>
                          <div><dt>{t('generation.level')}</dt><dd>{known ? settings.level === 'auto' ? t('generation.autoLevel', { level }) : settings.level : t('generation.allLevels')}</dd></div>
                          <div><dt>{t('generation.exercises')}</dt><dd>{known ? settings.count : t('generation.assessmentCount')}</dd></div>
                          <div><dt>{t('generation.romanization')}</dt><dd>{t(settings.romanize ? 'common.included' : 'common.notIncluded')}</dd></div>
                        </dl>
                        <div class="actions"><button class="btn primary" disabled={disabled} onClick={() => void generate(!known)}><Icon name="spark" />{t(busy ? 'generation.generating' : known ? 'generation.generateLesson' : 'generation.generateAssessment')}</button><button class="btn secondary" disabled={Boolean(busy)} onClick={() => setPage('settings')}>{t('common.configure')}</button></div>
                        {busy === 'generation' && <div class="generation-status" role="status"><span class="spinner" /><span>{generationMessage}<small>{t('generation.statusNote')}</small></span></div>}
                      </section>
                      <aside class="card tip-card"><span class="eyebrow">{t('generation.tipEyebrow')}</span><h3>{t('generation.tipTitle')}</h3><p>{t('generation.tipDescription')}</p><div class="divider" /><p>{t('generation.providerNote')}</p>{!known && totalExercises > 0 && <button class="text-button" disabled={Boolean(busy)} onClick={() => void startAssessment()}>{t('generation.useSaved')}</button>}</aside>
                    </div>
                  </>}
                  {page === 'settings' && <>
                    <div class="page-heading"><span class="eyebrow">{t('settings.eyebrow')}</span><h1>{t('settings.title')}</h1><p>{t('settings.description')}</p></div>
                    <div class="settings-layout">
                      <section class="card settings-card"><div class="card-title"><Icon name="settings" /><h2>{t('settings.preferences')}</h2></div><SettingsForm key={formKey} initial={settings} pairs={pairs} busy={disabled} onSave={saveSettings} /></section>
                      <div class="settings-aside">
                        <section class="card tip-card"><span class="eyebrow">{t('settings.pairEyebrow')}</span><h3>{pairLabel}</h3><p>{t('settings.pairHelp')}</p></section>
                        <section class="card tip-card">
                          <span class="eyebrow">{t('settings.databaseEyebrow')}</span><h3>{t('settings.databaseTitle')}</h3><p>{t('settings.databaseDescription')}</p>
                          <div class="database-actions"><ImportButton onImport={imported} onError={report} disabled={disabled} /><button class="btn secondary" disabled={disabled} onClick={() => void exportDatabase()}><Icon name="download" />{t(busy === 'export' ? 'database.exporting' : 'database.export')}</button></div>
                        </section>
                        {settings.provider && <section class="card tip-card"><h3>{t('settings.disconnect')}</h3><p>{t('settings.disconnectDescription')}</p><button class="text-button" disabled={Boolean(busy)} onClick={() => void disconnect()}>{t('settings.removeProvider')}</button></section>}
                      </div>
                    </div>
                  </>}
                </>}
      </main>
      <footer class="page-footer"><span>{t('app.footer')}</span><span>{t('app.footerTagline')}</span></footer>
    </div>
  </div>;
}

render(<App />, document.getElementById('app')!);
