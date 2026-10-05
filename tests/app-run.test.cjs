'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Minimal DOM for request orchestration, not layout or browser behavior.
class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.listeners = new Map(); this.value = ''; this.textContent = '';
    const classes = new Set();
    this.classList = { add: name => classes.add(name), contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) };
  }
  append(child) { child.parent = this; this.children.push(child); }
  replaceChildren() { this.children = []; }
  replaceWith(next) { const parent = this.parent; next.parent = parent; parent.children[parent.children.indexOf(this)] = next; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  matches() { return false; }
  scrollIntoView() {}
}
function harness() {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const documentMock = { documentElement: new Element(), querySelector: node, createElement: () => {
    const element = new Element(); element.ownerDocument = documentMock; element.style = {}; return element;
  } };
  node('#streamResponse').checked = true;
  const inputs = ['colorblind', 'candy', 'pelican'].map(value => Object.assign(new Element(), { value, checked: true }));
  const choices = inputs.map(input => Object.assign(new Element(), { querySelector: () => input }));
  const events = new Map();
  const calls = [];
  const delays = [];
  const request = options => new Promise((resolve, reject) => {
    if (options.prompt !== 'Reply with OK only.') assert.equal(node('#resultsList').children.length, 3, 'all placeholders exist before the first request');
    calls.push({ options, resolve, reject });
  });
  const context = vm.createContext({
    AbortController, URLSearchParams, URL, crypto: require('node:crypto').webcrypto, clearInterval() {}, clearTimeout() {},
    document: Object.assign(documentMock, { querySelectorAll: selector => selector === '.test-choice' ? choices : selector.includes('.test-choice') ? inputs.filter(input => !selector.includes(':checked') || input.checked) : [] }),
    window: {
      MITApiAdapter: { ...require('../api-adapter.js'), requestResponses: request, requestMessages: request },
      location: { search: '', protocol: 'http:', origin: 'http://localhost', pathname: '/' },
      addEventListener: (name, callback) => events.set(name, callback),
      setInterval: () => 1, setTimeout: (callback, ms) => { delays.push({ callback, ms }); return delays.length; },
      matchMedia: () => ({ matches: true }),
    },
  });
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  vm.runInContext(read('test-cases.js'), context);
  context.window.MITTests = context.MITTests;
  vm.runInContext(read('result-renderer.js'), context);
  context.window.MITResultRenderer = context.MITResultRenderer;
  vm.runInContext(read('demo-responses.js'), context);
  vm.runInContext(read('app.js'), context);
  return { node, calls, delays, events, context, run: code => vm.runInContext(code, context) };
}
const configSource = "({baseUrl:'https://api.example.com/v1',apiKey:'synthetic-run-key',model:'mock',protocol:'responses'})";
const answer = (text, usage = '缓存读取 1000') => ({ text, endpoint: 'https://api.example.com/v1/responses', usage });
const flush = () => new Promise(resolve => setImmediate(resolve));

for (const protocol of ['responses', 'messages']) {
  test(`${protocol}: all tests, retry and connection probe use low effort`, async () => {
    const h = harness();
    const config = `({...${configSource}, protocol:'${protocol}'})`;
    const done = h.run(`runConfiguredTests(['colorblind','candy','pelican'], ${config})`);
    const assertLow = call => {
      const field = protocol === 'messages' ? 'output_config' : 'reasoning';
      assert.equal(call.options[field].effort, 'low');
      assert.equal(call.options[protocol === 'messages' ? 'reasoning' : 'output_config'], undefined);
    };
    h.calls.forEach(assertLow);
    assert.equal(h.calls[0].options.timeoutMs, 90000);
    assert.equal(h.calls[1].options.timeoutMs, 90000);
    assert.equal(h.calls[2].options.timeoutMs, 180000);
    h.calls[0].resolve(answer('遗传')); h.calls[1].resolve(answer('21')); h.calls[2].resolve(answer('<html><svg></svg></html>'));
    await done;
    const retry = h.run("retrySingleTest('pelican')");
    assertLow(h.calls[3]);
    h.calls[3].resolve(answer('<html><svg></svg></html>')); await retry;
    const probe = h.run(`checkConnection(${config})`);
    assertLow(h.calls[4]);
    assert.equal(h.calls[4].options.maxOutputTokens, 64);
    assert.equal(h.calls[4].options.prompt, 'Reply with OK only.');
    h.calls[4].resolve(answer('OK')); await probe;
  });
}

test('All tests start together; out-of-order success/failure retains order and progress', async () => {
  const h = harness();
  const done = h.run(`runConfiguredTests(['colorblind','candy','pelican'], ${configSource})`);
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[0].options.stream, true);
  assert.equal(h.calls[1].options.stream, true);
  assert.equal(h.calls[2].options.stream, true);
  h.calls[1].resolve(answer('21'));
  await flush();
  assert.equal(h.node('#progressBar').value, 1);
  assert.equal(h.run("resultRun.items.get('candy').result.state"), 'correct');
  h.calls[0].reject(new Error('synthetic timeout'));
  await flush();
  assert.equal(h.node('#progressBar').value, 2);
  h.calls[2].resolve(answer('<html><svg></svg></html>'));
  await done;
  assert.deepEqual(h.node('#resultsList').children.map(card => card.dataset.testKey), ['colorblind', 'candy', 'pelican']);
  assert.match(h.node('#resultsStatus').textContent, /1 项请求失败/);
  assert.equal(h.node('#progressBar').value, 3);
});

test('Retry while other tests run only resends that prompt and ignores repeat clicks', async () => {
  const h = harness();
  const done = h.run(`runConfiguredTests(['colorblind','candy','pelican'], ${configSource})`);
  h.calls[1].reject(Object.assign(new Error('incomplete'), { code: 'INCOMPLETE_RESPONSE', result: { text: 'partial 21', usage: '缓存读取 20' } }));
  await flush();
  assert.equal(h.run("resultRun.items.get('candy').result.state"), 'failed', 'partial answers are not scored');
  const colorCard = h.node('#resultsList').children[0];
  const retry = h.run("retrySingleTest('candy')");
  await h.run("retrySingleTest('candy')");
  assert.equal(h.calls.length, 4);
  assert.equal(h.calls[3].options.prompt, h.calls[1].options.prompt);
  assert.equal(h.calls[3].options.apiKey, 'synthetic-run-key');
  assert.equal(h.run("resultRun.items.get('candy').result.text"), 'partial 21');
  assert.strictEqual(h.node('#resultsList').children[0], colorCard);
  h.calls[3].resolve(answer('21', '缓存读取 80'));
  await retry;
  assert.match(h.run("resultRun.items.get('candy').result.meta"), /缓存读取 80/);
  h.calls[0].resolve(answer('遗传')); h.calls[2].resolve(answer('<html><svg></svg></html>'));
  await done;
  const snapshots = [h.node('#resultsList').children[0], h.node('#resultsList').children[2]];
  const again = h.run("retrySingleTest('candy')");
  assert.equal(h.calls.length, 5, 'retry remains available after the batch finishes');
  h.calls[4].resolve(answer('21'));
  await again;
  assert.strictEqual(h.node('#resultsList').children[0], snapshots[0]);
  assert.strictEqual(h.node('#resultsList').children[2], snapshots[1]);
  assert.equal(h.node('#resultsStatus').textContent, '运行完成');
});

test('Closing the page clears retained credentials and aborts every pending request', async () => {
  const h = harness();
  const done = h.run(`runConfiguredTests(['colorblind','candy','pelican'], ${configSource})`);
  h.events.get('beforeunload')();
  assert.equal(h.run('resultRun.config.apiKey'), '');
  assert.ok(h.calls.every(call => call.options.signal.aborted));
  h.calls.forEach(call => call.reject(new Error('cancelled')));
  await done;
});

test('Demo runs concurrently and single-item replay never sends an API request', async () => {
  const h = harness();
  const done = h.run('runDemo()');
  assert.equal(h.node('#resultsList').children.length, 3);
  assert.equal(h.delays.filter(delay => delay.ms === 2200).length, 3);
  h.delays.splice(0).forEach(delay => delay.callback());
  await flush();
  assert.equal(h.delays.filter(delay => delay.ms === 900).length, 3);
  h.delays.splice(0).forEach(delay => delay.callback());
  await done;
  const retry = h.run("retrySingleTest('candy')");
  h.delays.splice(0).forEach(delay => delay.callback());
  await flush();
  h.delays.splice(0).forEach(delay => delay.callback());
  await retry;
  assert.equal(h.calls.length, 0);
  assert.equal(h.node('#resultsStatus').textContent, '模拟完成');
});

test('Pelican stream interruption keeps partial HTML/cache ungraded; retry uses the same streaming prompt', async () => {
  const h = harness();
  const done = h.run(`runConfiguredTests(['colorblind','candy','pelican'], ${configSource})`);
  h.calls[0].resolve(answer('遗传')); h.calls[1].resolve(answer('21'));
  h.calls[2].reject(Object.assign(new Error('stream ended'), { code: 'INCOMPLETE_RESPONSE', result: answer('<html><svg>', '缓存读取 100') }));
  await done;
  assert.equal(h.run("resultRun.items.get('pelican').result.state"), 'failed');
  assert.equal(h.run("resultRun.items.get('pelican').result.text"), '<html><svg>');
  assert.match(h.run("resultRun.items.get('pelican').result.meta"), /缓存读取 100/);
  const otherCards = h.node('#resultsList').children.slice(0, 2);
  const retry = h.run("retrySingleTest('pelican')");
  assert.equal(h.calls[3].options.stream, true);
  assert.equal(h.calls[3].options.prompt, h.calls[2].options.prompt);
  h.calls[3].resolve(answer('<html><svg></svg></html>', '缓存读取 300'));
  await retry;
  assert.equal(h.run("resultRun.items.get('pelican').result.state"), 'returned');
  assert.strictEqual(h.node('#resultsList').children[0], otherCards[0]);
  assert.strictEqual(h.node('#resultsList').children[1], otherCards[1]);
});

test('Explicit non-streaming setting is retained for all tests and single retries', async () => {
  const h = harness();
  const done = h.run(`runConfiguredTests(['colorblind','candy','pelican'], {...${configSource}, stream:false})`);
  assert.ok(h.calls.every(call => call.options.stream === false));
  h.calls[0].resolve(answer('遗传')); h.calls[1].resolve(answer('21')); h.calls[2].resolve(answer('<html><svg></svg></html>'));
  await done;
  const retry = h.run("retrySingleTest('pelican')");
  assert.equal(h.calls[3].options.stream, false);
  h.calls[3].resolve(answer('<html><svg></svg></html>')); await retry;
});

function configure(h) {
  h.node('#baseUrl').value = 'https://api.example.com/v1'; h.node('#apiKey').value = 'synthetic-run-key';
  h.node('#modelId').value = 'mock'; h.node('#protocol').value = 'responses';
}
test('Connection probe requests only 64 output tokens, surfaces actual reasoning/cache usage, never sends test prompts', async () => {
  const h = harness(); configure(h);
  const done = h.node('#connectionForm').listeners.get('submit')({ preventDefault() {} });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.prompt, 'Reply with OK only.');
  assert.equal(h.calls[0].options.maxOutputTokens, 64);
  assert.equal(h.calls[0].options.stream, true);
  h.calls[0].resolve(answer('OK', '输出 9 / 其中推理 7 / 缓存读取：未提供'));
  await done;
  assert.match(h.node('#connectionUsage').textContent, /其中推理 7/);
  assert.equal(h.node('#connectionState').textContent, '已连接');
  h.node('#streamResponse').listeners.get('change')();
  assert.equal(h.node('#connectionUsage').textContent, '');
  assert.equal(h.node('#connectionState').textContent, '未连接');
});
test('Probe output limit confirms reachability only, while transport truncation remains a failure', async () => {
  for (const limited of [true, false]) {
    const h = harness(); configure(h);
    const done = h.node('#connectionForm').listeners.get('submit')({ preventDefault() {} });
    h.calls[0].reject(Object.assign(new Error('incomplete'), { code:'INCOMPLETE_RESPONSE', result: { text:'', usage:'输出 64',
      raw: limited ? { status:'incomplete', incomplete_details:{reason:'max_output_tokens'} } : { status:'in_progress' } } }));
    await done;
    assert.equal(h.node('#connectionState').textContent, limited ? '接口可达' : '未连接');
    assert.match(h.node('#connectionUsage').textContent, /输出 64/);
  }
});
