import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { defaults, get, initialize, invoke, isTauri, levels, pair, parseSettings, put, scoreKey, type Lesson, type Level, type Settings } from './api';
import { Icon, ImportButton, SettingsForm } from './components';
import { ExerciseSession, type SessionItem } from './ExerciseSession';
import './style.css';

const settingsKey = 'linquo-settings-v1';
const statsKey = 'linquo-stats-English-Korean-v1';
const levelNames: Record<Level, string> = { A1: 'Beginner', A2: 'Elementary', B1: 'Intermediate', B2: 'Upper intermediate', C1: 'Advanced', C2: 'Proficient' };
interface Stats { lessons: number; answers: number; correct: number }
interface Session { items: SessionItem[]; assessment: boolean }
type Page = 'learn' | 'generate' | 'settings';

function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaults);
  const [stats, setStats] = useState<Stats>({ lessons: 0, answers: 0, correct: 0 });
  const [known, setKnown] = useState(false);
  const [level, setLevel] = useState<Level>('A1');
  const [available, setAvailable] = useState<Partial<Record<Level, number>>>({});
  const [page, setPage] = useState<Page>('learn');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [summary, setSummary] = useState<{ correct: number; total: number; assessment: boolean; level: Level } | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);

  function report(error: unknown) { setError(error instanceof Error ? error.message : String(error)); }
  async function refreshLibrary() {
    const counts = await Promise.all(levels.map(async level => {
      const exercises = await invoke<SessionItem['exercise'][]>('fetch_excercises', { ...pair, level, n: 1000 });
      return [level, exercises.length] as const;
    }));
    const result = Object.fromEntries(counts);
    setAvailable(result);
    return result;
  }
  async function boot() {
    setError('');
    const [storedSettings, score, storedStats] = await Promise.all([get(settingsKey), get(scoreKey), get(statsKey)]);
    setSettings(parseSettings(storedSettings));
    setKnown(Boolean(score));
    if (score) setLevel(await invoke<Level>('load_score', { ...pair, quiz: false }));
    else setLevel('A1');
    if (storedStats) {
      const data = JSON.parse(storedStats);
      setStats({ lessons: Math.max(0, Number(data.lessons) || 0), answers: Math.max(0, Number(data.answers) || 0), correct: Math.max(0, Number(data.correct) || 0) });
    } else setStats({ lessons: 0, answers: 0, correct: 0 });
    await refreshLibrary();
    setReady(true);
  }
  useEffect(() => { if (isTauri()) void boot().catch(report); else setReady(true); }, []);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  async function saveSettings(next: Settings) {
    setBusy('settings'); setError(''); setNotice('');
    try {
      if (!/^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?:\S+$/i.test(next.provider.trim())) throw new Error('Enter a provider and model separated by a colon, for example ollama:llama3.2.');
      await put(settingsKey, next);
      setSettings(next); setNotice('Settings saved on this device.');
    } catch (error) { report(error); }
    finally { setBusy(''); }
  }
  async function imported() {
    setSummary(null); setSession(null); setPage('learn'); setNotice('Database imported. Your learning is ready on this device.');
    await boot();
  }
  async function startAssessment() {
    setBusy('assessment'); setError(''); setNotice('');
    try {
      // Check the real score key, including scores from imported databases.
      if (await get(scoreKey)) { await boot(); return; }
      const groups = await Promise.all(levels.map(async level => {
        const exercises = await invoke<SessionItem['exercise'][]>('fetch_excercises', { ...pair, level, n: 2 });
        return exercises.map(exercise => ({ exercise, level }));
      }));
      const items = groups.flat();
      if (!items.length) throw new Error('Your library is empty. Generate a level check or import a database to get started.');
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
      if (!lesson?.exercises.length) throw new Error(`No saved ${practiceLevel} lessons yet. Generate a lesson to add one to your offline library.`);
      setSession({ items: lesson.exercises.map(exercise => ({ exercise, level: lesson.learning_level })), assessment: false }); setSummary(null);
    } catch (error) { report(error); }
    finally { setBusy(''); }
  }
  async function generate(assessment: boolean) {
    setBusy('Connecting to your provider…'); setError(''); setNotice('');
    try {
      if (!settings.provider.trim()) { setPage('settings'); throw new Error('Add a provider in settings to generate new exercises.'); }
      await initialize(settings);
      if (assessment) {
        // Reuse already-saved levels when retrying an interrupted generation.
        for (const targetLevel of levels) {
          const existing = await invoke<SessionItem['exercise'][]>('fetch_excercises', { ...pair, level: targetLevel, n: 2 });
          if (existing.length >= 2) continue;
          setBusy(`Preparing your level check · ${targetLevel} (${levels.indexOf(targetLevel) + 1}/6)…`);
          await invoke<Lesson>('generate_lesson', { ...pair, n: 2, romanize: settings.romanize, level: targetLevel });
        }
        await refreshLibrary();
        setNotice('Your level check is saved and ready. You can take it offline.'); setPage('learn');
      } else {
        const generationLevel = settings.level === 'auto' ? level : settings.level;
        setBusy(`Creating ${settings.count} exercises at ${generationLevel}…`);
        const lesson = await invoke<Lesson>('generate_lesson', { ...pair, n: settings.count, romanize: settings.romanize, level: generationLevel });
        await refreshLibrary();
        setNotice(`${lesson.exercises.length} new ${lesson.learning_level} exercises saved for offline practice.`); setPage('learn');
      }
    } catch (error) { report(error); await refreshLibrary().catch(() => {}); }
    finally { setBusy(''); }
  }
  async function finish(correct: number, total: number) {
    await invoke('save_score');
    const currentLevel = await invoke<Level | null>('score');
    const nextStats = { lessons: stats.lessons + 1, answers: stats.answers + total, correct: stats.correct + correct };
    await put(statsKey, nextStats);
    setStats(nextStats); setKnown(true); setLevel(currentLevel || 'A1');
    setSummary({ correct, total, assessment: session!.assessment, level: currentLevel || 'A1' }); setSession(null);
  }
  const totalExercises = Object.values(available).reduce((sum, count) => sum + (count || 0), 0);
  const setup = ready && isTauri() && !settings.provider && totalExercises === 0;
  const activeLevels = levels.filter(level => (available[level] || 0) > 0);

  return <div class="app-shell">
    <aside class="sidebar">
      <a href="#" class="brand" onClick={e => { e.preventDefault(); if (!session) { setPage('learn'); setSummary(null); } }} aria-label="Linquo home"><span class="brand-mark"><Icon name="leaf" size={26}/></span>linquo<span class="brand-dot">.</span></a>
      <span class="sidebar-label">A little, every day.</span>
      <nav aria-label="Main navigation">{([{ id: 'learn', icon: 'book', label: 'Learn' }, { id: 'generate', icon: 'spark', label: 'Generate' }, { id: 'settings', icon: 'settings', label: 'Settings' }] as const).map(item => <button key={item.id} disabled={Boolean(session) || Boolean(busy)} class={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); setSummary(null); setNotice(''); setError(''); }}><Icon name={item.icon}/><span>{item.label}</span>{item.id === 'generate' && <span class="nav-plus">+</span>}</button>)}</nav>
      <div class="sidebar-footer"><div class="offline-mark"><span/>{offline ? 'You’re offline' : 'Offline-first learning'}</div><p>Your lessons stay with you.<br/>Learn anywhere, at your pace.</p><span class="version">LINQUO / 0.1</span></div>
    </aside>
    <div class="main-shell">
      <header class="topbar"><div class="language-pill"><span class="korean-flag" aria-hidden="true">🇰🇷</span><span>Korean <span class="muted">from English</span></span><Icon name="globe" size={16}/></div><span class="device-status"><span class="status-dot"/>{offline ? 'Offline' : 'Saved on your device'}</span></header>
      <main id="main-content">
        {!isTauri() && <div class="notice" role="status"><strong>Welcome to Linquo’s web preview.</strong> Open the Tauri desktop or mobile app to save your provider, import a database, and learn from local lessons.</div>}
        {error && <div class="notice error" role="alert"><span>{error}</span><button class="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" size={16}/></button></div>}
        {notice && <div class="notice success" role="status"><Icon name="check"/><span>{notice}</span></div>}
        {busy && page !== 'generate' && busy !== 'settings' && busy !== 'lesson' && busy !== 'assessment' && busy !== 'disconnect' && <div class="notice" role="status"><span class="spinner"/>{busy}</div>}
        {!ready ? <div class="loading-state"><span class="spinner"/><h2>Opening your learning space…</h2>{error && <div class="actions"><button class="btn secondary" onClick={() => void boot().catch(report)}>Try again</button><ImportButton onImport={imported} onError={report}/></div>}</div>
        : session ? <ExerciseSession items={session.items} assessment={session.assessment} romanize={settings.romanize} onFinish={finish} onExit={() => { setSession(null); if (known) void invoke<Level>('load_score', { ...pair, quiz: false }).then(setLevel).catch(report); }}/>
        : summary ? <section class="card summary"><span class="summary-icon"><Icon name={summary.assessment ? 'chart' : 'check'} size={40}/></span><span class="eyebrow">{summary.assessment ? 'A starting point, not a limit' : 'One step further'}</span><h1>{summary.assessment ? `Your starting level is ${summary.level}` : 'A little practice. Real progress.'}</h1><p>{summary.assessment ? `${levelNames[summary.level]} Korean. Your lessons can now follow your proficiency.` : 'Your answers have been saved. Come back whenever you’re ready for a little more.'}</p><div class="summary-stats"><div><strong>{summary.correct}/{summary.total}</strong><span>Correct answers</span></div><div><strong>{Math.round(summary.correct / summary.total * 100)}%</strong><span>Accuracy</span></div><div><strong>{summary.level}</strong><span>Current level</span></div></div><button class="btn primary" onClick={() => { setSummary(null); setPage('learn'); }}>Back to learning<Icon name="arrow"/></button></section>
        : setup ? <section class="onboarding"><div class="page-heading"><span class="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span><h1>A language.<br/>A little closer.</h1><p>Make Korean part of your everyday. Connect a model to create your lessons, then learn at your own pace—even offline.</p></div><div class="card setup-card"><div class="step-label"><span>01</span>Set up your learning space</div><h2>Bring your own intelligence.</h2><p>Choose the provider and model that will create your exercises.</p><SettingsForm key="setup" initial={settings} busy={Boolean(busy)} setup onSave={saveSettings}/><div class="import-divider"><span>Already have a Linquo database?</span></div><ImportButton onImport={imported} onError={report} disabled={Boolean(busy)}/></div><p class="onboarding-note"><Icon name="leaf" size={16}/>Your data. Your model. Your pace.</p></section>
        : <>
          {page === 'learn' && <>
            <div class="page-heading"><span class="eyebrow">YOUR DAILY DOSE OF DISCOVERY</span><h1>{known ? 'Small steps. New worlds.' : 'Let’s find your starting point.'}</h1><p>{known ? 'A few minutes of Korean. A little more confidence.' : 'A short level check helps your lessons meet you where you are.'}</p></div>
            <div class="dashboard-grid"><section class="card hero-card"><div class="hero-copy"><span class="badge">{known ? `${level} · ${levelNames[level]}` : 'MADE FOR YOUR LEVEL'}</span><h2>{known ? 'Keep your Korean growing.' : 'Every journey starts somewhere.'}</h2><p>{known ? 'Practice with the exercises in your library. No connection needed, just a little curiosity.' : 'Try a selection of exercises, from everyday basics to more advanced Korean. We’ll use your answers to estimate your level.'}</p>
              {known ? <button class="btn primary" disabled={Boolean(busy) || !isTauri()} onClick={() => available[level] ? void startLesson() : setPage('generate')}>{busy === 'lesson' ? 'Opening…' : available[level] ? 'Start a lesson' : 'Create your next lesson'}<Icon name="arrow"/></button> : <div class="hero-actions"><button class="btn primary" disabled={Boolean(busy) || !isTauri()} onClick={() => totalExercises ? void startAssessment() : void generate(true)}>{busy ? 'Preparing…' : totalExercises ? 'Start level check' : 'Generate level check'}<Icon name={totalExercises ? 'arrow' : 'spark'}/></button>{totalExercises > 0 && activeLevels.length < 6 && <small>Your check uses the levels in your library. Generate a full check for broader coverage.</small>}</div>}
            </div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"/><div class="orbit orbit-two"/><span class="hangul hangul-one">한</span><span class="hangul hangul-two">글</span><span class="art-dot dot-one"/><span class="art-dot dot-two"/><span class="art-caption">a whole new way to say hello.</span></div></section>
              <section class="card progress-card"><div class="card-title"><Icon name="chart"/><h3>Your progress</h3></div><div class="current-level">{known ? level : '—'}<span>{known ? levelNames[level] : 'Ready to discover'}</span></div><div class="level-steps" aria-label={known ? `Current proficiency: ${level}` : 'Level not yet assessed'}>{levels.map(l => <span key={l} class={known && levels.indexOf(l) <= levels.indexOf(level) ? 'filled' : ''}>{l}</span>)}</div><div class="progress-bottom"><div><strong>{stats.lessons}</strong><span>Sessions completed</span></div><div><strong>{stats.answers ? `${Math.round(stats.correct / stats.answers * 100)}%` : '—'}</strong><span>Answer accuracy</span></div></div></section>
            </div>
            <section class="library-section"><div class="section-heading"><div><span class="eyebrow">READY WHEN YOU ARE</span><h2>Your offline library</h2></div><span class="count-label">{totalExercises}{totalExercises >= 1000 ? '+' : ''} exercises saved</span></div>
              {activeLevels.length ? <div class="library-grid">{activeLevels.map(l => <button key={l} class="card level-card" disabled={Boolean(busy) || !isTauri()} onClick={() => known ? void startLesson(l) : void startAssessment()}><span class="level-icon">{l}</span><div><h3>{levelNames[l]}</h3><p>{available[l]}{available[l] === 1000 ? '+' : ''} saved exercises</p></div><Icon name="arrow"/></button>)}</div> : <div class="card empty-library"><div class="empty-icon"><Icon name="book" size={28}/></div><div><h3>A little room for possibility.</h3><p>Generate exercises or import a database. Everything you add will be available offline.</p></div><button class="btn secondary" disabled={Boolean(busy)} onClick={() => setPage('generate')}>Add exercises<Icon name="spark"/></button></div>}
            </section>
            <div class="quiet-note"><Icon name="leaf" size={18}/><p>Learning is a practice, not a race. Make a little space for it.</p></div>
          </>}
          {page === 'generate' && <>
            <div class="page-heading"><span class="eyebrow">CREATE NOW. LEARN ANYWHERE.</span><h1>A fresh page of possibilities.</h1><p>Let your model prepare new exercises. They’re saved to your library automatically.</p></div>
            <div class="settings-layout"><section class="card settings-card"><div class="card-title"><Icon name="spark"/><h2>{known ? 'Create a lesson' : 'Prepare your level check'}</h2></div><p>{known ? 'Fine-tune your next lesson in settings, or generate using your saved preferences.' : 'We’ll create two exercises at each CEFR level, A1 to C2. This uses up to six generation calls. Saved levels are reused when you retry.'}</p><dl class="generation-details"><div><dt>Language</dt><dd>English → Korean</dd></div><div><dt>Provider</dt><dd>{settings.provider || 'Not configured'}</dd></div><div><dt>Level</dt><dd>{known ? settings.level === 'auto' ? `${level} · matches your proficiency` : settings.level : 'A1 through C2'}</dd></div><div><dt>Exercises</dt><dd>{known ? settings.count : '12 · 2 per level'}</dd></div><div><dt>Romanization</dt><dd>{settings.romanize ? 'Included' : 'Not included'}</dd></div></dl><div class="actions"><button class="btn primary" disabled={Boolean(busy) || !isTauri()} onClick={() => void generate(!known)}><Icon name="spark"/>{busy ? 'Generating…' : known ? 'Generate lesson' : 'Generate level check'}</button><button class="btn secondary" disabled={Boolean(busy)} onClick={() => setPage('settings')}>Configure</button></div>{busy && <div class="generation-status" role="status"><span class="spinner"/><span>{busy}<small>You can practice without a connection after this finishes.</small></span></div>}</section><aside class="card tip-card"><span class="eyebrow">A LIBRARY THAT’S YOURS</span><h3>Generate a little ahead.</h3><p>Prepare a few lessons before a trip, your commute, or a quiet moment away from the internet.</p><div class="divider"/><p>Generation uses your configured provider. Local models work with your own running server.</p>{!known && totalExercises > 0 && <button class="text-button" disabled={Boolean(busy)} onClick={() => void startAssessment()}>Use my saved exercises →</button>}</aside></div>
          </>}
          {page === 'settings' && <>
            <div class="page-heading"><span class="eyebrow">MAKE YOURSELF AT HOME</span><h1>Your learning, your way.</h1><p>A few preferences to make your practice feel right.</p></div><div class="settings-layout"><section class="card settings-card"><div class="card-title"><Icon name="settings"/><h2>Provider & lesson preferences</h2></div><SettingsForm key={settings.provider + settings.count + settings.level + settings.romanize} initial={settings} busy={Boolean(busy) || !isTauri()} onSave={saveSettings}/></section><div class="settings-aside"><section class="card tip-card"><span class="eyebrow">YOUR LANGUAGE PAIR</span><h3>English → Korean</h3><p>English-to-Korean is the language pair currently supported by the generation API.</p></section><section class="card tip-card"><span class="eyebrow">TAKE YOUR LEARNING WITH YOU</span><h3>Import a database</h3><p>Restore lessons, settings, and progress from an existing Linquo SQLite database.</p><ImportButton onImport={imported} onError={report} disabled={Boolean(busy) || !isTauri()}/></section>{settings.provider && <section class="card tip-card"><h3>Disconnect provider</h3><p>Remove the saved provider and API key from this device.</p><button class="text-button" disabled={Boolean(busy)} onClick={async () => { setBusy('disconnect'); try { await invoke('kv_rm', { key: settingsKey }); setSettings({ ...defaults }); setNotice('Provider settings removed.'); } catch (error) { report(error); } finally { setBusy(''); } }}>Remove provider</button></section>}</div></div>
          </>}
        </>}
      </main>
      <footer class="page-footer"><span>Made for the way you learn.</span><span>Little by little, Linquo.</span></footer>
    </div>
  </div>;
}

render(<App />, document.getElementById('app')!);
