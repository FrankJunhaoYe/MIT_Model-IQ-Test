'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const api = require('../api-adapter.js');
const { createServer, forwardUpstream, validateEnvelope, configuredOrigins, RelayError } = require('../server.cjs');

const credentials = { baseUrl: 'https://api.example.com/v1', apiKey: 'synthetic-stream-key', model: 'test', prompt: 'Stable prompt', stream: true, timeoutMs: 1000 };
const event = (type, fields = {}) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...fields })}\r\n\r\n`;
const answer = (text = '鹈鹕🐦<html><svg></svg></html>', status = 'completed') => ({
  status, output: [{ type: 'reasoning', encrypted_content: 'opaque', summary: [] },
    { type: 'message', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 130, output_tokens: 9, input_tokens_details: { cached_tokens: 100 } },
});
const responsePrefix = event('response.created', { response: { status: 'in_progress', output: [], usage: { input_tokens: 130, input_tokens_details: { cached_tokens: 100 } } } }) +
  event('response.output_text.delta', { output_index: 0, content_index: 0, delta: '鹈鹕🐦<html><svg>' });
const messageStart = event('message_start', { message: { type: 'message', role: 'assistant', content: [], stop_reason: null,
  usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } } });
const messageText = messageStart + event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '鹈鹕🐦<html><svg>' } });
const messageEnd = event('content_block_stop', { index: 0 }) +
  event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } }) + event('message_stop');
let upstream, origin;
before(async () => {
  upstream = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.stream, true);
    assert.equal(req.headers.accept, 'text/event-stream');
    const messages = req.url.endsWith('/messages');
    if (!messages) assert.equal(body.store, false);
    else assert.deepEqual(body.messages[0].content[0].cache_control, { type: 'ephemeral' });
    if (body.model === 'json') { res.end(JSON.stringify(answer())); return; }
    if (body.model === 'http524') { res.writeHead(524); res.end('error code: 524'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.flushHeaders();
    res.write(': heartbeat\r\n\r\n' + (messages ? messageText : responsePrefix));
    if (body.model === 'hang') return;
    if (body.model === 'reset') { setTimeout(() => res.destroy(), 30); return; }
    if (body.model === 'eof') { res.end('data: [DONE]\r\n\r\n'); return; }
    if (body.model === 'error') { res.end(event('error', { error: { message: 'Synthetic overload', type: 'overloaded_error' } })); return; }
    if (body.model === 'malformed') { res.end('data: {invalid}\n\n'); return; }
    const finish = messages ? messageEnd : event('response.completed', { response: answer() });
    setTimeout(() => { if (!res.destroyed) res.end(finish); }, 40);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${upstream.address().port}`;
});
after(async () => { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });

for (const protocol of ['responses', 'messages']) {
  const call = options => api[protocol === 'responses' ? 'requestResponses' : 'requestMessages']({ ...credentials, baseUrl: origin, ...options });
  test(`${protocol} SSE: progress precedes completion, original blocks and cumulative cache usage survive`, async () => {
    const progress = [];
    const pending = call({ onProgress: result => progress.push(result.text) });
    const result = await pending;
    assert.ok(progress.includes('鹈鹕🐦<html><svg>'));
    assert.equal(result.usageDetails.cacheReadTokens, 100);
    assert.equal(result.usageDetails.totalInputTokens, 130);
    assert.equal(result.usageDetails.outputTokens, 9);
    if (protocol === 'responses') {
      assert.equal(result.text, answer().output[1].content[0].text);
      assert.deepEqual(result.raw, answer());
      assert.equal(result.usageDetails.cacheWriteTokens, null);
    } else {
      assert.equal(result.text, '鹈鹕🐦<html><svg>');
      assert.equal(result.raw.stop_reason, 'end_turn');
      assert.equal(result.usageDetails.cacheWriteTokens, 20);
    }
  });
  for (const [model, code] of [['eof', 'INCOMPLETE_RESPONSE'], ['reset', 'INCOMPLETE_RESPONSE'], ['error', 'PROVIDER_ERROR'], ['malformed', 'PROTOCOL_ERROR'], ['hang', 'TIMEOUT']]) {
    test(`${protocol} SSE: ${model} keeps partial answer/cache without judging it`, async () => {
      await assert.rejects(call({ model, timeoutMs: 150 }), error => {
        assert.equal(error.code, code);
        assert.equal(error.result.text, '鹈鹕🐦<html><svg>');
        assert.equal(error.result.usageDetails.cacheReadTokens, 100);
        assert.equal(error.result.usageDetails.outputTokens, protocol === 'messages' ? 0 : null);
        return true;
      });
    });
  }
  test(`${protocol} SSE: manual cancellation keeps partial output, no duplicate request or fallback`, async () => {
    const controller = new AbortController();
    let timer;
    await assert.rejects(call({ model: 'hang', signal: controller.signal, onProgress: result => {
      if (result.text && !timer) timer = setTimeout(() => controller.abort(), 10);
    } }), error => {
      assert.equal(error.code, 'CANCELLED');
      assert.equal(error.result.text, '鹈鹕🐦<html><svg>');
      return true;
    });
    clearTimeout(timer);
  });
  test(`${protocol} SSE: rejects non-streaming responses and retains HTTP errors`, async () => {
    await assert.rejects(call({ model: 'json' }), { code: 'PROTOCOL_ERROR' });
    await assert.rejects(call({ model: 'http524' }), { code: 'HTTP_ERROR', status: 524 });
  });
}

const fragmentedFetch = raw => async () => new Response(new ReadableStream({
  start(controller) {
    // A single byte per chunk splits Unicode code points, CRLF, names and JSON.
    for (const byte of new TextEncoder().encode(raw)) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  },
}), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });

test('Responses SSE: Unicode/CRLF byte fragmentation, multiline data, unknown events and authoritative terminal payload', async () => {
  const raw = ': comment\r\n\r\n' + event('future.event', { value: 1 }) + responsePrefix +
    'event: response.completed\ndata: {"type":"response.completed",\ndata: "response":' + JSON.stringify(answer()) + '}\n\n';
  const result = await api.requestResponses({ ...credentials, fetchImpl: fragmentedFetch(raw) });
  assert.deepEqual(result.raw, answer());
  assert.equal(result.text, '鹈鹕🐦<html><svg></svg></html>');
});

test('Messages SSE: thinking signatures, citations, cumulative usage and tool input remain available for history', async () => {
  const raw = messageStart + event('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }) +
    event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'private reasoning' } }) +
    event('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'opaque-signature' } }) + event('content_block_stop', { index: 0 }) +
    event('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 't1', name: 'tool', input: {} } }) +
    event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":' } }) +
    event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '"鹈鹕"}' } }) + event('content_block_stop', { index: 1 }) +
    event('content_block_start', { index: 2, content_block: { type: 'text', text: '21' } }) +
    event('content_block_delta', { index: 2, delta: { type: 'citations_delta', citation: { type: 'char_location', cited_text: '21' } } }) + event('content_block_stop', { index: 2 }) +
    event('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } }) +
    event('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9, cache_read_input_tokens: null } }) + event('message_stop');
  await assert.rejects(api.requestMessages({ ...credentials, fetchImpl: fragmentedFetch(raw) }), error => {
    assert.equal(error.code, 'INCOMPLETE_RESPONSE');
    assert.equal(error.result.text, '21');
    assert.equal(error.result.raw.content[0].signature, 'opaque-signature');
    assert.deepEqual(error.result.raw.content[1].input, { q: '鹈鹕' });
    assert.equal(error.result.raw.content[2].citations[0].cited_text, '21');
    assert.equal(error.result.usageDetails.cacheReadTokens, 100);
    assert.equal(error.result.usageDetails.outputTokens, 9);
    assert.equal(error.result.usageDetails.totalInputTokens, 130);
    return true;
  });
});

test('Streaming rejects truncated terminal answers, mismatched protocols and absent completion fields', async () => {
  for (const raw of [
    responsePrefix + event('response.incomplete', { response: answer('21 partial', 'incomplete') }),
    responsePrefix + event('response.completed', { response: answer('21', 'in_progress') }),
    messageText + event('message_stop'),
    messageText + event('content_block_stop', { index: 0 }) + event('message_delta', { delta: { stop_reason: 'max_tokens' } }) + event('message_stop'),
    responsePrefix + messageEnd,
  ]) {
    const messages = raw.startsWith('event: message_start');
    await assert.rejects(api[messages ? 'requestMessages' : 'requestResponses']({ ...credentials, fetchImpl: fragmentedFetch(raw) }), error => {
      assert.ok(['INCOMPLETE_RESPONSE', 'PROTOCOL_ERROR'].includes(error.code));
      assert.ok(error.result.text);
      return true;
    });
  }
});

test('SSE response size remains bounded at 8 MB', async () => {
  const fetchImpl = async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(responsePrefix));
    controller.enqueue(new Uint8Array(8 * 1024 * 1024));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
  await assert.rejects(api.requestResponses({ ...credentials, fetchImpl }), error => {
    assert.equal(error.code, 'RESPONSE_TOO_LARGE');
    assert.ok(error.result.text.startsWith('鹈鹕'));
    return true;
  });
});

test('Responses SSE: terminal events omitting usage retain known counts without modifying the raw response', async () => {
  const final = answer(); delete final.usage;
  const result = await api.requestResponses({ ...credentials, fetchImpl: fragmentedFetch(responsePrefix + event('response.completed', { response: final })) });
  assert.deepEqual(result.raw, final);
  assert.equal(result.usageDetails.cacheReadTokens, 100);
  assert.equal(result.usageDetails.outputTokens, null);
  assert.equal(result.usageDetails.cacheWriteTokens, null);
});

const packet = (model = 'test', timeoutMs = 1000) => ({ endpoint: 'https://api.example.com/v1/responses', protocol: 'responses', apiKey: 'synthetic-stream-key',
  body: { model, input: 'Stable prompt', stream: true, store: false }, timeoutMs });

test('Native HTTPS relay streams before upstream end, pins DNS, handles backpressure, rejects interrupted/oversized bodies', async () => {
  for (const mode of ['success', 'aborted', 'oversized', 'wrong-content']) {
    const job = validateEnvelope(packet(), configuredOrigins(['https://api.example.com']));
    const chunks = [];
    let observed, ended = false, paused = false;
    const pending = forwardUpstream(job, new AbortController().signal, {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      streamStart: status => assert.equal(status, 200),
      streamChunk: (chunk, response) => { assert.equal(ended, false); chunks.push(chunk); paused = true; response.pause(); setTimeout(() => response.resume(), 5); },
      request: (url, options, callback) => {
        observed = options;
        const req = new EventEmitter();
        req.destroy = () => {};
        req.end = body => {
          assert.deepEqual(JSON.parse(body), job.body);
          const res = new PassThrough(); res.statusCode = 200; res.complete = true;
          res.headers = { 'content-type': mode === 'wrong-content' ? 'text/html' : 'text/event-stream' };
          callback(res);
          res.write(responsePrefix);
          setTimeout(() => {
            if (mode === 'aborted') { res.complete = false; res.emit('aborted'); res.destroy(); }
            else if (mode === 'oversized') { res.end(Buffer.alloc(8 * 1024 * 1024)); }
            else { ended = true; res.end(); }
          }, 20);
        };
        return req;
      },
    });
    if (mode === 'success') {
      assert.deepEqual(await pending, { status: 200, streamed: true });
      assert.ok(paused);
      assert.equal(Buffer.concat(chunks).toString(), responsePrefix);
    } else await assert.rejects(pending, { status: 502 });
    assert.equal(observed.headers.Accept, 'text/event-stream');
    assert.equal(observed.headers.Authorization, `Bearer ${credentials.apiKey}`);
    observed.lookup('api.example.com', {}, (error, address) => assert.equal(address, '8.8.8.8'));
  }
});

test('Same-origin streaming relay preserves partial output on safe mid-stream error/deadline and cancels on browser disconnect', async () => {
  let cancelled = false;
  const relay = createServer({ allowedOrigins: ['https://api.example.com'], forward: async (job, signal, hooks) => {
    hooks.streamStart(200);
    hooks.streamChunk(Buffer.from(responsePrefix), new PassThrough());
    if (job.body.model === 'success') {
      hooks.streamChunk(Buffer.from(event('response.completed', { response: answer() })), new PassThrough());
      return { status: 200, streamed: true };
    }
    if (job.body.model === 'reset') throw new RelayError(502, '上游连接被中断（ECONNRESET）。');
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(new Error('synthetic-secret-exception')); }, { once: true }));
  } });
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  const proxyOrigin = `http://127.0.0.1:${relay.address().port}`;
  const call = (model, extra = {}) => api.requestResponses({ ...credentials, model, proxyUrl: proxyOrigin + '/api/model',
    fetchImpl: (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: proxyOrigin } }), ...extra });
  try {
    assert.equal((await call('success')).usageDetails.cacheReadTokens, 100);
    await assert.rejects(call('reset'), error => {
      assert.equal(error.code, 'RELAY_ERROR');
      assert.match(error.message, /ECONNRESET/);
      assert.ok(error.result.text.startsWith('鹈鹕'));
      return true;
    });
    const response = await fetch(proxyOrigin + '/api/model', { method: 'POST', headers: { Origin: proxyOrigin, 'X-MIT-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(packet('hang', 50)) });
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const raw = await response.text();
    assert.match(raw, /mit_relay_error/);
    assert.match(raw, /RELAY_TIMEOUT/);
    assert.doesNotMatch(raw, /synthetic-secret-exception|synthetic-stream-key/);
    assert.ok(cancelled);
    cancelled = false;
    const controller = new AbortController();
    await assert.rejects(call('hang', { signal: controller.signal, onProgress: result => { if (result.text) setTimeout(() => controller.abort(), 5); } }), { code: 'CANCELLED' });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(cancelled);
    assert.equal((await fetch(proxyOrigin + '/server.cjs')).status, 404);
  } finally { relay.closeAllConnections(); await new Promise(resolve => relay.close(resolve)); }
});
