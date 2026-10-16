import { useEffect, useRef, useState } from 'preact/hooks';
import { invoke } from '../api';

export function useSpeech(enabled: boolean) {
  const [error, setError] = useState('');
  const context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const generation = useRef(0);
  const pending = useRef<{ text: string; rate: number; resumed: Promise<void> }[]>([]);
  const finishPlayback = useRef<(() => void) | null>(null);
  const running = useRef(false);
  const active = useRef(enabled);
  active.current = enabled;

  function stop() {
    generation.current++;
    pending.current = [];
    source.current?.stop();
    source.current = null;
    finishPlayback.current?.();
    finishPlayback.current = null;
  }
  useEffect(() => {
    if (!enabled) stop();
    return () => { stop(); void context.current?.close(); context.current = null; };
  }, [enabled]);

  async function drain() {
    if (running.current) return;
    running.current = true;
    try {
      while (pending.current.length && active.current) {
        const { text, rate, resumed } = pending.current.shift()!;
        const request = generation.current;
        try {
          await resumed;
          if (request !== generation.current || !active.current) continue;
          const raw = await invoke<ArrayBuffer | number[]>('speek', { text });
          if (request !== generation.current || !active.current) continue;
          const bytes = raw instanceof ArrayBuffer ? raw : new Uint8Array(raw).buffer;
          const view = new DataView(bytes);
          const ctx = context.current;
          if (!ctx || ctx.state === 'closed') continue;
          const buffer = ctx.createBuffer(1, (bytes.byteLength - 4) / 4, view.getUint32(0, true));
          const samples = buffer.getChannelData(0);
          for (let i = 0; i < samples.length; i++) samples[i] = view.getFloat32(4 + i * 4, true);
          const node = ctx.createBufferSource();
          node.buffer = buffer;
          node.playbackRate.value = rate;
          node.connect(ctx.destination);
          source.current = node;
          // Wait for playback, not just synthesis, before starting the next word.
          await new Promise<void>(resolve => {
            const finish = () => {
              if (source.current === node) source.current = null;
              if (finishPlayback.current === finish) finishPlayback.current = null;
              node.onended = null;
              node.disconnect();
              resolve();
            };
            finishPlayback.current = finish;
            node.onended = finish;
            node.start();
          });
        } catch (error) {
          if (request === generation.current) setError(String(error));
        }
      }
    } finally { running.current = false; }
  }
  function speak(text: string, { interrupt = true, rate = 1 } = {}) {
    if (!active.current || !text.trim()) return;
    if (interrupt) stop();
    setError('');
    try {
      context.current ??= new AudioContext();
      // Resume during the user gesture, but wait for it before playing audio.
      const resumed = context.current.resume();
      void resumed.catch(error => setError(String(error)));
      pending.current.push({ text, rate, resumed });
      void drain();
    } catch (error) { setError(String(error)); }
  }
  return { speak, stop, error };
}
