import { useEffect, useRef, useState } from 'preact/hooks';
import { invoke } from '../api';

export function useSpeech(enabled: boolean) {
  const [error, setError] = useState('');
  const context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const generation = useRef(0);
  const pending = useRef<string | null>(null);
  const running = useRef(false);
  const active = useRef(enabled);
  active.current = enabled;

  function stop() {
    generation.current++;
    pending.current = null;
    source.current?.stop();
    source.current = null;
  }
  useEffect(() => {
    if (!enabled) stop();
    return () => { stop(); void context.current?.close(); context.current = null; };
  }, [enabled]);

  async function drain() {
    if (running.current) return;
    running.current = true;
    try {
      while (pending.current !== null && active.current) {
        const text = pending.current;
        pending.current = null;
        const request = generation.current;
        try {
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
          node.connect(ctx.destination);
          source.current = node;
          node.onended = () => { if (source.current === node) source.current = null; node.disconnect(); };
          node.start();
        } catch (error) {
          if (request === generation.current) setError(String(error));
        }
      }
    } finally { running.current = false; }
  }
  function speak(text: string) {
    if (!active.current || !text.trim()) return;
    stop();
    setError('');
    try {
      context.current ??= new AudioContext();
      void context.current.resume().catch(error => setError(String(error)));
      pending.current = text;
      void drain();
    } catch (error) { setError(String(error)); }
  }
  return { speak, stop, error };
}
