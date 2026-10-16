import { isTauri, languageName, type Level } from './api';
import { Icon, ImportButton, SettingsForm } from './components';
import { ExerciseSession } from './ExerciseSession';
import { useApp } from './hooks/useApp';
import { useTranslation } from './i18n';
import { LearnPage } from './pages/LearnPage';
import { GeneratePage } from './pages/GeneratePage';
import { SettingsPage } from './pages/SettingsPage';
import appIcon from '../../linquo-app/icons/icon.png';

export function App() {
  const { t } = useTranslation();
  const {
    ready, settings, pairs, stats, known, level, available, page, busy, error, notice,
    session, summary, offline, pair, pairLabel, totalExercises, setup, disabled, generationMessage,
    setPage, setSummary, setNotice, setError,
    boot, report, saveSettings, imported, exportDatabase, disconnect,
    startAssessment, startLesson, generate, finish, exitSession,
  } = useApp();
  const proficiency = (value: Level) => t(`levels.${value}`);
  const percent = (value: number) => t('common.percent', { value: Math.round(value) });

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
          : session ? <ExerciseSession items={session.items} assessment={session.assessment} romanize={settings.romanize} speech={settings.speech} onFinish={finish} onExit={exitSession} />
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
                  {page === 'learn' && <LearnPage known={known} level={level} available={available} stats={stats} busy={busy} disabled={disabled} totalExercises={totalExercises} startLesson={startLesson} startAssessment={startAssessment} generate={generate} setPage={setPage} />}
                  {page === 'generate' && <GeneratePage known={known} settings={settings} level={level} pairLabel={pairLabel} busy={busy} disabled={disabled} generationMessage={generationMessage} totalExercises={totalExercises} generate={generate} startAssessment={startAssessment} setPage={setPage} />}
                  {page === 'settings' && <SettingsPage settings={settings} pairs={pairs} pairLabel={pairLabel} busy={busy} disabled={disabled} saveSettings={saveSettings} imported={imported} report={report} exportDatabase={exportDatabase} disconnect={disconnect} />}
                </>}
      </main>
      <footer class="page-footer"><span>{t('app.footer')}</span><span>{t('app.footerTagline')}</span></footer>
    </div>
  </div>;
}
