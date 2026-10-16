import type { LanguagePair, Settings } from '../api';
import { Icon, ImportButton, SettingsForm } from '../components';
import { useTranslation } from '../i18n';
import type { Busy } from '../types';

interface SettingsPageProps {
  settings: Settings;
  pairs: LanguagePair[];
  pairLabel: string;
  busy: Busy;
  disabled: boolean;
  saveSettings: (settings: Settings) => Promise<void>;
  imported: () => Promise<void>;
  report: (error: unknown) => void;
  exportDatabase: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function SettingsPage({ settings, pairs, pairLabel, busy, disabled, saveSettings, imported, report, exportDatabase, disconnect }: SettingsPageProps) {
  const { t } = useTranslation();
  const formKey = JSON.stringify(settings);
  return <>
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
  </>;
}
