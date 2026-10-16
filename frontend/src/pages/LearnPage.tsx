import { levels, type Level } from '../api';
import { Icon } from '../components';
import { useTranslation } from '../i18n';
import type { Busy, Page, Stats } from '../types';

interface LearnPageProps {
  known: boolean;
  level: Level;
  available: Partial<Record<Level, number>>;
  stats: Stats;
  busy: Busy;
  disabled: boolean;
  totalExercises: number;
  startLesson: (level?: Level) => Promise<void>;
  startAssessment: () => Promise<void>;
  generate: (assessment: boolean) => Promise<void>;
  setPage: (page: Page) => void;
}

export function LearnPage({ known, level, available, stats, busy, disabled, totalExercises, startLesson, startAssessment, generate, setPage }: LearnPageProps) {
  const { t } = useTranslation();
  const proficiency = (value: Level) => t(`levels.${value}`);
  const percent = (value: number) => t('common.percent', { value: Math.round(value) });
  const activeLevels = levels.filter(level => (available[level] || 0) > 0);
  return <>
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
  </>;
}
