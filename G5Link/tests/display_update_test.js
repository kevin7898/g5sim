'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'g5link-display-update-'));
const root = path.resolve(__dirname, '..');
const bridge = path.join(temporary, 'bridge', 'g5link-bridge.js');
const shared = path.join(temporary, 'app', 'shared.js');

function browser(revision) {
  let reloads = 0;
  const button = { addEventListener: (_, handler) => { button.click = handler; } };
  const banner = { hidden: true, querySelector: () => button };
  const document = {
    getElementById: id => id === 'displayUpdate' ? banner : null,
    querySelector: () => ({ content: revision }),
  };
  const context = vm.createContext({
    document, location: { reload() { reloads++; } }, localStorage: { getItem: () => '{}' },
  });
  vm.runInContext(fs.readFileSync(shared, 'utf8'), context);
  return { banner, button, check: context.checkDisplayRevision, reloads: () => reloads };
}

async function bindPort() {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  return port;
}

async function snapshot(base) {
  const [display, ops, state, summary] = await Promise.all(['/','/ops/', '/api/state', '/api/ops/summary']
    .map(url => fetch(base + url, { signal: AbortSignal.timeout(5000) })));
  const { displayRevision } = await state.json();
  assert.match(displayRevision, /^[0-9a-f]{16}$/);
  assert.equal((await summary.json()).displayRevision, displayRevision);
  for (const page of [display, ops]) {
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.ok((await page.text()).includes(`name="g5link-display-revision" content="${displayRevision}"`));
  }
  const eventResponse = await fetch(base + '/api/events', { signal: AbortSignal.timeout(5000) });
  const reader = eventResponse.body.getReader();
  try {
    let received = '';
    while (!received.includes('\n\ndata: ') || !received.endsWith('\n\n')) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      received += Buffer.from(value).toString('utf8');
    }
    const initial = JSON.parse(received.split('\n').find(line => line.startsWith('data: ')).slice(6));
    assert.equal(initial.displayRevision, displayRevision);
  } finally {
    await reader.cancel();
  }
  return displayRevision;
}

(async () => {
  fs.cpSync(path.join(root, 'app'), path.join(temporary, 'app'), { recursive: true });
  fs.cpSync(path.join(root, 'bridge'), path.join(temporary, 'bridge'), { recursive: true });
  const port = await bindPort();
  const base = 'http://127.0.0.1:' + port;
  const run = async () => {
    const child = spawn(process.execPath, [bridge, '--port', String(port), '--dir', path.join(temporary, 'data')], { stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(child, 'close');
    const output = { text: '' };
    child.stderr.on('data', chunk => { output.text += chunk; });
    try {
      let timeout;
      try {
        await Promise.race([
          once(child.stdout, 'data'),
          closed.then(() => { throw new Error(output.text || 'Bridge exited during startup'); }),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Bridge did not start')), 5000); }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      return await snapshot(base);
    } finally {
      if (child.exitCode === null) child.kill();
      await closed;
    }
  };
  const first = await run();
  const oldPage = browser(first);
  oldPage.check(first);
  assert.equal(oldPage.banner.hidden, true);
  oldPage.check(undefined);
  assert.equal(oldPage.banner.hidden, true, 'older bridge has no display revision');

  fs.appendFileSync(path.join(temporary, 'app', 'display-update.css'), '\n/* Test a changed asset in the same release. */\n');
  const second = await run();
  assert.notEqual(second, first);
  oldPage.check(second);
  assert.equal(oldPage.banner.hidden, false);
  assert.equal(oldPage.reloads(), 0, 'the page stays open until the operator chooses to reload');
  oldPage.button.click();
  assert.equal(oldPage.reloads(), 1);
  const newPage = browser(second);
  newPage.check(second);
  assert.equal(newPage.banner.hidden, true);
  console.log('display update and older bridge compatibility checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => fs.rmSync(temporary, { recursive: true, force: true }));
