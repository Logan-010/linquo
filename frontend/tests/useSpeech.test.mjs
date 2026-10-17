import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const code = stripTypeScriptTypes(await readFile(new URL('../src/hooks/useSpeech.ts', import.meta.url), 'utf8'));
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function setup() {
  const requests = [], cancellations = [], nodes = [], errors = [], statuses = [], cleanups = [];
  let instance;
  let resume = Promise.resolve();
  class AudioContext {
    constructor() { instance = this; }
    state = 'running';
    destination = {};
    resume() { return resume; }
    close() { this.state = 'closed'; }
    createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() {
      const node = {
        playbackRate: { value: 1 },
        connect() {}, disconnect() {},
        start() { node.started = true; },
        stop() { node.stopped = true; },
      };
      nodes.push(node);
      return node;
    }
  }
  const context = createContext({ AudioContext, crypto: webcrypto });
  const hooks = new SyntheticModule(['useLayoutEffect', 'useRef', 'useState'], function () {
    this.setExport('useLayoutEffect', effect => cleanups.push(effect()));
    this.setExport('useRef', current => ({ current }));
    this.setExport('useState', initial => [initial, value => (initial === 'idle' ? statuses : errors).push(value)]);
  }, { context });
  const api = new SyntheticModule(['invoke'], function () {
    this.setExport('invoke', (command, { text, rate, requestId }) => {
      if (command === 'cancel_speech') {
        cancellations.push(requestId);
        return Promise.resolve();
      }
      const response = deferred();
      requests.push({ text, rate, requestId, ...response });
      return response.promise;
    });
  }, { context });
  const module = new SourceTextModule(code, { context });
  await module.link(name => name === 'preact/hooks' ? hooks : api);
  await module.evaluate();
  const speech = module.namespace.useSpeech(true);
  const pcm = new ArrayBuffer(8);
  new DataView(pcm).setUint32(0, 44100, true);
  return {
    ...speech, requests, cancellations, nodes, errors, statuses,
    respond(index) { requests[index].resolve([...new Uint8Array(pcm)]); },
    suspend(promise) { resume = promise; instance.state = 'suspended'; },
    allowResume(callback) { instance.resume = () => { instance.state = 'running'; callback(); return Promise.resolve(); }; },
    cleanup() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}

test('rapid word clicks cancel stale inference and only play the latest word', async () => {
  const speech = await setup();
  for (const word of ['one', 'two', 'three']) speech.speak(word);
  await flush();
  assert.deepEqual(speech.cancellations, speech.requests.slice(0, 2).map(request => request.requestId));
  speech.respond(1);
  speech.respond(0);
  await flush();
  assert.equal(speech.nodes.length, 0);
  speech.respond(2);
  await flush();
  assert.equal(speech.nodes.length, 1);
  assert.equal(speech.nodes[0].started, true);
  assert.deepEqual(speech.requests.map(request => request.text), ['one', 'two', 'three']);
  speech.cleanup();
});

test('blocked autoplay resumes generated audio without repeating inference', async () => {
  const speech = await setup();
  speech.speak('first');
  const resumed = deferred();
  speech.suspend(resumed.promise);
  speech.speak('automatic question');
  speech.respond(1);
  await flush();
  assert.equal(speech.statuses.at(-1), 'blocked');
  assert.equal(speech.nodes.length, 0);
  speech.allowResume(() => resumed.resolve());
  speech.resumeAudio();
  await flush();
  assert.equal(speech.requests.length, 2);
  assert.equal(speech.nodes[0].started, true);
  assert.equal(speech.statuses.at(-1), 'playing');
  speech.cleanup();
});

test('a sentence replaces pending words even while synthesis is in flight', async () => {
  const speech = await setup();
  speech.speak('one');
  await flush();
  speech.speak('two');
  speech.speak('one two');
  speech.respond(0);
  await flush();
  assert.equal(speech.nodes.length, 0);
  assert.deepEqual(speech.requests.map(request => request.text), ['one', 'two', 'one two']);
  speech.respond(1);
  speech.respond(2);
  await flush();
  assert.equal(speech.nodes[0].started, true);
  speech.cleanup();
});

test('slow replay interrupts active playback and waits for audio to resume', async () => {
  const speech = await setup();
  speech.speak('sentence');
  await flush();
  speech.respond(0);
  await flush();
  const resumed = deferred();
  speech.suspend(resumed.promise);
  speech.speak('sentence', { rate: 0.75 });
  await flush();
  assert.equal(speech.nodes[0].stopped, true);
  assert.equal(speech.requests.length, 2);
  speech.respond(1);
  await flush();
  assert.equal(speech.nodes.length, 1);
  resumed.resolve();
  await flush();
  assert.equal(speech.nodes[1].started, true);
  assert.equal(speech.requests[1].rate, 0.75);
  assert.equal(speech.nodes[1].playbackRate.value, 1);
  speech.cleanup();
});

test('leaving a question discards queued and in-flight speech', async () => {
  const speech = await setup();
  speech.speak('one');
  await flush();
  speech.speak('two');
  speech.cleanup();
  speech.respond(0);
  speech.respond(1);
  await flush();
  assert.equal(speech.nodes.length, 0);
  assert.equal(speech.cancellations.length, 2);
});

test('a synthesis failure does not block subsequent words', async () => {
  const speech = await setup();
  speech.speak('one');
  await flush();
  speech.requests[0].reject(new Error('Synthesis failed'));
  await flush();
  assert.match(speech.errors.at(-1), /Synthesis failed/);
  speech.speak('two');
  speech.respond(1);
  await flush();
  assert.equal(speech.nodes[0].started, true);
  speech.cleanup();
});

test('errors from cancelled requests do not replace current speech status', async () => {
  const speech = await setup();
  speech.speak('old');
  speech.speak('new');
  speech.requests[0].reject(new Error('Speech cancelled'));
  speech.respond(1);
  await flush();
  assert.equal(speech.errors.at(-1), '');
  assert.equal(speech.nodes[0].started, true);
  speech.cleanup();
});
