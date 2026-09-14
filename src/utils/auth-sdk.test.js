import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAuthScript } from './auth-sdk.js';

const fakeDocument = () => {
  const children = [];
  return {
    children,
    head: { appendChild: (script) => children.push(script) },
    querySelector: (selector) => children.find((script) => selector.includes(`"${script.dataset.authSdk}"`)),
    createElement: () => Object.assign(new EventTarget(), {
      dataset: {},
      remove() {
        const index = children.indexOf(this);
        if (index >= 0) children.splice(index, 1);
      },
    }),
  };
};

test('concurrent auth SDK loads share one script and completed loads are reused', async () => {
  const documentTarget = fakeDocument();
  const first = loadAuthScript('shared', 'https://example.test/sdk', { documentTarget });
  const second = loadAuthScript('shared', 'https://example.test/sdk', { documentTarget });
  assert.equal(first, second);
  assert.equal(documentTarget.children.length, 1);
  const script = documentTarget.children[0];
  script.dispatchEvent(new Event('load'));
  await first;
  assert.equal(script.dataset.loaded, 'true');
  await loadAuthScript('shared', 'https://example.test/sdk', { documentTarget });
  assert.equal(documentTarget.children.length, 1);
});

test('a stalled auth SDK times out, removes its script and permits a real retry', async () => {
  const documentTarget = fakeDocument();
  const stalled = loadAuthScript('stalled', 'https://example.test/sdk', { documentTarget, timeoutMs: 10 });
  const oldScript = documentTarget.children[0];
  await assert.rejects(stalled, /too long/);
  assert.equal(documentTarget.children.length, 0);
  const retry = loadAuthScript('stalled', 'https://example.test/sdk', { documentTarget });
  const newScript = documentTarget.children[0];
  assert.notEqual(newScript, oldScript);
  oldScript.dispatchEvent(new Event('load'));
  assert.equal(oldScript.dataset.loaded, undefined, 'late events cannot revive a timed-out attempt');
  newScript.dispatchEvent(new Event('load'));
  await retry;
});

test('an auth SDK network error can be retried without retaining the failed node', async () => {
  const documentTarget = fakeDocument();
  const failed = loadAuthScript('network-error', 'https://example.test/sdk', { documentTarget });
  documentTarget.children[0].dispatchEvent(new Event('error'));
  await assert.rejects(failed, /could not load/);
  assert.equal(documentTarget.children.length, 0);
  const retry = loadAuthScript('network-error', 'https://example.test/sdk', { documentTarget });
  documentTarget.children[0].dispatchEvent(new Event('load'));
  await retry;
});
