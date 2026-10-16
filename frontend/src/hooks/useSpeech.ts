import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { invoke } from '../api';

export function useSpeech(enabled: boolean) {
  const [error, setError] = useState('');
  const context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const current = useRef<string | null>(null);
  const active = useRef(enabled);
  active.current = enabled;

  function stop() {
    const requestId = current.current;
    current.current = null;
    source.current?.stop();
    source.current?.disconnect();
    source.current = null;
    if (requestId) void invoke('cancel_speech', { requestId }).catch(() => {});
  }
  useLayoutEffect(() => {
    if (!enabled) stop();
    return () => { stop(); void context.current?.close(); context.current = null; };
  }, [enabled]);

  function speak(text: string, { rate = 1 } = {}) {
    if (!active.current || !text.trim()) return;
    stop();
    setError('');
    const requestId = crypto.randomUUID();
    current.current = requestId;
    try {
      const ctx = context.current ??= new AudioContext();
      // Start both immediately: resume needs the user gesture, synthesis needn't wait.
      const resumed = ctx.resume();
      const audio = invoke<ArrayBuffer | number[]>('speek', { text, rate, requestId });
      void Promise.all([resumed, audio]).then(([, raw]) => {
        if (current.current !== requestId || !active.current || ctx.state === 'closed') return;
        const bytes = raw instanceof ArrayBuffer ? raw : new Uint8Array(raw).buffer;
        const view = new DataView(bytes);
        const buffer = ctx.createBuffer(1, (bytes.byteLength - 4) / 4, view.getUint32(0, true));
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = view.getFloat32(4 + i * 4, true);
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        // Slow speech is generated with longer phoneme durations, preserving pitch.
        node.connect(ctx.destination);
        source.current = node;
        node.onended = () => {
          if (source.current === node) source.current = null;
          if (current.current === requestId) current.current = null;
          node.disconnect();
        };
        node.start();
      }).catch(error => {
        if (current.current === requestId) setError(String(error));
      });
    } catch (error) {
      if (current.current === requestId) setError(String(error));
    }
  }
  return { speak, stop, error };
}
