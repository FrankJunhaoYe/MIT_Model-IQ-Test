/* Framework-free OpenAI Responses / Anthropic Messages transport. */
(function exposeApiAdapter(global) {
  'use strict';
  const DEFAULT_TIMEOUT_MS = 30_000;
  const DEFAULT_MAX_OUTPUT_TOKENS = 1_024;
  class ApiError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = 'ApiError';
      this.code = options.code || 'API_ERROR';
      Object.assign(this, options);
    }
  }
  function invalid(message) { throw new ApiError(message, { code: 'INVALID_REQUEST' }); }
  function requireText(value, label) {
    if (typeof value !== 'string' || !value.trim()) invalid(`请填写${label}。`);
    return value.trim();
  }
  function normalizeBaseUrl(value) {
    let candidate = requireText(value, ' API Base URL');
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;
    let url;
    try { url = new URL(candidate); }
    catch (cause) { throw new ApiError('API Base URL 无效。', { code: 'INVALID_BASE_URL', cause }); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
      throw new ApiError('API 地址须使用 http/https，且不能包含用户名、密码、查询参数或片段。', { code: 'INVALID_BASE_URL' });
    }
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  }
  function resolveEndpoint(baseUrl, protocol) {
    const url = new URL(normalizeBaseUrl(baseUrl));
    const path = url.pathname.replace(/\/+$/, '');
    const endpoint = path.split('/').pop();
    if (endpoint === protocol) return url.toString();
    if (['responses', 'messages', 'response', 'message', 'completions'].includes(endpoint)) {
      throw new ApiError(`地址中的端点与所选协议不符，请使用 /${protocol} 或填写 API Base URL。`, { code: 'ENDPOINT_MISMATCH' });
    }
    url.pathname = `${path || '/v1'}/${protocol}`;
    return url.toString();
  }
  const resolveResponsesUrl = (baseUrl) => resolveEndpoint(baseUrl, 'responses');
  const resolveMessagesUrl = (baseUrl) => resolveEndpoint(baseUrl, 'messages');
  function outputLimit(options, name) {
    const value = Number(options.maxOutputTokens ?? options[name] ?? DEFAULT_MAX_OUTPUT_TOKENS);
    if (!Number.isInteger(value) || value < 1) invalid('maxOutputTokens 必须是正整数。');
    return value;
  }
  function makeRequest(url, headers, body) {
    return { url, body, options: {
      method: 'POST', headers: { Accept: body.stream ? 'text/event-stream' : 'application/json', 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      // HTTP caching is separate from provider prompt/KV caching.
      cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    } };
  }
  function buildResponsesRequest(options = {}) {
    const input = options.input ?? options.prompt;
    if (!(typeof input === 'string' && input.trim()) && !(Array.isArray(input) && input.length)) {
      invalid('请求内容必须是非空文字或历史消息数组。');
    }
    const body = {
      model: requireText(options.model ?? options.modelId, ' Model ID'), input,
      max_output_tokens: outputLimit(options, 'max_output_tokens'),
      // Follow-ups resend full history. store:false does not disable prompt caching.
      store: false, stream: options.stream === true,
    };
    for (const name of ['instructions', 'temperature', 'tools', 'reasoning', 'include', 'prompt_cache_key', 'prompt_cache_retention', 'prompt_cache_options']) {
      if (options[name] !== undefined) body[name] = options[name];
    }
    return makeRequest(resolveResponsesUrl(options.baseUrl ?? options.apiBaseUrl), {
      ...(options.headers || {}), Authorization: `Bearer ${requireText(options.apiKey, ' API Key')}`,
    }, body);
  }
  function buildMessagesRequest(options = {}) {
    const input = options.messages ?? options.input ?? options.prompt;
    const messages = typeof input === 'string' && input.trim() ? [{ role: 'user', content: input }] : input;
    if (!Array.isArray(messages) || !messages.length || messages.some((message) =>
      !message || !['user', 'assistant'].includes(message.role) ||
      !(typeof message.content === 'string' && message.content.trim()) && !(Array.isArray(message.content) && message.content.length))) {
      invalid('Messages 请求须为非空文字，或包含 user/assistant 的历史消息数组。');
    }
    const body = {
      model: requireText(options.model ?? options.modelId, ' Model ID'),
      max_tokens: outputLimit(options, 'max_tokens'), messages: JSON.parse(JSON.stringify(messages)), stream: options.stream === true,
    };
    if (options.system !== undefined || options.instructions !== undefined) body.system = options.system ?? options.instructions;
    for (const name of ['temperature', 'tools', 'thinking', 'output_config']) {
      if (options[name] !== undefined) body[name] = options[name];
    }
    // A cached system/tool prefix does not cache the conversation after it.
    // Respect explicit message breakpoints; otherwise add one for the latest
    // text without exceeding the provider's four-breakpoint limit. Inspect only
    // API block positions, not arbitrary tool schemas or tool-result payloads.
    const messageBlocks = body.messages.flatMap((message) => Array.isArray(message.content) ? message.content : []);
    const staticBlocks = [
      ...(Array.isArray(body.tools) ? body.tools : []),
      ...(Array.isArray(body.system) ? body.system : []),
    ];
    const marked = (block) => Boolean(block?.cache_control);
    const breakpointCount = [...staticBlocks, ...messageBlocks].filter(marked).length;
    if (breakpointCount > 4) invalid('Messages 最多支持 4 个缓存断点，请减少 cache_control 标记。');
    if (options.promptCaching !== false && !messageBlocks.some(marked) && breakpointCount < 4) {
      const last = body.messages[body.messages.length - 1];
      if (typeof last.content === 'string') last.content = [{ type: 'text', text: last.content }];
      const block = last.content[last.content.length - 1];
      if (block?.type === 'text') block.cache_control = { type: 'ephemeral' };
    }
    return makeRequest(resolveMessagesUrl(options.baseUrl ?? options.apiBaseUrl), {
      ...(options.headers || {}), 'x-api-key': requireText(options.apiKey, ' API Key'),
      'anthropic-version': options.anthropicVersion || '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }, body);
  }
  function textFromContentPart(part) {
    if (!part || typeof part !== 'object') return '';
    if (part.type && !['message', 'text', 'output_text'].includes(part.type)) return '';
    if (typeof part.text === 'string') return part.text;
    if (Array.isArray(part.content)) return part.content.map(textFromContentPart).join('');
    return '';
  }
  function extractResponseText(payload) {
    if (typeof payload?.output_text === 'string') return payload.output_text;
    return Array.isArray(payload?.output) ? payload.output.map(textFromContentPart).join('') : '';
  }
  function extractMessageText(payload) {
    return Array.isArray(payload?.content) ? payload.content.map(textFromContentPart).join('') : '';
  }
  function tokenCount(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
  function normalizeUsage(usage, protocol) {
    const input = tokenCount(usage?.input_tokens);
    const output = tokenCount(usage?.output_tokens);
    const read = tokenCount(protocol === 'messages' ? usage?.cache_read_input_tokens : usage?.input_tokens_details?.cached_tokens);
    const write = tokenCount(protocol === 'messages' ? usage?.cache_creation_input_tokens : usage?.input_tokens_details?.cache_write_tokens);
    const totalInput = protocol === 'messages' && input !== null
      ? (read !== null && write !== null ? input + read + write : null) : input;
    return { inputTokens: input, outputTokens: output, totalInputTokens: totalInput,
      reasoningTokens: protocol === 'responses' ? tokenCount(usage?.output_tokens_details?.reasoning_tokens) : null,
      cacheReadTokens: read, cacheWriteTokens: write, cacheHit: read === null ? null : read > 0 };
  }
  function formatUsage(usage, protocol) {
    const info = normalizeUsage(usage, protocol);
    const parts = [];
    if (info.totalInputTokens !== null) parts.push(`输入 ${info.totalInputTokens}`);
    else if (info.inputTokens !== null) parts.push(`未缓存输入 ${info.inputTokens}`);
    if (info.outputTokens !== null) parts.push(`输出 ${info.outputTokens}`);
    if (info.reasoningTokens !== null && info.reasoningTokens > 0) parts.push(`其中推理 ${info.reasoningTokens}`);
    parts.push(info.cacheReadTokens === null ? '缓存读取：未提供' : `缓存读取 ${info.cacheReadTokens}`);
    parts.push(info.cacheWriteTokens === null ? '缓存写入：未提供' : `缓存写入 ${info.cacheWriteTokens}`);
    return parts.join(' / ');
  }
  function extractErrorMessage(payload, fallback) {
    const error = payload?.error || payload;
    return typeof error?.message === 'string' && error.message.trim() ? error.message : fallback;
  }
  function validatePayload(payload, protocol, result) {
    const fail = (message, code) => { throw new ApiError(message, { code, details: payload, result }); };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('接口未返回有效 JSON 对象，请检查端点或网关。', 'INVALID_RESPONSE');
    if (payload.error || payload.type === 'error' || ['failed', 'cancelled'].includes(payload.status)) {
      fail(extractErrorMessage(payload, '模型接口返回失败状态。'), 'PROVIDER_ERROR');
    }
    const validShape = protocol === 'responses'
      ? Array.isArray(payload.output) || typeof payload.output_text === 'string' : Array.isArray(payload.content);
    if (!validShape) fail(`接口返回格式不符合 ${protocol} 协议。`, 'PROTOCOL_ERROR');
    const output = Array.isArray(payload.output) ? payload.output : [];
    if (payload.status === 'incomplete' || ['max_tokens', 'model_context_window_exceeded'].includes(payload.stop_reason) ||
        output.some((item) => item?.status === 'incomplete')) {
      fail('模型输出被截断，保留原始回答，本次不判定答案。', 'INCOMPLETE_RESPONSE');
    }
    if (protocol === 'responses' && payload.status && payload.status !== 'completed') fail('模型尚未完成生成。', 'INCOMPLETE_RESPONSE');
    if (['tool_use', 'pause_turn'].includes(payload.stop_reason) ||
        output.some((item) => ['function_call', 'custom_tool_call'].includes(item?.type))) {
      fail('模型要求继续工具调用或生成，尚未给出完整答案。', 'INCOMPLETE_RESPONSE');
    }
    if (!result.text.trim()) fail('接口未返回可见答案，请检查模型及输出 token 上限。', 'EMPTY_RESPONSE');
  }
  function resultFromPayload(payload, protocol, response, endpoint) {
    return {
      text: protocol === 'responses' ? extractResponseText(payload) : extractMessageText(payload),
      raw: payload, data: payload, response, endpoint,
      usage: formatUsage(payload?.usage, protocol), usageDetails: normalizeUsage(payload?.usage, protocol),
    };
  }
  // Keep complete provider blocks, including opaque reasoning and tool input.
  // A transport EOF or [DONE] is not a protocol completion event.
  async function readEventStream(response, protocol, endpoint, options, remember) {
    let payload = protocol === 'responses' ? { status: 'in_progress', output: [] } : null;
    let terminal = false;
    let buffer = '', eventName = '', dataLines = [], size = 0;
    const openBlocks = new Set();
    const toolInputs = new Map();
    let availableUsage = {};
    const snapshot = () => {
      const supplied = payload?.usage;
      if (supplied && typeof supplied === 'object') {
        const provided = Object.fromEntries(Object.entries(supplied).filter(([, value]) => value != null));
        if (provided.input_tokens_details) provided.input_tokens_details = {
          ...availableUsage.input_tokens_details,
          ...Object.fromEntries(Object.entries(provided.input_tokens_details).filter(([, value]) => value != null)),
        };
        availableUsage = { ...availableUsage, ...provided };
      }
      // Preserve the final raw object verbatim, while retaining earlier supplied
      // usage when a terminal/error event omits it. Never invent unknown counts.
      return { ...resultFromPayload(payload, protocol, response, endpoint),
        usage: formatUsage(availableUsage, protocol), usageDetails: normalizeUsage(availableUsage, protocol) };
    };
    const fail = (message, code = 'PROTOCOL_ERROR') => { throw new ApiError(message, { code, result: snapshot() }); };
    const index = (value) => {
      if (!Number.isInteger(value) || value < 0 || value > 8191) fail('流式响应的内容索引无效。');
      return value;
    };
    const dispatch = () => {
      if (!dataLines.length) { eventName = ''; return; }
      const raw = dataLines.join('\n');
      const name = eventName;
      dataLines = []; eventName = '';
      if (raw === '[DONE]') return;
      let event;
      try { event = JSON.parse(raw); } catch { fail('流式响应包含无效 JSON。'); }
      if (!event || typeof event !== 'object' || Array.isArray(event)) fail('流式事件格式无效。');
      const type = event.type || name;
      if (name && event.type && name !== event.type) fail('流式事件名称与内容类型不一致。');
      if (name === 'mit_relay_error' || type === 'error') {
        fail(extractErrorMessage(event, '流式请求被中断。'), name === 'mit_relay_error' ? 'RELAY_ERROR' : 'PROVIDER_ERROR');
      }
      if (protocol === 'responses') {
        if (['response.completed', 'response.incomplete', 'response.failed'].includes(type)) {
          if (!event.response || event.response.status !== type.slice('response.'.length)) fail('流式结束事件缺少有效的完整响应。');
          payload = event.response;
          terminal = true;
        } else if (['response.created', 'response.in_progress'].includes(type)) {
          if (event.response) payload = { ...event.response, output: payload.output };
        } else if (['response.output_item.added', 'response.output_item.done'].includes(type)) {
          payload.output[index(event.output_index)] = event.item;
        } else if (['response.content_part.added', 'response.content_part.done', 'response.output_text.delta', 'response.output_text.done'].includes(type)) {
          const i = index(event.output_index), j = index(event.content_index);
          const item = payload.output[i] ||= { type: 'message', role: 'assistant', content: [] };
          if (!Array.isArray(item.content)) fail('流式文本内容块格式无效。');
          if (event.part) item.content[j] = event.part;
          else {
            const part = item.content[j] ||= { type: 'output_text', text: '' };
            if (typeof (event.delta ?? event.text) !== 'string') fail('流式文本增量无效。');
            part.text = type.endsWith('.done') ? event.text : (part.text || '') + event.delta;
          }
        }
      } else {
        if (type === 'message_start') {
          if (payload || !Array.isArray(event.message?.content)) fail('Messages 流式开始事件无效或重复。');
          payload = event.message;
        } else if (['content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'].includes(type)) {
          if (!payload) fail('Messages 流式事件缺少 message_start。');
          if (type === 'message_delta') {
            Object.assign(payload, event.delta);
            payload.usage ||= {};
            // Usage deltas are cumulative. Null/absent cache fields do not erase
            // previously supplied counts from message_start.
            for (const [key, value] of Object.entries(event.usage || {})) if (value !== null) payload.usage[key] = value;
          } else if (type === 'message_stop') {
            if (openBlocks.size || typeof payload.stop_reason !== 'string' || !payload.stop_reason) fail('Messages 未完整结束。', 'INCOMPLETE_RESPONSE');
            if (!['end_turn', 'stop_sequence', 'refusal', 'max_tokens', 'model_context_window_exceeded', 'tool_use', 'pause_turn'].includes(payload.stop_reason)) fail('Messages 结束原因无法识别。');
            terminal = true;
          } else {
            const i = index(event.index);
            if (type === 'content_block_start') {
              if (i !== payload.content.length || !event.content_block) fail('Messages 内容块开始事件无效。');
              payload.content[i] = event.content_block; openBlocks.add(i);
            } else {
              const block = payload.content[i];
              if (!block || !openBlocks.has(i)) fail('Messages 内容块事件顺序无效。');
              if (type === 'content_block_stop') {
                if (toolInputs.has(i)) {
                  try { block.input = JSON.parse(toolInputs.get(i)); } catch { fail('流式工具输入未完整生成。', 'INCOMPLETE_RESPONSE'); }
                  toolInputs.delete(i);
                }
                openBlocks.delete(i);
              } else {
                const delta = event.delta || {};
                const field = { text_delta: 'text', thinking_delta: 'thinking', signature_delta: 'signature' }[delta.type];
                if (field) {
                  if (typeof delta[field] !== 'string') fail('Messages 内容增量无效。');
                  block[field] = field === 'signature' ? delta[field] : (block[field] || '') + delta[field];
                } else if (delta.type === 'input_json_delta') {
                  if (typeof delta.partial_json !== 'string') fail('Messages 工具输入增量无效。');
                  toolInputs.set(i, (toolInputs.get(i) || '') + delta.partial_json);
                } else if (delta.type === 'citations_delta') (block.citations ||= []).push(delta.citation);
              }
            }
          }
        }
      }
      const result = snapshot();
      remember(result);
      options.onProgress?.(result);
    };
    const line = (value) => {
      if (!value) { dispatch(); return; }
      if (value.startsWith(':')) return;
      const colon = value.indexOf(':');
      const field = colon < 0 ? value : value.slice(0, colon);
      let valueText = colon < 0 ? '' : value.slice(colon + 1);
      if (valueText.startsWith(' ')) valueText = valueText.slice(1);
      if (field === 'data') dataLines.push(valueText);
      else if (field === 'event') eventName = valueText;
    };
    const reader = response.body?.getReader();
    if (!reader) fail('当前环境无法读取流式响应。');
    const decoder = new TextDecoder();
    remember(snapshot());
    try {
      while (!terminal) {
        const { value, done } = await reader.read();
        if (done) fail('流式连接已结束，但未收到完整结束事件；保留已收到的内容，可单项重试。', 'INCOMPLETE_RESPONSE');
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) fail('API 响应超过 8 MB 上限。', 'RESPONSE_TOO_LARGE');
        buffer += decoder.decode(value, { stream: true });
        while (!terminal) {
          const match = /[\r\n]/.exec(buffer);
          if (!match || (buffer[match.index] === '\r' && match.index === buffer.length - 1)) break;
          const end = match.index;
          const length = buffer[end] === '\r' && buffer[end + 1] === '\n' ? 2 : 1;
          const current = buffer.slice(0, end);
          buffer = buffer.slice(end + length);
          line(current);
        }
      }
      const result = snapshot();
      validatePayload(payload, protocol, result);
      return result;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function performRequest(options, protocol, request) {
    const fetchImpl = options.fetchImpl || options.fetch || global.fetch;
    if (typeof fetchImpl !== 'function') throw new ApiError('当前环境不支持 fetch。', { code: 'FETCH_UNAVAILABLE' });
    const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) invalid('timeoutMs 必须是正数。');
    if (options.signal?.aborted) throw new ApiError('请求已取消。', { code: 'CANCELLED' });
    const controller = new AbortController();
    let timeoutId;
    let abort;
    let cancelledError;
    let partialResult;
    const cancellation = new Promise((_, reject) => {
      const cancel = (message, code) => {
        cancelledError = new ApiError(message, { code, result: partialResult });
        reject(cancelledError);
        controller.abort();
      };
      abort = () => cancel('请求已取消。', 'CANCELLED');
      options.signal?.addEventListener('abort', abort, { once: true });
      timeoutId = setTimeout(() => cancel(`请求超时（${timeoutMs / 1000} 秒）。`, 'TIMEOUT'), timeoutMs);
    });
    const operation = async () => {
      const transportUrl = options.proxyUrl || request.url;
      const transportOptions = options.proxyUrl ? {
        method: 'POST', headers: { Accept: request.body.stream ? 'text/event-stream' : 'application/json', 'Content-Type': 'application/json', 'X-MIT-Request': '1' },
        body: JSON.stringify({ endpoint: request.url, protocol, apiKey: options.apiKey.trim(), body: request.body, timeoutMs }),
        cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      } : request.options;
      const response = await fetchImpl(transportUrl, { ...transportOptions, signal: controller.signal });
      if (response.ok && request.body.stream) {
        if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
          controller.abort();
          throw new ApiError('上游未返回 SSE 流式响应，请确认供应商支持所选协议的 stream:true。', { code: 'PROTOCOL_ERROR' });
        }
        return readEventStream(response, protocol, request.url, options, result => { partialResult = result; });
      }
      // The deadline covers headers AND the entire response body.
      const raw = await response.text();
      let payload;
      try { payload = JSON.parse(raw); } catch (_) { payload = null; }
      if (!response.ok) {
        throw new ApiError(extractErrorMessage(payload, `模型接口请求失败（HTTP ${response.status}）。`), {
          code: 'HTTP_ERROR', status: response.status, details: payload,
        });
      }
      const result = resultFromPayload(payload, protocol, response, request.url);
      validatePayload(payload, protocol, result);
      return result;
    };
    try { return await Promise.race([operation(), cancellation]); }
    catch (cause) {
      if (cancelledError) throw cancelledError;
      if (cause instanceof ApiError) { cause.result ||= partialResult; controller.abort(); throw cause; }
      if (partialResult) throw new ApiError('流式连接被中断，保留已收到的内容，可单项重试。', { code: 'INCOMPLETE_RESPONSE', result: partialResult });
      throw new ApiError(options.proxyUrl
        ? '无法连接本站转发服务，请确认服务已启动，且通过网站地址而非本地 HTML 文件访问。'
        : '无法连接到模型接口，请检查网络、地址及供应商是否允许浏览器跨域请求（CORS）。', { code: 'NETWORK_ERROR', cause });
    } finally {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  const requestResponses = async (options = {}) => performRequest(options, 'responses', buildResponsesRequest(options));
  const requestMessages = async (options = {}) => performRequest(options, 'messages', buildMessagesRequest(options));
  const adapter = {
    ApiError, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_OUTPUT_TOKENS, normalizeBaseUrl,
    resolveResponsesUrl, buildResponsesRequest, extractResponseText, requestResponses, callResponses: requestResponses,
    resolveMessagesUrl, buildMessagesRequest, extractMessageText, requestMessages, callMessages: requestMessages,
    normalizeUsage, formatUsage,
  };
  global.MITApiAdapter = adapter;
  if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
