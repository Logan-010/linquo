import { useMemo, useState } from 'preact/hooks';
import { invoke, type Exercise, type Level, type Text } from './api';
import { Icon } from './components';
import { useTranslation } from './i18n';

export interface SessionItem { exercise: Exercise; level: Level }
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function LocalText({ value, romanize }: { value: Text; romanize: boolean }) {
  return <span class="localized">{value.text}{romanize && value.romanization && <small>{value.romanization}</small>}</span>;
}

function Question({ exercise: ex, romanize, disabled, onAnswer }: { exercise: Exercise; romanize: boolean; disabled: boolean; onAnswer: (correct: boolean, solution: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [left, setLeft] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const rightPairs = useMemo(() => ex.type === 'match_pairs' ? shuffle(ex.data.pairs) : [], [ex]);
  let ready = false;
  let correct = false;
  let solution = '';
  if (ex.type === 'word_bank_translation') {
    ready = selected.length > 0;
    correct = ex.data.accepted_orders.some(order => order.length === selected.length && order.every((id, index) => id === selected[index]));
    solution = ex.data.solution.text;
  } else if (ex.type === 'match_pairs') {
    ready = Object.keys(matches).length === ex.data.pairs.length;
    correct = ex.data.pairs.every(item => matches[item.id] === item.id);
    solution = ex.data.pairs.map(item => `${item.source.text} → ${item.target.text}`).join(' · ');
  } else {
    ready = selected.length === 1;
    correct = selected[0] === ex.data.correct_option_id;
    solution = ex.data.solution.text;
  }
  return <>
    <div class="question-heading"><span class="eyebrow">{t(`exercise.types.${ex.type}`)}</span><h2>{ex.instruction}</h2></div>
    {ex.prompt && <div class="prompt"><LocalText value={ex.prompt} romanize={romanize}/></div>}
    <fieldset disabled={disabled} class="question-inputs">
      <legend class="sr-only">{t('exercise.answer')}</legend>
      {ex.type === 'word_bank_translation' && <>
        <div class="answer-bank" aria-label={t('exercise.selectedWords')}>{selected.length === 0 ? <span class="muted">{t('exercise.buildAnswer')}</span> : selected.map((id, index) => <button type="button" class="tile selected" key={id} onClick={() => setSelected(selected.filter((_, i) => i !== index))}><LocalText value={ex.data.tiles.find(tile => tile.id === id)!} romanize={romanize}/><span class="sr-only">{t('exercise.removeWord')}</span></button>)}</div>
        <div class="tile-bank">{ex.data.tiles.map(tile => <button key={tile.id} type="button" class="tile" disabled={selected.includes(tile.id)} onClick={() => setSelected([...selected, tile.id])}><LocalText value={tile} romanize={romanize}/></button>)}</div>
      </>}
      {(ex.type === 'fill_blank' || ex.type === 'vocabulary_choice') && <div class="choices">{ex.data.options.map((option, index) => <button key={option.id} type="button" class={`choice ${selected[0] === option.id ? 'selected' : ''}`} aria-pressed={selected[0] === option.id} onClick={() => setSelected([option.id])}><span class="choice-number">{index + 1}</span><LocalText value={option} romanize={romanize}/>{selected[0] === option.id && <Icon name="check"/>}</button>)}</div>}
      {ex.type === 'match_pairs' && <><p class="muted text-sm">{t('exercise.matchingHelp')}</p><div class="matching-grid"><div>{ex.data.pairs.map((item, i) => <button key={item.id} type="button" class={`tile match-tile ${left === item.id ? 'selected' : ''} ${matches[item.id] ? 'paired' : ''}`} aria-pressed={left === item.id} onClick={() => { setMatches(old => { const copy = { ...old }; delete copy[item.id]; return copy; }); setLeft(item.id); }}><span class="pair-number">{i + 1}</span><LocalText value={item.source} romanize={romanize}/></button>)}</div><div>{rightPairs.map(item => {
        const sourceId = Object.keys(matches).find(id => matches[id] === item.id);
        const number = ex.type === 'match_pairs' ? ex.data.pairs.findIndex(pair => pair.id === sourceId) + 1 : 0;
        return <button key={item.id} type="button" class={`tile match-tile ${sourceId ? 'paired' : ''}`} disabled={!left || Boolean(sourceId)} onClick={() => { if (left) { setMatches({ ...matches, [left]: item.id }); setLeft(null); } }}><span class="pair-number">{number || '·'}</span><LocalText value={item.target} romanize={romanize}/></button>;
      })}</div></div></>}
    </fieldset>
    <div class="question-actions">
      <button class="text-button" disabled={disabled} onClick={() => setHint(!hint)}>{t(hint ? 'exercise.hideHint' : 'exercise.hint')}</button>
      <div class="actions">
        <button type="button" class="btn secondary" disabled={disabled} onClick={() => void onAnswer(false, solution)}>{t('exercise.dontKnow')}</button>
        <button class="btn primary" disabled={!ready || disabled} onClick={() => void onAnswer(correct, solution)}>{t(disabled ? 'common.saving' : 'exercise.check')}<Icon name="check"/></button>
      </div>
    </div>
    {hint && <p class="hint">{ex.hint}</p>}
  </>;
}

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
