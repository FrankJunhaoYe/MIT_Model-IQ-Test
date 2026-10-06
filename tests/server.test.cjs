'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createServer, forwardUpstream, resolvePublicDns, publicAddress, validateEnvelope, configuredOrigins } = require('../server.cjs');
const api = require('../api-adapter.js');
const allowedOrigins = ['https://api.example.com'];
let server, origin;
const seen = [];
const packet = (extra = {}) => ({
  endpoint: 'https://api.example.com/v1/responses', protocol: 'responses', apiKey: 'synthetic-test-key',
  body: { model: 'test', input: 'Question', stream: false, store: false }, timeoutMs: 1000, ...extra,
});
before(async () => {
  server = createServer({ allowedOrigins, forward: async (job, signal) => {
    seen.push({ endpoint: job.url.href, key: job.apiKey, body: structuredClone(job.body) });
    if (job.body.model === 'slow') await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    if (job.body.model === 'error') return { status: 401, raw: JSON.stringify({ error: { message: 'Invalid synthetic key' } }) };
    const usage = job.protocol === 'responses'
      ? { input_tokens: 1500, output_tokens: 8, input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 200 } }
      : { input_tokens: 300, output_tokens: 8, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 };
    return { status: 200, raw: JSON.stringify(job.protocol === 'responses'
      ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '21' }] }], usage }
      : { type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: '21' }], usage }) };
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const post = (body, headers = {}) => fetch(origin + '/api/model', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-MIT-Request': '1', ...headers }, body: JSON.stringify(body),
});

test('Relay serves only public assets, never source/tests/configuration files', async () => {
  for (const route of ['/', '/api-adapter.js', '/result-renderer.js', '/app.js', '/api/health']) {
    const result = await fetch(origin + route);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.get('access-control-allow-origin'), null);
  }
  for (const route of ['/server.cjs', '/package.json', '/API.md', '/.env', '/tests/server.test.cjs', '/..%2fserver.cjs']) {
    assert.equal((await fetch(origin + route)).status, 404);
  }
});
test('MIT allows the Sub2 frame ancestor without granting cross-origin API access', async () => {
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(origin + '/', { method });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-security-policy'), "connect-src 'self'; frame-ancestors 'self' https://franklybuilds.com; object-src 'none'; base-uri 'self'");
    assert.equal(response.headers.get('x-frame-options'), null);
  }
  const response = await post(packet(), { Origin: 'https://franklybuilds.com' });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
for (const protocol of ['responses', 'messages']) {
  test(`Relay ${protocol}: browser adapter forwards history/cache and parses raw usage`, async () => {
    const call = protocol === 'messages' ? api.requestMessages : api.requestResponses;
    const result = await call({
      baseUrl: 'https://api.example.com/v1', apiKey: 'synthetic-test-key', model: 'test', prompt: 'Stable prompt',
      ...(protocol === 'messages' ? { output_config: { effort: 'low' } } : { reasoning: { effort: 'low' } }),
      proxyUrl: origin + '/api/model',
      fetchImpl: (url, init) => {
        assert.equal(url, origin + '/api/model');
        assert.equal(init.headers.Authorization, undefined);
        assert.equal(init.headers['x-api-key'], undefined);
        return fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
      },
    });
    assert.equal(result.text, '21');
    assert.equal(result.usageDetails.cacheReadTokens, 1000);
    assert.equal(result.usageDetails.cacheWriteTokens, 200);
    assert.equal(result.usageDetails.totalInputTokens, 1500);
    const sent = seen.at(-1);
    assert.equal(sent.endpoint, `https://api.example.com/v1/${protocol}`);
    assert.deepEqual(sent.body[protocol === 'messages' ? 'output_config' : 'reasoning'], { effort: 'low' });
    if (protocol === 'messages') assert.deepEqual(sent.body.messages[0].content[0].cache_control, { type: 'ephemeral' });
    else assert.equal(sent.body.input, 'Stable prompt');
  });
}
test('Relay keeps exact body fields including cache keys, encrypted history and whitespace', async () => {
  const body = { model: 'test', store: false, stream: false, input: [{ role: 'user', content: '  stable\n' }, { type: 'reasoning', encrypted_content: 'opaque', summary: [] }], prompt_cache_key: 'stable', include: ['reasoning.encrypted_content'] };
  assert.equal((await post(packet({ body }))).status, 200);
  assert.deepEqual(seen.at(-1).body, body);
});
test('Relay preserves upstream authentication errors', async () => {
  const response = await post(packet({ body: { ...packet().body, model: 'error' } }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.message, 'Invalid synthetic key');
});
test('Relay rejects foreign/null origins and missing application request header', async () => {
  const start = seen.length;
  for (const headers of [{ Origin: 'null' }, { Origin: 'https://foreign.example.com' }, { 'X-MIT-Request': '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await post(packet(), headers)).status, 403);
  }
  assert.equal(seen.length, start);
});
test('Relay with an explicit allowlist rejects unlisted hosts and invalid endpoints', async () => {
  const start = seen.length;
  for (const endpoint of ['https://other.example.com/v1/responses', 'https://127.0.0.1/v1/responses', 'https://169.254.169.254/v1/responses']) {
    assert.equal((await post(packet({ endpoint }))).status, 403);
  }
  for (const endpoint of ['http://api.example.com/v1/responses', 'https://user:pass@api.example.com/v1/responses', 'https://api.example.com/v1/responses?key=x', 'https://api.example.com/v1/messages']) {
    assert.equal((await post(packet({ endpoint }))).status, 400);
  }
  assert.equal(seen.length, start);
});
for (const policy of [undefined, ['*']]) {
  test(`Relay ${policy ? 'wildcard' : 'default'} policy allows new API hosts and retains public HTTPS and same-origin checks`, async () => {
    const contacted = [];
    const relay = createServer({ allowedOrigins: policy, forward: (job, signal) => forwardUpstream(job, signal, {
      lookup: async hostname => [{ address: hostname === 'private.example.com' ? '10.0.0.1' : '8.8.8.8', family: 4 }],
      request: (url, options, callback) => {
        contacted.push(url.href);
        options.lookup(url.hostname, {}, (error, address) => {
          assert.equal(error, null);
          assert.equal(address, '8.8.8.8');
        });
        const req = new EventEmitter();
        req.end = () => {
          const response = new PassThrough(); response.statusCode = 200;
          callback(response); response.end('{"output_text":"OK"}');
        };
        return req;
      },
    }) });
    await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
    const address = `http://127.0.0.1:${relay.address().port}`;
    const send = (body, requestOrigin = address) => fetch(address + '/api/model', {
      method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json', 'X-MIT-Request': '1' },
      body: JSON.stringify(body),
    });
    try {
      for (const protocol of ['responses', 'messages']) {
        const body = protocol === 'responses' ? packet().body
          : { model: 'test', stream: false, messages: [{ role: 'user', content: 'Question' }] };
        const response = await send(packet({ protocol, body, endpoint: `https://new-provider.example.com:8443/custom/v1/${protocol}` }));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { output_text: 'OK' });
      }
      for (const host of ['127.0.0.1', '169.254.169.254', '[::1]', 'private.example.com']) {
        assert.equal((await send(packet({ endpoint: `https://${host}/v1/responses` }))).status, 403);
      }
      for (const endpoint of ['http://new-provider.example.com/v1/responses', 'https://user:pass@new-provider.example.com/v1/responses', 'https://new-provider.example.com/v1/responses?key=x', 'https://new-provider.example.com/v1/messages']) {
        assert.equal((await send(packet({ endpoint }))).status, 400);
      }
      assert.equal((await send(packet(), 'https://foreign.example.com')).status, 403);
      assert.deepEqual(contacted, ['https://new-provider.example.com:8443/custom/v1/responses', 'https://new-provider.example.com:8443/custom/v1/messages']);
    } finally {
      relay.closeAllConnections();
      await new Promise(resolve => relay.close(resolve));
    }
  });
}
test('Relay rejects oversized, non-boolean streaming, malformed or missing-credential requests', async () => {
  assert.equal((await post(packet({ apiKey: '' }))).status, 400);
  assert.equal((await post(packet({ body: { ...packet().body, stream: 'true' } }))).status, 400);
  assert.equal((await post(packet({ body: { ...packet().body, input: 'x'.repeat(2 * 1024 * 1024) } }))).status, 413);
  assert.equal((await post(packet(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(packet({ timeoutMs: 180001 }))).status, 400);
});
test('Relay enforces deadlines and releases concurrency after cancellation', async () => {
  const response = await post(packet({ body: { ...packet().body, model: 'slow' }, timeoutMs: 40 }));
  assert.equal(response.status, 504);
  const timeout = await response.json();
  assert.equal(timeout.error.code, 'RELAY_TIMEOUT');
  assert.match(timeout.error.message, /本站等待上游超时/);
  assert.equal((await post(packet())).status, 200);
});
test('Relay admits three simultaneous tests, blocks a fourth and releases slots', async () => {
  let readinessTimer;
  let release;
  let started;
  let count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const relay = createServer({ allowedOrigins, forward: async () => {
    if (++count === 3) started();
    await gate;
    return { status: 200, raw: '{"output_text":"OK"}' };
  } });
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${relay.address().port}`;
  const send = () => fetch(address + '/api/model', {
    method: 'POST', headers: { Origin: address, 'Content-Type': 'application/json', 'X-MIT-Request': '1' },
    body: JSON.stringify(packet({ timeoutMs: 2000 })),
  });
  const pending = [send(), send(), send()];
  try {
    await Promise.race([ready, new Promise((_, reject) => {
      readinessTimer = setTimeout(() => reject(new Error('Three requests did not start concurrently')), 1500);
    })]);
    assert.equal((await send()).status, 429);
    assert.equal(count, 3);
    release();
    for (const response of await Promise.all(pending)) assert.equal(response.status, 200);
    assert.equal((await send()).status, 200);
  } finally {
    clearTimeout(readinessTimer);
    release();
    await Promise.allSettled(pending);
    relay.closeAllConnections();
    await new Promise(resolve => relay.close(resolve));
  }
});
test('Public address checks reject IPv4/IPv6 loopback, private, mapped and metadata addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::']) assert.equal(publicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(publicAddress(address), true);
});
test('Upstream rejects DNS rebinding before opening any socket', async () => {
  const job = validateEnvelope(packet(), configuredOrigins(allowedOrigins));
  let called = false;
  await assert.rejects(forwardUpstream(job, new AbortController().signal, {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }], request: () => { called = true; },
  }), { status: 403 });
  assert.equal(called, false);
});
test('Upstream pins public DNS, forwards only protocol headers and preserves raw response', async () => {
  const job = validateEnvelope(packet(), configuredOrigins(allowedOrigins));
  let observed;
  const raw = JSON.stringify({ output_text: 'OK', usage: { input_tokens_details: { cached_tokens: 1024 } } });
  const result = await forwardUpstream(job, new AbortController().signal, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: (url, options, callback) => {
      observed = options;
      const req = new EventEmitter(); req.destroy = () => {};
      req.end = body => { assert.deepEqual(JSON.parse(body), job.body); const res = new PassThrough(); res.statusCode = 200; callback(res); res.end(raw); };
      return req;
    },
  });
  assert.equal(observed.agent, false);
  assert.equal(observed.headers.Authorization, 'Bearer synthetic-test-key');
  assert.equal(observed.headers.Origin, undefined);
  assert.equal(observed.headers.Cookie, undefined);
  observed.lookup('api.example.com', {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
  assert.deepEqual(result, { status: 200, raw });
});
test('Upstream does not follow redirects or expose HTML error pages', async () => {
  const job = validateEnvelope(packet(), configuredOrigins(allowedOrigins));
  for (const status of [307, 200]) {
    await assert.rejects(forwardUpstream(job, new AbortController().signal, {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: (url, options, callback) => {
        const req = new EventEmitter(); req.destroy = () => {};
        req.end = () => { const res = new PassThrough(); res.statusCode = status; callback(res); res.end('<html>Login</html>'); };
        return req;
      },
    }), { status: 502 });
  }
});

test('Upstream distinguishes a reset while waiting from TLS and hides sensitive error text', async () => {
  for (const [inputCode, connected, expectedCode] of [
    ['ECONNRESET', true, 'ECONNRESET'],
    ['CERT_HAS_EXPIRED', false, 'CERT_HAS_EXPIRED'],
    ['synthetic-secret-key', false, 'NETWORK_ERROR'],
  ]) {
    let time = 0;
    await assert.rejects(forwardUpstream(validateEnvelope(packet(), configuredOrigins(allowedOrigins)), new AbortController().signal, {
      now: () => time,
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: () => {
        const req = new EventEmitter();
        req.end = () => {
          const socket = new EventEmitter();
          req.emit('socket', socket);
          if (connected) socket.emit('secureConnect');
          time = 125000;
          req.emit('error', Object.assign(new Error('Authorization Bearer synthetic-secret-key body-private'), { code: inputCode }));
        };
        return req;
      },
    }), error => {
      assert.equal(error.status, 502);
      assert.equal(error.code, expectedCode);
      assert.equal(error.elapsedSeconds, 125);
      assert.equal(error.phase, connected ? '等待模型响应' : '建立连接或 TLS 握手');
      assert.doesNotMatch(error.message, /synthetic-secret-key|Authorization|body-private/);
      if (connected) assert.match(error.message, /连接被中断/);
      else if (inputCode === 'CERT_HAS_EXPIRED') assert.match(error.message, /证书校验失败/);
      return true;
    });
  }
});

test('HTML gateway timeout retains its HTTP status and never exposes error-page content', async () => {
  for (const status of [408, 504, 524]) {
    await assert.rejects(forwardUpstream(validateEnvelope(packet(), configuredOrigins(allowedOrigins)), new AbortController().signal, {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: (url, options, callback) => {
        const req = new EventEmitter();
        req.end = () => {
          const res = new PassThrough(); res.statusCode = status;
          callback(res); res.end('<html>synthetic-secret-key private diagnostic</html>');
        };
        return req;
      },
    }), error => {
      assert.equal(error.status, status);
      assert.equal(error.code, `HTTP_${status}`);
      assert.match(error.message, /上游 API 或网关等待超时/);
      assert.doesNotMatch(error.message, /synthetic-secret-key|private diagnostic|<html>/);
      return true;
    });
  }
});

test('Interrupted response bodies reject immediately, including apparently valid JSON', async () => {
  for (const event of ['aborted', 'close', 'end']) {
    await assert.rejects(forwardUpstream(validateEnvelope(packet(), configuredOrigins(allowedOrigins)), new AbortController().signal, {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: (url, options, callback) => {
        const req = new EventEmitter();
        req.end = () => {
          const res = new EventEmitter(); res.statusCode = 200; res.complete = false;
          callback(res);
          res.emit('data', Buffer.from('{"output_text":"21"}'));
          res.emit(event);
        };
        return req;
      },
    }), error => {
      assert.equal(error.status, 502);
      assert.equal(error.phase, '读取响应正文');
      assert.match(error.message, /未收到完整模型回答/);
      return true;
    });
  }
});

test('DNS errors use safe codes and cancellation is not misreported as a DNS failure', async () => {
  const job = validateEnvelope(packet(), configuredOrigins(allowedOrigins));
  const controller = new AbortController();
  const lookup = async () => { throw Object.assign(new Error('synthetic-secret-key'), { code: 'ENOTFOUND' }); };
  await assert.rejects(forwardUpstream(job, controller.signal, { lookup }), error => {
    assert.equal(error.code, 'ENOTFOUND');
    assert.equal(error.phase, '解析域名');
    assert.doesNotMatch(error.message, /synthetic-secret-key/);
    return true;
  });
  controller.abort();
  await assert.rejects(forwardUpstream(job, controller.signal, { lookup }), { status: 504, code: 'REQUEST_ABORTED' });
});

test('Fake-IP proxy DNS is replaced with independently verified, pinned public addresses', async () => {
  const job = validateEnvelope(packet(), configuredOrigins(allowedOrigins));
  let observedAddress;
  let resolutions = 0;
  await forwardUpstream(job, new AbortController().signal, {
    lookup: async () => [{ address: '198.18.0.49', family: 4 }],
    resolvePublicDns: async hostname => { assert.equal(hostname, 'api.example.com'); resolutions++; return [{ address: '8.8.8.8', family: 4 }]; },
    request: (url, options, callback) => {
      options.lookup(url.hostname, {}, (error, address) => { assert.equal(error, null); observedAddress = address; });
      const req = new EventEmitter(); req.destroy = () => {};
      req.end = () => { const response = new PassThrough(); response.statusCode = 200; callback(response); response.end('{}'); };
      return req;
    },
  });
  assert.equal(resolutions, 1);
  assert.equal(observedAddress, '8.8.8.8');
});
test('Fake-IP fallback never permits private DNS results or direct synthetic IP targets', async () => {
  let sockets = 0;
  for (const address of ['127.0.0.1', '10.0.0.1', '198.18.0.50', '::1']) {
    await assert.rejects(forwardUpstream(validateEnvelope(packet(), configuredOrigins(allowedOrigins)), new AbortController().signal, {
      lookup: async () => [{ address: '198.18.0.49', family: 4 }],
      resolvePublicDns: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
      request: () => { sockets++; },
    }), { status: 403 });
  }
  await assert.rejects(forwardUpstream({ ...packet(), url: new URL('https://198.18.0.49/v1/responses') }, new AbortController().signal, {
    resolvePublicDns: async () => { throw new Error('Must not resolve an IP target'); }, request: () => { sockets++; },
  }), { status: 403 });
  assert.equal(sockets, 0);
});
test('Normal private DNS is blocked without public-DNS fallback', async () => {
  let fallback = false;
  await assert.rejects(forwardUpstream(validateEnvelope(packet(), configuredOrigins(allowedOrigins)), new AbortController().signal, {
    lookup: async () => [{ address: '192.168.1.1', family: 4 }],
    resolvePublicDns: async () => { fallback = true; return [{ address: '8.8.8.8', family: 4 }]; },
  }), { status: 403 });
  assert.equal(fallback, false);
});
test('Public DNS receives hostname only, filters CNAME and preserves cancellation', async () => {
  const controller = new AbortController();
  const calls = [];
  const result = await resolvePublicDns('api.example.com', controller.signal, async (url, options) => {
    calls.push({ url: url.href, options });
    const type = url.searchParams.get('type');
    return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 5, data: 'cdn.example.com' },
      ...(type === 'A' ? [{ type: 1, data: '8.8.8.8' }] : [{ type: 28, data: '2606:4700:4700::1111' }])] }));
  });
  assert.deepEqual(result, [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, 'https://cloudflare-dns.com');
    assert.deepEqual(call.options.headers, { Accept: 'application/dns-json' });
    assert.equal(call.options.body, undefined);
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.signal.aborted, false);
  }
  controller.abort();
  assert.ok(calls.every(call => call.options.signal.aborted));
});
