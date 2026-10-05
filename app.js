const root = document.documentElement;
const themeButton = document.querySelector('#themeButton');
const openConnection = document.querySelector('#openConnection');
const closeConnection = document.querySelector('#closeConnection');
const connectionDialog = document.querySelector('#connectionDialog');
const connectionForm = document.querySelector('#connectionForm');
const toggleKey = document.querySelector('#toggleKey');
const apiKey = document.querySelector('#apiKey');
const baseUrl = document.querySelector('#baseUrl');
const modelId = document.querySelector('#modelId');
const protocol = document.querySelector('#protocol');
const streamResponse = document.querySelector('#streamResponse');
const connectionUsage = document.querySelector('#connectionUsage');
const runSummary = document.querySelector('#runSummary');
const startButton = document.querySelector('#startButton');
const demoButton = document.querySelector('#demoButton');
const runProgress = document.querySelector('#runProgress');
const runNotice = document.querySelector('#runNotice');
const progressLabel = document.querySelector('#progressLabel');
const elapsedTime = document.querySelector('#elapsedTime');
const progressBar = document.querySelector('#progressBar');
const connectionState = document.querySelector('#connectionState');
const connectionButton = document.querySelector('#connectionButton');
const resultsPanel = document.querySelector('#resultsPanel');
const resultsList = document.querySelector('#resultsList');
const resultsStatus = document.querySelector('#resultsStatus');
const toast = document.querySelector('#toast');
const api = window.MITApiAdapter;
const resultRenderer = window.MITResultRenderer;
const previewFrames = new Set();

let toastTimer;
let running = false;
let elapsedTimer;
let connectionRevision = 0;
let connectionCheckController;
let resultRun;

const tests = window.MITTests;
const testNames = Object.fromEntries(Object.entries(tests).map(([key, test]) => [key, test.name]));

function isDark() {
  return root.dataset.theme === 'dark';
}

function updateThemeLabel() {
  const dark = isDark();
  themeButton.textContent = dark ? '浅色' : '深色';
  themeButton.setAttribute('aria-pressed', String(dark));
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function updateTestSelection() {
  const choices = [...document.querySelectorAll('.test-choice')];
  const selected = choices.filter((choice) => choice.querySelector('input').checked);

  choices.forEach((choice) => {
    choice.classList.toggle('selected', choice.querySelector('input').checked);
  });

  const names = selected.map((choice) => testNames[choice.querySelector('input').value]);
  runSummary.textContent = names.length ? names.join(' + ') : '尚未选择测试';
  startButton.disabled = names.length === 0 || running;
  demoButton.disabled = names.length === 0 || running;
  choices.forEach((choice) => { choice.querySelector('input').disabled = running; });
}

function beginRun(selected, demo) {
  running = true;
  updateTestSelection();
  startButton.textContent = demo ? '运行测试' : '运行中';
  demoButton.textContent = demo ? '演示中' : '模拟运行';
  resultsPanel.hidden = false;
  resultsList.replaceChildren();
  previewFrames.clear();
  runProgress.hidden = false;
  runNotice.textContent = demo ? '模拟演示 · 使用预置回答，不发送 API 请求。' : '真实请求 · 等待模型返回后按固定规则验证。';
  progressBar.max = selected.length;
  progressBar.value = 0;
  resultsStatus.textContent = demo ? '模拟运行中' : `运行 ${selected.length} 项`;
  progressLabel.textContent = `等待答案 · 0 / ${selected.length} 项完成`;
  startElapsedTimer();
}

function startElapsedTimer() {
  const started = Date.now();
  elapsedTime.textContent = '已用时 0 秒';
  clearInterval(elapsedTimer);
  elapsedTimer = window.setInterval(() => { elapsedTime.textContent = `已用时 ${Math.floor((Date.now() - started) / 1000)} 秒`; }, 1000);
}

function finishRun() {
  clearInterval(elapsedTimer);
  running = false;
  startButton.textContent = '运行测试';
  demoButton.textContent = '模拟运行';
  updateTestSelection();
}

function appendValidationReport(card, testKey, result) {
  const report = document.createElement('section');
  report.className = 'validation-report';
  appendText(report, 'h4', '验证明细');
  const rules = {
    colorblind: ['扫描整段回答，命中任意关键词即通过', tests.colorblind.keywords.join('、')],
    candy: ['扫描整段回答，出现“21”即通过', '21'],
    pelican: ['仅检查返回文本包含 HTML 和 SVG', '包含 <html> 和 <svg> 标签；不评价视觉质量'],
  };
  const matchedKeywords = testKey === 'colorblind'
    ? tests.colorblind.keywords.filter((keyword) => result.text.includes(keyword)) : [];
  const observed = testKey === 'pelican'
    ? `HTML ${/<html\b[^>]*>/i.test(result.text) ? '已找到' : '未找到'}；SVG ${/<svg\b[^>]*>/i.test(result.text) ? '已找到' : '未找到'}`
    : testKey === 'candy' ? (result.text.includes('21') ? '已命中“21”' : '未命中“21”')
    : matchedKeywords.length ? `已命中：${matchedKeywords.join('、')}` : '未命中关键词';
  const list = document.createElement('dl');
  [['判定规则', rules[testKey][0]], ['通过条件', rules[testKey][1]], ['匹配结果', observed], ['验证结论', result.label]].forEach(([label, value]) => {
    appendText(list, 'dt', label);
    appendText(list, 'dd', value);
  });
  report.append(list);
  card.append(report);
}

function readConfig() {
  if (window.location.protocol === 'file:') throw new Error('请先运行 start-local.ps1，再打开 http://127.0.0.1:8080 进行 API 测试。');
  const config = {
    stream: streamResponse.checked,
    baseUrl: baseUrl.value.trim(),
    apiKey: apiKey.value,
    model: modelId.value.trim(),
    protocol: protocol.value,
  };
  if (!config.baseUrl) throw new Error('请填写 API Base URL。');
  if (!config.apiKey.trim()) throw new Error('请填写 API Key。');
  if (!config.model) throw new Error('请填写 Model ID。');
  if (!['responses', 'messages'].includes(config.protocol)) throw new Error('请选择 Responses 或 Messages 协议。');
  config.baseUrl = config.protocol === 'messages' ? api.resolveMessagesUrl(config.baseUrl) : api.resolveResponsesUrl(config.baseUrl);
  return config;
}

function setConnectionStatus(label, checking = false) {
  connectionState.textContent = label;
  connectionState.classList.toggle('checking', checking);
}

function setConnectionButton(label, disabled) {
  connectionButton.textContent = label;
  connectionButton.disabled = disabled;
}

function friendlyError(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return '请求失败，请检查接口地址、模型名称和网络连接。';
}

function appendText(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function createResultCard(testKey, result) {
  const card = document.createElement('article');
  card.className = `result-card test-${testKey} ${result.state || ''}`;
  card.dataset.testKey = testKey;

  const heading = document.createElement('div');
  heading.className = 'result-card-heading';
  appendText(heading, 'strong', tests[testKey].name);
  const actions = document.createElement('div');
  actions.className = 'result-actions';
  appendText(actions, 'span', result.label, `result-state ${result.state || ''}`);
  const retry = appendText(actions, 'button', resultRun?.demo ? '重新演示此项' : '重试此项', 'text-button result-retry');
  retry.type = 'button';
  retry.setAttribute('aria-label', `${resultRun?.demo ? '重新演示' : '重试'}${tests[testKey].name}`);
  retry.disabled = ['pending', 'received'].includes(result.state);
  retry.addEventListener('click', () => retrySingleTest(testKey));
  heading.append(actions);
  card.append(heading);

  if (result.detail) appendText(card, 'p', result.detail, 'result-copy');
  if (result.text && !['pending', 'received', 'failed'].includes(result.state)) appendValidationReport(card, testKey, result);
  if (testKey === 'pelican' && result.state === 'returned' && result.text) {
    const start = result.text.search(/<!doctype\s+html\b|<html\b/i);
    const end = result.text.toLowerCase().lastIndexOf('</html>');
    if (start >= 0 && end >= start) {
      const html = result.text.slice(start, end + 7).replace(/^<!doctype[^>]*>/i, '');
      const frame = document.createElement('iframe');
      frame.className = 'pelican-preview';
      frame.title = '鹈鹕骑自行车 · 隔离预览';
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('scrolling', 'no');
      const token = crypto.randomUUID();
      frame.srcdoc = resultRenderer.previewDocument(html, token);
      previewFrames.add({ frame, token, owner: card });
      card.append(frame);
      appendText(card, 'p', '隔离预览禁止外部资源，允许内联 CSS / JavaScript 动画；暂停／继续按钮由模型生成。', 'result-copy');
    } else {
      appendText(card, 'p', '格式检查通过，但未找到完整 HTML 文档边界，无法展示预览；请查看原始回答。', 'result-copy');
    }
  }
  if (result.text) {
    const source = document.createElement('details');
    source.className = 'result-source';
    source.open = root.classList.contains('result-page') && testKey !== 'pelican';
    appendText(source, 'summary', testKey === 'pelican' ? '查看 HTML 源码' : result.demo ? '查看预置模拟回答' : '查看模型回答');
    if (testKey === 'pelican') appendText(source, 'pre', result.text, 'result-raw');
    else {
      const formatted = document.createElement('div');
      formatted.className = 'answer-markdown';
      resultRenderer.renderMarkdown(formatted, result.text);
      source.append(formatted);
      const raw = document.createElement('details');
      raw.className = 'answer-original';
      appendText(raw, 'summary', '查看原始文本');
      appendText(raw, 'pre', result.text, 'result-raw');
      source.append(raw);
    }
    card.append(source);
  }
  if (result.meta) appendText(card, 'div', result.meta, 'result-meta');
  return card;
}

function showPending(testKey) {
  const demo = resultRun?.demo;
  const card = createResultCard(testKey, { state: 'pending', label: demo ? '等待答案' : '请求中', detail: demo ? '模拟数据 · 等待返回预置回答。' : '正在等待模型返回原始回答。', demo });
  resultsList.append(card);
  return card;
}

function replaceCard(card, testKey, result) {
  for (const entry of previewFrames) if (entry.owner === card) previewFrames.delete(entry);
  const next = createResultCard(testKey, result);
  card.replaceWith(next);
  return next;
}

const demoDelay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function runDemo() {
  if (running) return;
  const selected = [...document.querySelectorAll('.test-choice input:checked')].map((input) => input.value);
  if (!selected.length) return;
  const session = createResultRun(selected, null, true);
  resultsPanel.scrollIntoView({ behavior: root.matches('[data-reduced-motion]') || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  await Promise.all(selected.map((key) => runTest(key, session)));
}

demoButton.addEventListener('click', () => openResultPage(true));

function protocolLabel(value) {
  return value === 'messages' ? 'Messages' : 'Responses';
}

async function requestModel(config, prompt, options = {}) {
  if (config.protocol === 'responses') {
    return api.requestResponses({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, prompt, proxyUrl: '/api/model', ...options, reasoning: { ...options.reasoning, effort: 'low' } });
  }
  if (config.protocol === 'messages') {
    return api.requestMessages({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, prompt, proxyUrl: '/api/model', ...options, output_config: { ...options.output_config, effort: 'low' } });
  }
  throw new Error('该接口协议暂未适配。');
}

function createResultRun(selected, config, demo) {
  if (resultRun?.config) resultRun.config.apiKey = '';
  const session = { selected: [...selected], config, demo, items: new Map() };
  resultRun = session;
  beginRun(selected, demo);
  // Mount every placeholder before starting any request; retain selection order.
  selected.forEach((key) => session.items.set(key, { card: showPending(key), result: { state: 'pending' }, controller: null }));
  updateRunProgress(session);
  return session;
}

function updateRunProgress(session) {
  if (resultRun !== session) return;
  const items = [...session.items.values()];
  const active = items.filter((item) => ['pending', 'received'].includes(item.result.state)).length;
  const completed = items.length - active;
  const failures = items.filter((item) => item.result.state === 'failed').length;
  progressBar.value = completed;
  if (active) {
    resultsStatus.textContent = `${session.demo ? '模拟' : '运行'}中 · ${active} 项等待回答`;
    progressLabel.textContent = `并发运行 · ${completed} / ${items.length} 项处理完成`;
  } else {
    resultsStatus.textContent = failures ? `运行结束 · ${failures} 项请求失败或截断` : session.demo ? '模拟完成' : '运行完成';
    progressLabel.textContent = `运行结束 · ${completed} / ${items.length} 项处理完成`;
    if (session.demo) runNotice.textContent = '模拟演示已完成 · 以下是预置回答的验证报告，不代表真实模型表现。';
    finishRun();
  }
}

async function retrySingleTest(testKey) {
  const session = resultRun;
  const item = session?.items.get(testKey);
  if (!item || ['pending', 'received'].includes(item.result.state)) return;
  const previous = item.result;
  item.result = {
    state: 'pending', label: session.demo ? '演示中' : '重试中',
    detail: `${session.demo ? '正在重新演示此项' : '正在重新请求此项'}${previous.text ? '；下方保留上次返回的内容。' : '，其他测试结果保持不变。'}`,
    text: previous.text, meta: previous.meta ? `上次请求 · ${previous.meta}` : undefined, demo: session.demo,
  };
  item.card = replaceCard(item.card, testKey, item.result);
  if (!running) {
    running = true;
    updateTestSelection();
    startElapsedTimer();
  }
  runNotice.textContent = session.demo ? '模拟演示 · 使用预置回答，不发送 API 请求。' : '单项重试 · 使用本次配置，其他测试结果保持不变。';
  updateRunProgress(session);
  await runTest(testKey, session);
}

async function runTest(testKey, session) {
  const item = session.items.get(testKey);
  const config = session.config ? { ...session.config } : null;
  const controller = new AbortController();
  item.controller = controller;
  let result;
  try {
    if (session.demo) {
      await demoDelay(2200);
      const text = window.MITDemoResponses[testKey];
      item.result = { state: 'received', label: '正在验证', detail: '模拟回答已收到，正在核对固定规则。', text, demo: true };
      item.card = replaceCard(item.card, testKey, item.result);
      await demoDelay(900);
      result = { ...tests[testKey].evaluate(text), text, demo: true, meta: '模拟数据 · 预置回答 · 未调用模型接口' };
    } else {
      const response = await requestModel(config, tests[testKey].prompt, { signal: controller.signal, stream: config.stream !== false, maxOutputTokens: tests[testKey].maxOutputTokens || 4096, timeoutMs: tests[testKey].timeoutMs || 90000 });
      result = {
        ...tests[testKey].evaluate(response.text), text: response.text,
        meta: `${protocolLabel(config.protocol)} · ${response.endpoint}${response.usage ? ` · ${response.usage}` : ''}`,
      };
    }
  } catch (error) {
    result = {
      state: 'failed',
      label: error.code === 'INCOMPLETE_RESPONSE' ? '输出未完成' : '请求失败',
      detail: friendlyError(error),
      text: error.result?.text,
      demo: session.demo,
      meta: session.demo ? '模拟数据 · 未调用模型接口' : `${protocolLabel(config.protocol)} · ${config.model}${error.result?.usage ? ` · ${error.result.usage}` : ''}`,
    };
  } finally {
    if (config) config.apiKey = '';
    item.controller = null;
  }
  if (resultRun === session) {
    item.result = result;
    item.card = replaceCard(item.card, testKey, result);
    updateRunProgress(session);
  }
}

async function checkConnection(config, signal) {
  const prompt = 'Reply with OK only.';
  const response = await requestModel(config, prompt, { signal, stream: config.stream !== false, maxOutputTokens: 64 });
  if (!response.text || !response.text.trim()) throw new Error('接口返回了空内容，无法确认协议是否正确。');
  return response;
}

themeButton.addEventListener('click', () => {
  root.dataset.theme = isDark() ? 'light' : 'dark';
  updateThemeLabel();
});

openConnection.addEventListener('click', () => connectionDialog.showModal());
closeConnection.addEventListener('click', () => connectionDialog.close());
connectionDialog.addEventListener('click', (event) => {
  if (event.target === connectionDialog) connectionDialog.close();
});

toggleKey.addEventListener('click', () => {
  const reveal = apiKey.type === 'password';
  apiKey.type = reveal ? 'text' : 'password';
  toggleKey.textContent = reveal ? '隐藏' : '显示';
  toggleKey.setAttribute('aria-pressed', String(reveal));
});

document.querySelectorAll('.test-choice input').forEach((input) => {
  input.addEventListener('change', updateTestSelection);
});

function invalidateConnection() {
  connectionRevision += 1;
  connectionCheckController?.abort();
  connectionCheckController = null;
  setConnectionStatus('未连接');
  setConnectionButton('检查连接', false);
  connectionUsage.textContent = '';
}

[baseUrl, apiKey, modelId, protocol, streamResponse].forEach((input) => {
  input.addEventListener('input', invalidateConnection);
  input.addEventListener('change', invalidateConnection);
});

connectionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (connectionButton.disabled) return;
  let config;
  try {
    config = readConfig();
  } catch (error) {
    setConnectionStatus('未连接');
    showToast(friendlyError(error));
    return;
  }

  setConnectionStatus('检查中', true);
  connectionUsage.textContent = '发送短请求中；本次输出上限 64 token。';
  setConnectionButton('正在检查', true);
  const revision = connectionRevision;
  const controller = new AbortController();
  connectionCheckController = controller;
  try {
    const response = await checkConnection(config, controller.signal);
    if (revision !== connectionRevision) return;
    setConnectionStatus('已连接');
    connectionUsage.textContent = `本次检查 · ${response.usage}`;
    showToast(`连接成功：${response.endpoint}`);
  } catch (error) {
    if (revision !== connectionRevision) return;
    const raw = error.result?.raw;
    const limited = error.code === 'INCOMPLETE_RESPONSE' &&
      (raw?.stop_reason === 'max_tokens' || raw?.status === 'incomplete' && raw?.incomplete_details?.reason === 'max_output_tokens');
    setConnectionStatus(limited ? '接口可达' : '未连接');
    connectionUsage.textContent = `${limited ? '接口已响应，但检查达到输出上限，未确认完整回答。' : friendlyError(error)}${error.result?.usage ? ` 本次检查 · ${error.result.usage}` : ''}`;
    showToast(limited ? '接口已响应，检查回答达到 64 token 上限；可直接运行正式题目。' : `连接失败：${friendlyError(error)}`);
  } finally {
    config.apiKey = '';
    if (revision === connectionRevision) {
      connectionCheckController = null;
      setConnectionButton('检查连接', false);
    }
  }
});

function selectedTests() {
  return [...document.querySelectorAll('.test-choice input:checked')].map((input) => input.value);
}

function openResultPage(demo) {
  const selected = selectedTests();
  if (!selected.length) return;
  let config = null;
  if (!demo) {
    try { config = readConfig(); }
    catch (error) {
      connectionDialog.showModal();
      showToast(friendlyError(error));
      return;
    }
  }
  const token = crypto.randomUUID();
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('run', token);
  const page = window.open(url.href, '_blank');
  if (!page) {
    config = null;
    showToast('浏览器阻止了新页面，请允许本站弹出窗口后重试。');
    return;
  }
  const targetOrigin = window.location.protocol === 'file:' ? '*' : window.location.origin;
  let cleanupTimer;
  function cleanup() {
    window.removeEventListener('message', handoff);
    clearTimeout(cleanupTimer);
    config = null;
  }
  function handoff(event) {
    if (event.source !== page || event.data?.token !== token) return;
    if (event.origin !== window.location.origin) return;
    if (event.data.type === 'MIT_RUN_READY') {
      page.postMessage({ type: 'MIT_RUN_START', token, selected, config, demo, theme: root.dataset.theme }, targetOrigin);
    } else if (event.data.type === 'MIT_RUN_ACCEPTED') {
      cleanup();
    }
  }
  window.addEventListener('message', handoff);
  cleanupTimer = window.setTimeout(() => {
    cleanup();
    showToast('结果页未接收配置，请回到配置页重新运行。');
  }, 15000);
  showToast(demo ? '已打开模拟结果页。' : '已打开结果页，在新页面等待模型回答。');
}

startButton.addEventListener('click', () => openResultPage(false));

async function runConfiguredTests(selected, config) {
  const session = createResultRun(selected, config, false);
  await Promise.all(selected.map((key) => runTest(key, session)));
}

window.addEventListener('beforeunload', () => {
  previewFrames.clear();
  apiKey.value = '';
  if (resultRun?.config) resultRun.config.apiKey = '';
  resultRun?.items.forEach((item) => item.controller?.abort());
});

window.addEventListener('message', event => {
  if (event.data?.type !== 'MIT_PREVIEW_SIZE') return;
  for (const entry of previewFrames) {
    const height = resultRenderer.previewHeight(event, entry.frame, entry.token);
    if (height !== null && entry.frame.isConnected) entry.frame.style.height = `${height}px`;
  }
});

updateThemeLabel();
updateTestSelection();

function prepareResultPage() {
  root.classList.add('result-page');
  document.title = '测试结果 - MIT - Model IQ Test';
  resultsPanel.hidden = false;
  runProgress.hidden = false;
  resultsStatus.textContent = '准备运行';
  runNotice.textContent = '正在接收本次测试配置…';
  progressLabel.textContent = '等待配置';
  document.querySelector('.wordmark').href = window.location.pathname;
}

const pageParams = new URLSearchParams(window.location.search);
if (pageParams.has('run')) {
  prepareResultPage();
  const token = pageParams.get('run');
  const sourcePage = window.opener;
  let accepted = false;
  const readyTimer = window.setInterval(() => {
    if (sourcePage && !sourcePage.closed) sourcePage.postMessage({ type: 'MIT_RUN_READY', token }, window.location.protocol === 'file:' ? '*' : window.location.origin);
  }, 200);
  const expiryTimer = window.setTimeout(() => {
    clearInterval(readyTimer);
    window.removeEventListener('message', receiveRun);
    if (!accepted) {
      resultsStatus.textContent = '配置不可用';
      runNotice.textContent = '本次配置已失效。请回到配置页重新运行；刷新结果页不会保存或恢复 API Key。';
      progressLabel.textContent = '等待重新运行';
    }
  }, 15000);
  function receiveRun(event) {
    if (accepted || !sourcePage || event.source !== sourcePage || event.origin !== window.location.origin) return;
    const data = event.data;
    if (data?.type !== 'MIT_RUN_START' || data.token !== token) return;
    if (!Array.isArray(data.selected) || !data.selected.length || !data.selected.every((key) => Object.hasOwn(tests, key))) return;
    if (!data.demo && (!data.config || typeof data.config.apiKey !== 'string')) return;
    accepted = true;
    clearInterval(readyTimer);
    clearTimeout(expiryTimer);
    window.removeEventListener('message', receiveRun);
    sourcePage.postMessage({ type: 'MIT_RUN_ACCEPTED', token }, window.location.protocol === 'file:' ? '*' : window.location.origin);
    window.opener = null;
    if (data.theme) root.dataset.theme = data.theme;
    updateThemeLabel();
    document.querySelectorAll('.test-choice input').forEach((input) => { input.checked = data.selected.includes(input.value); });
    updateTestSelection();
    if (data.demo) runDemo();
    else runConfiguredTests(data.selected, data.config);
  }
  window.addEventListener('message', receiveRun);
} else if (pageParams.get('demo') === '1') {
  prepareResultPage();
  document.querySelectorAll('.test-choice input').forEach((input) => { input.checked = true; });
  updateTestSelection();
  runDemo();
}
