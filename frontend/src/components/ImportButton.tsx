import { useRef, useState } from 'preact/hooks';
import { invoke } from '../api';
import { useTranslation } from '../i18n';
import { Icon } from './Icon';

export function ImportButton({ onImport, onError, disabled = false }: { onImport: () => Promise<void>; onError: (error: unknown) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function importFile() {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error(t('errors.databaseSize'));
      await invoke('import_database', { bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
      setFile(null);
      await onImport();
    } catch (error) { onError(error); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return <>
    <input ref={input} type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3" class="hidden" onChange={event => { setFile(event.currentTarget.files?.[0] || null); }} />
    <button type="button" class="btn secondary" disabled={disabled || busy} onClick={() => { if (input.current) input.current.value = ''; input.current?.click(); }}><Icon name="download"/>{t('database.import')}</button>
    {file && <div class="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="import-title" class="card modal">
      <span class="eyebrow">{t('database.importEyebrow')}</span><h2 id="import-title">{t('database.replaceTitle')}</h2>
      <p>{t('database.replaceDescription', { filename: file.name })}</p>
      <div class="actions"><button autoFocus class="btn secondary" disabled={busy} onClick={() => setFile(null)}>{t('common.cancel')}</button><button class="btn primary" disabled={busy} onClick={importFile}>{t(busy ? 'database.importing' : 'database.replace')}</button></div>
    </section></div>}
  </>;
}
