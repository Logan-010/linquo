import { useEffect, useState } from 'preact/hooks';
import { invoke } from '../api';
import { useTranslation } from '../i18n';

interface DownloadProgress { active: boolean; downloaded: number; total: number; file: string; error: string | null }

export function SpeechSettings() {
  const { t } = useTranslation();
  const [ready, setReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    let active = true;
    let wasDownloading = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await invoke<DownloadProgress>('synthesis_download_progress');
        if (!active) return;
        setProgress(next);
        if (wasDownloading && !next.active) {
          const ready = await invoke<boolean>('synthesis_status');
          if (!active) return;
          setReady(ready);
          if (next.error) setError(next.error);
        }
        wasDownloading = next.active;
      } catch (error) { if (active) setError(String(error)); }
      if (active) timer = setTimeout(() => void poll(), 300);
    }
    void poll();
    void invoke<boolean>('synthesis_status').then(value => { if (active) setReady(value); }).catch(error => { if (active) setError(String(error)); });
    return () => { active = false; clearTimeout(timer); };
  }, []);
  async function manage(remove: boolean) {
    setBusy(true); setError('');
    setDownloading(!remove);
    if (!remove) setProgress(null);
    try {
      await invoke(remove ? 'delete_synthesis_weights' : 'download_synthesis_weights');
      setReady(!remove);
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); setDownloading(false); }
  }
  const working = busy || Boolean(progress?.active);
  const showProgress = downloading || progress?.active;
  const percent = progress?.total ? Math.min(100, progress.downloaded / progress.total * 100) : 0;
  return <div class="form-stack">
    <p class="muted" role="status">{t(working ? 'speech.working' : ready ? 'speech.ready' : 'speech.missing')}</p>
    {showProgress && <div class="form-stack">
      <progress max={100} value={progress?.total ? percent : undefined} aria-label={t('speech.progressLabel')} style={{ width: '100%' }}/>
      <small>{progress?.total ? t('speech.progress', {
        percent: Math.floor(percent), downloaded: (progress.downloaded / 1_000_000).toFixed(1), total: (progress.total / 1_000_000).toFixed(1),
      }) : t('speech.preparing')}</small>
      {progress?.file && <small class="muted">{progress.file}</small>}
    </div>}
    <div class="actions">
      <button type="button" class="btn secondary" disabled={working || ready === null} onClick={() => void manage(Boolean(ready))}>{t(ready ? 'speech.delete' : 'speech.download')}</button>
      {!ready && <button type="button" class="text-button" disabled={working} onClick={() => void manage(true)}>{t('speech.clear')}</button>}
    </div>
    {error && <p class="notice error" role="alert">{error}</p>}
  </div>;
}
