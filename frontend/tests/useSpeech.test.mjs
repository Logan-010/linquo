import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const code = stripTypeScriptTypes(await readFile(new URL('../src/hooks/useSpeech.ts', import.meta.url), 'utf8'));
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function setup() {
  const requests = [], nodes = [], errors = [], cleanups = [];
  let resume = Promise.resolve();
  class AudioContext {
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
  const context = createContext({ AudioContext });
  const hooks = new SyntheticModule(['useEffect', 'useRef', 'useState'], function () {
    this.setExport('useEffect', effect => cleanups.push(effect()));
    this.setExport('useRef', current => ({ current }));
    this.setExport('useState', initial => [initial, value => errors.push(value)]);
  }, { context });
  const api = new SyntheticModule(['invoke'], function () {
    this.setExport('invoke', (_command, { text }) => {
      const response = deferred();
      requests.push({ text, ...response });
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
    ...speech, requests, nodes, errors,
    respond(index) { requests[index].resolve([...new Uint8Array(pcm)]); },
    suspend(promise) { resume = promise; },
    cleanup() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}

test('rapid word clicks are played in order without overlap or dropped words', async () => {
  const speech = await setup();
  for (const word of ['one', 'two', 'three']) speech.speak(word, { interrupt: false });
  await flush();
  for (let index = 0; index < 3; index++) {
    assert.equal(speech.requests.length, index + 1);
    speech.respond(index);
    await flush();
    assert.equal(speech.nodes[index].started, true);
    assert.equal(speech.requests.length, index + 1);
    speech.nodes[index].onended();
    await flush();
  }
  assert.deepEqual(speech.requests.map(request => request.text), ['one', 'two', 'three']);
  speech.cleanup();
});

test('a sentence replaces pending words even while synthesis is in flight', async () => {
  const speech = await setup();
  speech.speak('one', { interrupt: false });
  await flush();
  speech.speak('two', { interrupt: false });
  speech.speak('one two');
  speech.respond(0);
  await flush();
  assert.equal(speech.nodes.length, 0);
  assert.deepEqual(speech.requests.map(request => request.text), ['one', 'one two']);
  speech.respond(1);
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
  assert.equal(speech.requests.length, 1);
  resumed.resolve();
  await flush();
  speech.respond(1);
  await flush();
  assert.equal(speech.nodes[1].started, true);
  assert.equal(speech.nodes[1].playbackRate.value, 0.75);
  speech.cleanup();
});

test('leaving a question discards queued and in-flight speech', async () => {
  const speech = await setup();
  speech.speak('one', { interrupt: false });
  await flush();
  speech.speak('two', { interrupt: false });
  speech.cleanup();
  speech.respond(0);
  await flush();
  assert.equal(speech.nodes.length, 0);
  assert.equal(speech.requests.length, 1);
});

test('a synthesis failure does not block subsequent words', async () => {
  const speech = await setup();
  speech.speak('one', { interrupt: false });
  speech.speak('two', { interrupt: false });
  await flush();
  speech.requests[0].reject(new Error('Synthesis failed'));
  await flush();
  assert.match(speech.errors.at(-1), /Synthesis failed/);
  speech.respond(1);
  await flush();
  assert.equal(speech.nodes[0].started, true);
  speech.cleanup();
});
