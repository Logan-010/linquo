import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Exercise, Text } from '../api';
import { Icon } from './Icon';
import { useTranslation } from '../i18n';
import { useSpeech } from '../hooks/useSpeech';

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

export function Question({ exercise: ex, romanize, speech, disabled, onAnswer }: { exercise: Exercise; romanize: boolean; speech: boolean; disabled: boolean; onAnswer: (correct: boolean, solution: string) => Promise<void> }) {
  const { t } = useTranslation();
  const { speak, stop, error: speechError } = useSpeech(speech);
  useEffect(() => {
    if (ex.prompt) speak(ex.prompt.text);
    return stop;
  }, [ex, speech]);
  const [selected, setSelected] = useState<string[]>([]);
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [left, setLeft] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const rightPairs = useMemo(() => ex.type === 'match_pairs' ? shuffle(ex.data.pairs) : [], [ex]);
  const tiles = useMemo(() => ex.type === 'word_bank_translation' ? shuffle(ex.data.tiles) : [], [ex]);
  const options = useMemo(() => ex.type === 'fill_blank' || ex.type === 'vocabulary_choice' ? shuffle(ex.data.options) : [], [ex]);
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
    {ex.prompt && <div class="prompt"><LocalText value={ex.prompt} romanize={romanize}/>{speech && <button type="button" class="text-button" onClick={() => speak(ex.prompt!.text)}>{t('speech.replay')}</button>}</div>}
    {speechError && <p class="notice error" role="alert">{speechError}</p>}
    <fieldset disabled={disabled} class="question-inputs" onClick={event => {
      if (disabled) return;
      const button = (event.target as HTMLElement).closest('button');
      const text = button?.querySelector('.localized')?.firstChild?.textContent;
      if (button && !button.disabled && text) speak(text);
    }}>
      <legend class="sr-only">{t('exercise.answer')}</legend>
      {ex.type === 'word_bank_translation' && <>
        <div class="answer-bank" aria-label={t('exercise.selectedWords')}>{selected.length === 0 ? <span class="muted">{t('exercise.buildAnswer')}</span> : selected.map((id, index) => <button type="button" class="tile selected" key={id} onClick={() => setSelected(selected.filter((_, i) => i !== index))}><LocalText value={ex.data.tiles.find(tile => tile.id === id)!} romanize={romanize}/><span class="sr-only">{t('exercise.removeWord')}</span></button>)}</div>
        <div class="tile-bank">{tiles.map(tile => <button key={tile.id} type="button" class="tile" disabled={selected.includes(tile.id)} onClick={() => setSelected([...selected, tile.id])}><LocalText value={tile} romanize={romanize}/></button>)}</div>
      </>}
      {(ex.type === 'fill_blank' || ex.type === 'vocabulary_choice') && <div class="choices">{options.map((option, index) => <button key={option.id} type="button" class={`choice ${selected[0] === option.id ? 'selected' : ''}`} aria-pressed={selected[0] === option.id} onClick={() => setSelected([option.id])}><span class="choice-number">{index + 1}</span><LocalText value={option} romanize={romanize}/>{selected[0] === option.id && <Icon name="check"/>}</button>)}</div>}
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
