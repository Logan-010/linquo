import type { Level, Settings } from '../api';
import { Icon } from '../components';
import { useTranslation } from '../i18n';
import type { Busy, Page } from '../types';

interface GeneratePageProps {
  known: boolean;
  settings: Settings;
  level: Level;
  pairLabel: string;
  busy: Busy;
  disabled: boolean;
  generationMessage: string;
  totalExercises: number;
  generate: (assessment: boolean) => Promise<void>;
  startAssessment: () => Promise<void>;
  setPage: (page: Page) => void;
}

export function GeneratePage({ known, settings, level, pairLabel, busy, disabled, generationMessage, totalExercises, generate, startAssessment, setPage }: GeneratePageProps) {
  const { t } = useTranslation();
  return <>
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
  </>;
}
