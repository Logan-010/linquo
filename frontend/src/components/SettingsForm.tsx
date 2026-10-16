import { useState } from 'preact/hooks';
import { languageName, levels, localProvider, type LanguagePair, type Settings } from '../api';
import { useTranslation } from '../i18n';
import { Icon } from './Icon';

export function SettingsForm({ initial, onSave, busy, pairs, setup = false }: { initial: Settings; onSave: (settings: Settings) => Promise<void>; busy: boolean; pairs: LanguagePair[]; setup?: boolean }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const update = <K extends keyof Settings>(key: K, next: Settings[K]) => setValue(old => ({ ...old, [key]: next }));
  const local = localProvider(value.provider);
  return <form onSubmit={event => { event.preventDefault(); void onSave(value); }} class="form-stack">
    <fieldset disabled={busy} class="form-stack">
      <label>{t('settings.languagePair')}<select value={JSON.stringify([value.source, value.target])} onChange={e => {
        const [source, target] = JSON.parse(e.currentTarget.value) as [string, string];
        setValue(old => ({ ...old, source, target }));
      }}>{pairs.map(pair => <option key={`${pair.source}-${pair.target}`} value={JSON.stringify([pair.source, pair.target])}>{t('app.pair', { source: languageName(pair.source), target: languageName(pair.target) })}</option>)}</select><small>{t('settings.pairHelp')}</small></label>
      <label>{t('settings.provider')}<input required value={value.provider} placeholder={t('settings.providerPlaceholder')} autoCapitalize="off" spellcheck={false} onInput={e => update('provider', e.currentTarget.value)} aria-describedby="provider-help"/><small id="provider-help">{t('settings.providerHelp')}</small></label>
      <label>{t('settings.apiKey')} <span class="optional">{t(local ? 'settings.localKeyOptional' : 'settings.envKeyOptional')}</span><input type="password" value={value.credentials} placeholder={t(local ? 'settings.optional' : 'settings.keyPlaceholder')} autoComplete="off" onInput={e => update('credentials', e.currentTarget.value)}/></label>
      {local && <label>{t('settings.baseUrl')}<input type="url" required value={value.baseUrl} placeholder={t(value.provider.toLowerCase().startsWith('ollama') ? 'settings.ollamaUrl' : 'settings.llamacppUrl')} onInput={e => update('baseUrl', e.currentTarget.value)}/><small>{t('settings.baseUrlHelp', { provider: value.provider.toLowerCase().startsWith('ollama') ? 'Ollama' : 'llama.cpp' })}</small></label>}
      {!setup && <>
        <div class="divider"/>
        <div class="form-grid"><label>{t('settings.count')}<input type="number" min="1" max="30" required value={value.count} onInput={e => update('count', Number(e.currentTarget.value))}/><small>{t('settings.countHelp')}</small></label>
        <label>{t('settings.level')}<select value={value.level} onChange={e => update('level', e.currentTarget.value as Settings['level'])}><option value="auto">{t('settings.autoLevel')}</option>{levels.map(level => <option key={level}>{level}</option>)}</select></label></div>
        <label class="toggle-row"><span>{t('settings.romanization')}<small>{t('settings.romanizationHelp')}</small></span><input type="checkbox" checked={value.romanize} onChange={e => update('romanize', e.currentTarget.checked)}/></label>
      </>}
      <p class="storage-note"><Icon name="leaf" size={16}/>{t('settings.storageNote')}</p>
      <button class="btn primary" type="submit">{t(busy ? 'common.saving' : setup ? 'settings.saveContinue' : 'common.save')}{!busy && <Icon name="arrow"/>}</button>
    </fieldset>
  </form>;
}
