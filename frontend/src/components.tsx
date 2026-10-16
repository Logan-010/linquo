import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { invoke, levels, localProvider, type Settings } from './api';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ComponentChildren> = {
    book: <><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Z"/><path d="M12 6v14"/></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5Z"/></>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    leaf: <><path d="M20 3C5 1 1 12 7 17s16 1 13-14ZM5 21 16 9"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
    chart: <><path d="M4 20h17M7 16v-4m5 4V8m5 8V4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths[name] || paths.book}</svg>;
}

export function ImportButton({ onImport, onError, disabled = false }: { onImport: () => Promise<void>; onError: (error: unknown) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function importFile() {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error('The database must be smaller than 100 MB.');
      await invoke('import_database', { bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
      setFile(null);
      await onImport();
    } catch (error) { onError(error); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return <>
    <input ref={input} type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3" class="hidden" onChange={event => { setFile(event.currentTarget.files?.[0] || null); }} />
    <button type="button" class="btn secondary" disabled={disabled || busy} onClick={() => { if (input.current) input.current.value = ''; input.current?.click(); }}><Icon name="download"/>Import database</button>
    {file && <div class="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="import-title" class="card modal">
      <span class="eyebrow">Bring your learning with you</span><h2 id="import-title">Replace this database?</h2>
      <p>Importing <strong>{file.name}</strong> replaces your current lessons, progress, and settings with those in the file.</p>
      <div class="actions"><button autoFocus class="btn secondary" disabled={busy} onClick={() => setFile(null)}>Cancel</button><button class="btn primary" disabled={busy} onClick={importFile}>{busy ? 'Importing…' : 'Replace & import'}</button></div>
    </section></div>}
  </>;
}

export function SettingsForm({ initial, onSave, busy, setup = false }: { initial: Settings; onSave: (settings: Settings) => Promise<void>; busy: boolean; setup?: boolean }) {
  const [value, setValue] = useState(initial);
  const update = <K extends keyof Settings>(key: K, next: Settings[K]) => setValue(old => ({ ...old, [key]: next }));
  const local = localProvider(value.provider);
  return <form onSubmit={event => { event.preventDefault(); void onSave(value); }} class="form-stack">
    <fieldset disabled={busy} class="form-stack">
      <label>Provider & model<input required value={value.provider} placeholder="openai:gpt-4o-mini" autoCapitalize="off" spellcheck={false} onInput={e => update('provider', e.currentTarget.value)} aria-describedby="provider-help"/><small id="provider-help">Use a provider:model reference, such as openai:gpt-4o-mini or ollama:llama3.2.</small></label>
      <label>API key <span class="optional">{local ? '(optional for local models)' : '(optional if configured in your environment)'}</span><input type="password" value={value.credentials} placeholder={local ? 'Optional' : 'Your provider API key'} autoComplete="off" onInput={e => update('credentials', e.currentTarget.value)}/></label>
      {local && <label>Base URL<input type="url" required value={value.baseUrl} placeholder={value.provider.toLowerCase().startsWith('ollama') ? 'http://localhost:11434' : 'http://localhost:8080/v1'} onInput={e => update('baseUrl', e.currentTarget.value)}/><small>The address of your running {value.provider.toLowerCase().startsWith('ollama') ? 'Ollama' : 'llama.cpp'} server.</small></label>}
      {!setup && <>
        <div class="divider"/>
        <div class="form-grid"><label>Exercises per lesson<input type="number" min="1" max="30" required value={value.count} onInput={e => update('count', Number(e.currentTarget.value))}/><small>Between 1 and 30 exercises.</small></label>
        <label>Generation level<select value={value.level} onChange={e => update('level', e.currentTarget.value as Settings['level'])}><option value="auto">Match my proficiency</option>{levels.map(level => <option key={level}>{level}</option>)}</select></label></div>
        <label class="toggle-row"><span>Show romanization<small>Reading support alongside Korean text.</small></span><input type="checkbox" checked={value.romanize} onChange={e => update('romanize', e.currentTarget.checked)}/></label>
      </>}
      <p class="storage-note"><Icon name="leaf" size={16}/>Saved on this device in your app database, including the API key.</p>
      <button class="btn primary" type="submit">{busy ? 'Saving…' : setup ? 'Save & continue' : 'Save settings'}{!busy && <Icon name="arrow"/>}</button>
    </fieldset>
  </form>;
}
