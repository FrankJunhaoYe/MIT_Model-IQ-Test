'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const api = require('../api-adapter.js');

const credentials = { apiKey: 'test-only-key', model: 'test-model', prompt: 'Reply OK' };
const responses = (text = 'OK', extra = {}) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], ...extra });
const messages = (text = 'OK', extra = {}) => ({ type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }], ...extra });
const requests = [];
let server, origin;
test('Reasoning tokens are a supplied subset of output, never added to the total or invented for Messages', () => {
  const usage = { input_tokens: 4, output_tokens: 64, output_tokens_details: { reasoning_tokens: 60 } };
  const info = api.normalizeUsage(usage, 'responses');
  assert.equal(info.outputTokens, 64);
  assert.equal(info.reasoningTokens, 60);
  assert.match(api.formatUsage(usage, 'responses'), /输出 64 \/ 其中推理 60/);
  assert.equal(api.normalizeUsage({}, 'responses').reasoningTokens, null);
  assert.equal(api.normalizeUsage(usage, 'messages').reasoningTokens, null);
});
before(async () => {
  server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: req.url, headers: req.headers, body });
    const protocol = req.url.endsWith('/messages') ? 'messages' : 'responses';
    const reply = protocol === 'messages' ? messages : responses;
    if (body.model === 'network') { req.socket.destroy(); return; }
    if (body.model === 'redirect') { res.writeHead(307, { Location: '/v1/messages' }); res.end(); return; }
    const status = body.model.startsWith('http-') ? Number(body.model.slice(5)) : 200;
    const send = () => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
      if (body.model === 'slow-body') { res.flushHeaders(); res.write('{'); return; }
      if (body.model === 'html') { res.end('<html>Login</html>'); return; }
      if (body.model === 'string') { res.end(JSON.stringify('OK')); return; }
      if (body.model === 'wrong-protocol') { res.end(JSON.stringify(protocol === 'messages' ? responses() : messages())); return; }
      let payload = reply();
      if (status !== 200 || body.model === 'provider-error') payload = { error: { message: 'Synthetic provider error' } };
      if (body.model === 'failed') payload = reply('partial', { status: 'failed' });
      if (body.model === 'empty') payload = reply('');
      if (body.model === 'incomplete') payload = reply('21 partial', protocol === 'messages' ? { stop_reason: 'max_tokens' } : { status: 'incomplete' });
      if (body.model === 'pending') payload = reply('partial', protocol === 'messages' ? { stop_reason: 'pause_turn' } : { status: 'in_progress' });
      if (body.model === 'usage' || body.model === 'incomplete') {
        payload.usage = protocol === 'messages'
          ? { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }
          : { input_tokens: 130, output_tokens: 5, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 20 } };
      }
      if (body.model === 'repeat') payload = reply(String(requests.length));
      res.end(JSON.stringify(payload));
    };
    if (body.model === 'slow-headers') return; // Client timeout closes the socket.
    send();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

for (const protocol of ['responses', 'messages']) {
  const resolveUrl = protocol === 'messages' ? api.resolveMessagesUrl : api.resolveResponsesUrl;
  const build = protocol === 'messages' ? api.buildMessagesRequest : api.buildResponsesRequest;
  const request = protocol === 'messages' ? api.requestMessages : api.requestResponses;
  const call = (options = {}) => request({ ...credentials, baseUrl: origin, ...options });
  test(`${protocol}: endpoint joining preserves versions, prefixes and ports`, () => {
    assert.equal(resolveUrl('api.example.com'), `https://api.example.com/v1/${protocol}`);
    assert.equal(resolveUrl(`${origin}/`), `${origin}/v1/${protocol}`);
    assert.equal(resolveUrl(`${origin}/v1/`), `${origin}/v1/${protocol}`);
    assert.equal(resolveUrl(`${origin}/proxy/v2`), `${origin}/proxy/v2/${protocol}`);
    assert.equal(resolveUrl(`${origin}/v1/${protocol}/`), `${origin}/v1/${protocol}`);
    for (const bad of ['/response', '/message', '/chat/completions', protocol === 'messages' ? '/responses' : '/messages']) {
      assert.throws(() => resolveUrl(origin + bad), { code: 'ENDPOINT_MISMATCH' });
    }
    for (const bad of ['ftp://api.example.com', 'https://user:pass@api.example.com', origin + '?secret=value', origin + '#fragment']) {
      assert.throws(() => resolveUrl(bad), { code: 'INVALID_BASE_URL' });
    }
  });
  test(`${protocol}: real HTTP request, auth, method and body`, async () => {
    const result = await call();
    const sent = requests.at(-1);
    assert.equal(sent.url, `/v1/${protocol}`);
    assert.equal(sent.body.model, 'test-model');
    assert.equal(sent.body.stream, false);
    assert.equal(result.text, 'OK');
    assert.equal(result.endpoint, `${origin}/v1/${protocol}`);
    if (protocol === 'messages') {
      assert.equal(sent.headers['x-api-key'], credentials.apiKey);
      assert.equal(sent.headers['anthropic-version'], '2023-06-01');
      assert.equal(sent.body.max_tokens, 1024);
      assert.deepEqual(sent.body.messages[0].content[0].cache_control, { type: 'ephemeral' });
    } else {
      assert.equal(sent.headers.authorization, `Bearer ${credentials.apiKey}`);
      assert.equal(sent.body.input, credentials.prompt);
      assert.equal(sent.body.max_output_tokens, 1024);
      assert.equal(sent.body.store, false);
    }
  });
  test(`${protocol}: low effort reaches the HTTP request in the protocol-specific field`, async () => {
    const effort = protocol === 'messages' ? { output_config: { effort: 'low' } } : { reasoning: { effort: 'low' } };
    await call(effort);
    const body = requests.at(-1).body;
    assert.deepEqual(body[protocol === 'messages' ? 'output_config' : 'reasoning'], { effort: 'low' });
    assert.equal(body[protocol === 'messages' ? 'reasoning' : 'output_config'], undefined);
    assert.equal(body.thinking, undefined);
  });
  test(`${protocol}: no local response reuse or credential persistence in URLs`, async () => {
    const before = requests.length;
    const first = await call({ model: 'repeat' });
    const second = await call({ model: 'repeat' });
    assert.equal(requests.length, before + 2);
    assert.notEqual(first.text, second.text);
    const built = build({ ...credentials, baseUrl: origin });
    assert.equal(built.options.cache, 'no-store');
    assert.equal(built.options.credentials, 'omit');
    assert.equal(built.options.redirect, 'error');
    assert.ok(!built.url.includes(credentials.apiKey));
  });
  for (const [model, code] of [
    ['html', 'INVALID_RESPONSE'], ['string', 'INVALID_RESPONSE'], ['wrong-protocol', 'PROTOCOL_ERROR'],
    ['provider-error', 'PROVIDER_ERROR'], ['failed', 'PROVIDER_ERROR'], ['empty', 'EMPTY_RESPONSE'],
    ['incomplete', 'INCOMPLETE_RESPONSE'], ['pending', 'INCOMPLETE_RESPONSE'],
    ['http-401', 'HTTP_ERROR'], ['http-404', 'HTTP_ERROR'], ['http-429', 'HTTP_ERROR'], ['http-500', 'HTTP_ERROR'],
    ['network', 'NETWORK_ERROR'], ['redirect', 'NETWORK_ERROR'],
  ]) {
    test(`${protocol}: ${model} is not a successful answer`, async () => {
      await assert.rejects(call({ model }), (error) => {
        assert.equal(error.code, code);
        if (model.startsWith('http-')) assert.equal(error.status, Number(model.slice(5)));
        if (model === 'incomplete') {
          assert.equal(error.result.text, '21 partial');
          assert.equal(error.result.usageDetails.cacheReadTokens, 100);
        }
        return true;
      });
    });
  }
  for (const model of ['slow-headers', 'slow-body']) {
    test(`${protocol}: deadline includes ${model}`, async () => {
      const started = Date.now();
      await assert.rejects(call({ model, timeoutMs: 100 }), { code: 'TIMEOUT' });
      assert.ok(Date.now() - started < 2000);
    });
  }
  test(`${protocol}: cancellation during body read is distinct from timeout`, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60);
    try { await assert.rejects(call({ model: 'slow-body', signal: controller.signal, timeoutMs: 1000 }), { code: 'CANCELLED' }); }
    finally { clearTimeout(timer); }
    const before = requests.length;
    await assert.rejects(call({ signal: controller.signal }), { code: 'CANCELLED' });
    assert.equal(requests.length, before);
  });
  test(`${protocol}: cache accounting and missing fields`, async () => {
    const result = await call({ model: 'usage' });
    assert.equal(result.usageDetails.totalInputTokens, 130);
    assert.equal(result.usageDetails.cacheReadTokens, 100);
    assert.equal(result.usageDetails.cacheWriteTokens, 20);
    assert.equal(result.usageDetails.cacheHit, true);
    assert.match(result.usage, /缓存读取 100/);
    assert.equal((await call()).usageDetails.cacheHit, null);
    assert.match((await call()).usage, /缓存读取：未提供/);
    const zero = api.normalizeUsage(protocol === 'messages' ? { cache_read_input_tokens: 0 } : { input_tokens_details: { cached_tokens: 0 } }, protocol);
    assert.equal(zero.cacheHit, false);
    assert.equal(zero.cacheWriteTokens, null);
  });
}

test('Messages: preserve multi-turn text, thinking signatures and caller cache breakpoints', () => {
  const history = [
    { role: 'user', content: 'Stable original question' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'reasoning', signature: 'signature-value' }, { type: 'text', text: 'Answer' }] },
    { role: 'user', content: 'Follow up' },
  ];
  const snapshot = JSON.stringify(history);
  const body = api.buildMessagesRequest({ ...credentials, baseUrl: origin, messages: history, system: 'Stable system' }).body;
  assert.equal(JSON.stringify(history), snapshot);
  assert.deepEqual(body.messages.slice(0, 2), history.slice(0, 2));
  assert.equal(body.messages[2].content[0].text, 'Follow up');
  assert.equal(body.system, 'Stable system');
  const manual = [{ role: 'user', content: [{ type: 'text', text: 'Long prefix', cache_control: { type: 'ephemeral', ttl: '1h' } }] }, ...history];
  const manualBody = api.buildMessagesRequest({ ...credentials, baseUrl: origin, messages: manual }).body;
  assert.deepEqual(manualBody.messages, manual);
  assert.equal(api.buildMessagesRequest({ ...credentials, baseUrl: origin, promptCaching: false }).body.messages[0].content, credentials.prompt);
});
test('Messages: static system and tool caches also retain a conversation breakpoint', () => {
  const system = [{ type: 'text', text: 'Stable system', cache_control: { type: 'ephemeral', ttl: '1h' } }];
  const tools = [{ name: 'lookup', input_schema: { type: 'object', properties: {} }, cache_control: { type: 'ephemeral' } }];
  const history = [{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'Answer' }, { role: 'user', content: 'Follow up' }];
  const snapshot = JSON.stringify({ system, tools, history });
  const body = api.buildMessagesRequest({ ...credentials, baseUrl: origin, system, tools, messages: history }).body;
  assert.deepEqual(body.system, system);
  assert.deepEqual(body.tools, tools);
  assert.deepEqual(body.messages.slice(0, 2), history.slice(0, 2));
  assert.deepEqual(body.messages[2].content, [{ type: 'text', text: 'Follow up', cache_control: { type: 'ephemeral' } }]);
  assert.equal(JSON.stringify({ system, tools, history }), snapshot);
});
test('Messages: explicit breakpoint capacity is preserved and excess rejected', () => {
  const system = Array.from({ length: 4 }, (_, index) => ({ type: 'text', text: `Prefix ${index}`, cache_control: { type: 'ephemeral' } }));
  const body = api.buildMessagesRequest({ ...credentials, baseUrl: origin, system }).body;
  assert.equal(body.messages[0].content, credentials.prompt);
  assert.throws(() => api.buildMessagesRequest({ ...credentials, baseUrl: origin, system: [...system, system[0]] }), { code: 'INVALID_REQUEST' });
});
test('Messages: tool schema properties named cache_control are not breakpoints', () => {
  const tools = [{ name: 'lookup', input_schema: { type: 'object', properties: { cache_control: { type: 'string' } } } }];
  const body = api.buildMessagesRequest({ ...credentials, baseUrl: origin, tools }).body;
  assert.deepEqual(body.messages[0].content[0].cache_control, { type: 'ephemeral' });
});
test('Messages: disabling auto markers preserves static breakpoints only', () => {
  const system = [{ type: 'text', text: 'Stable', cache_control: { type: 'ephemeral' } }];
  const body = api.buildMessagesRequest({ ...credentials, baseUrl: origin, system, promptCaching: false }).body;
  assert.equal(body.messages[0].content, credentials.prompt);
  assert.deepEqual(body.system, system);
});
test('Responses: full output history and stable cache keys pass through without trimming', () => {
  const input = [{ role: 'user', content: '  Stable prefix\n' }, { type: 'reasoning', id: 'rs_test', encrypted_content: 'opaque-data', summary: [] }, ...responses().output, { role: 'user', content: 'Next question' }];
  const snapshot = JSON.stringify(input);
  const body = api.buildResponsesRequest({ ...credentials, baseUrl: origin, input, prompt_cache_key: 'stable-conversation', reasoning: { effort: 'low' }, include: ['reasoning.encrypted_content'] }).body;
  assert.equal(JSON.stringify(body.input), snapshot);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(body.prompt_cache_key, 'stable-conversation');
  assert.deepEqual(body.include, ['reasoning.encrypted_content']);
  assert.equal(body.store, false);
});
test('Extraction excludes reasoning and tool content from scored answers', () => {
  assert.equal(api.extractMessageText({ content: [{ type: 'thinking', text: '21' }, { type: 'text', text: '9' }] }), '9');
  assert.equal(api.extractResponseText({ output: [{ type: 'reasoning', content: [{ type: 'text', text: '21' }] }, ...responses('9').output] }), '9');
});
test('Invalid inputs are rejected before sending', () => {
  for (const build of [api.buildResponsesRequest, api.buildMessagesRequest]) {
    for (const options of [{ apiKey: '' }, { model: '' }, { maxOutputTokens: 0 }, { input: [] }, { input: '' }]) {
      assert.throws(() => build({ ...credentials, baseUrl: origin, ...options }), { code: 'INVALID_REQUEST' });
    }
  }
});
