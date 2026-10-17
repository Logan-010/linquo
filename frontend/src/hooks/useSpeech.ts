import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { invoke } from '../api';

export function useSpeech(enabled: boolean) {
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'idle' | 'generating' | 'blocked' | 'playing'>('idle');
  const context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const current = useRef<string | null>(null);
  const active = useRef(enabled);
  active.current = enabled;

  function stop() {
    const requestId = current.current;
    current.current = null;
    setStatus('idle');
    source.current?.stop();
    source.current?.disconnect();
    source.current = null;
    if (requestId) void invoke('cancel_speech', { requestId }).catch(() => {});
  }
  useLayoutEffect(() => {
    if (!enabled) stop();
    return () => { stop(); void context.current?.close(); context.current = null; };
  }, [enabled]);

  function resumeAudio() {
    // Automatic question narration may start outside a user gesture. Resume
    // that existing request rather than cancelling and synthesizing it again.
    void context.current?.resume().catch(error => setError(String(error)));
  }

  function speak(text: string, { rate = 1 } = {}) {
    if (!active.current || !text.trim()) return;
    stop();
    setError('');
    const requestId = crypto.randomUUID();
    current.current = requestId;
    setStatus('generating');
    try {
      const ctx = context.current ??= new AudioContext();
      // Start both immediately: resume needs the user gesture, synthesis needn't wait.
      const resumed = ctx.resume();
      const audio = invoke<ArrayBuffer | number[]>('speek', { text, rate, requestId }).then(raw => {
        if (current.current === requestId && ctx.state === 'suspended') setStatus('blocked');
        return raw;
      });
      void Promise.all([resumed, audio]).then(([, raw]) => {
        if (current.current !== requestId || !active.current || ctx.state === 'closed') return;
        const bytes = raw instanceof ArrayBuffer ? raw : new Uint8Array(raw).buffer;
        if (bytes.byteLength <= 4 || (bytes.byteLength - 4) % 4 !== 0) throw new Error('Invalid speech audio response');
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
          if (current.current === requestId) { current.current = null; setStatus('idle'); }
          node.disconnect();
        };
        node.start();
        setStatus('playing');
      }).catch(error => {
        if (current.current === requestId) { setStatus('idle'); setError(String(error)); }
      });
    } catch (error) {
      if (current.current === requestId) { setStatus('idle'); setError(String(error)); }
    }
  }
  return { speak, stop, resumeAudio, error, status };
}
