import { useState } from 'preact/hooks';
import { invoke, type Exercise, type Level } from './api';
import { Icon } from './components';
import { Question } from './components/Question';
import { useTranslation } from './i18n';

export interface SessionItem { exercise: Exercise; level: Level }

export function ExerciseSession({ items, assessment, romanize, onFinish, onExit }: { items: SessionItem[]; assessment: boolean; romanize: boolean; onFinish: (correct: number, total: number) => Promise<void>; onExit: () => void }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; solution: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmExit, setConfirmExit] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [pending, setPending] = useState<{ correct: boolean; solution: string } | null>(null);
  const item = items[index];
  async function answer(correct: boolean, solution: string) {
    setBusy(true); setError(''); setPending({ correct, solution });
    try {
      if (!recorded) { await invoke(correct ? 'correct' : 'incorrect', { level: item.level }); setRecorded(true); }
      // Placement is only persisted when the entire check is complete.
      if (!assessment) await invoke('save_score');
      setFeedback({ correct, solution });
      if (correct) setCorrectCount(count => count + 1);
      setPending(null);
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  async function next() {
    if (index + 1 < items.length) { setIndex(index + 1); setFeedback(null); setRecorded(false); }
    else {
      setBusy(true); setError('');
      try { await onFinish(correctCount, items.length); }
      catch (error) { setError(String(error)); }
      finally { setBusy(false); }
    }
  }
  return <section class="session">
    <div class="session-top"><button class="icon-button" aria-label={t('exercise.exit')} onClick={() => setConfirmExit(true)} disabled={busy}><Icon name="close"/></button><div class="progress-track" role="progressbar" aria-label={t('exercise.progress')} aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={index + (feedback ? 1 : 0)}><div style={{ width: `${(index + (feedback ? 1 : 0)) / items.length * 100}%` }}/></div><span class="muted tabular-nums">{t('common.fraction', { current: index + 1, total: items.length })}</span></div>
    <div class="session-meta"><span>{t(assessment ? 'exercise.assessment' : 'exercise.practice')}</span><span class="badge">{item.level}</span></div>
    <div class="card question-card"><Question key={index} exercise={item.exercise} romanize={romanize} disabled={busy || Boolean(feedback) || Boolean(pending)} onAnswer={answer}/>
      {feedback && <div class={`feedback ${feedback.correct ? 'positive' : 'negative'}`} role="status"><div class="feedback-title"><Icon name={feedback.correct ? 'check' : 'book'}/><h3>{t(feedback.correct ? 'exercise.correct' : 'exercise.incorrect')}</h3></div>{!feedback.correct && <p><strong>{t('exercise.correctAnswer')}</strong> {feedback.solution}</p>}<p>{item.exercise.explanation}</p><button class="btn primary" onClick={next} disabled={busy}>{t(busy ? 'common.saving' : index + 1 === items.length ? assessment ? 'exercise.seeLevel' : 'exercise.finish' : 'common.continue')}<Icon name="arrow"/></button></div>}
      {error && <div class="notice error" role="alert"><p>{error}</p>{pending && <button class="text-button" disabled={busy} onClick={() => void answer(pending.correct, pending.solution)}>{t('exercise.retrySave')}</button>}</div>}
    </div>
    {confirmExit && <div class="modal-backdrop"><section class="card modal" role="dialog" aria-modal="true" aria-labelledby="exit-title"><h2 id="exit-title">{t('exercise.pauseTitle')}</h2><p>{t(assessment ? 'exercise.pauseAssessment' : 'exercise.pausePractice')}</p><div class="actions"><button autoFocus class="btn primary" onClick={() => setConfirmExit(false)}>{t('exercise.keepLearning')}</button><button class="btn secondary" onClick={onExit}>{t('exercise.exit')}</button></div></section></div>}
  </section>;
}
