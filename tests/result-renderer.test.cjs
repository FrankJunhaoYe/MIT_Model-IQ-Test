'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const renderer = require('../result-renderer.js');
// A DOM-shaped tree verifies allowed elements and text without using HTML parsers.
const document = { createElement(tag) {
  return { tag, ownerDocument: document, attributes: {}, children: [], textContent: '',
    append(child) { this.children.push(child); }, setAttribute(name, value) { this.attributes[name] = value; } };
} };
const render = text => { const root = document.createElement('div'); renderer.renderMarkdown(root, text); return root; };
const all = root => [root, ...root.children.flatMap(all)];
const plain = root => root.textContent + root.children.map(plain).join('');
test('Markdown formats headings, emphasis, nested lists, tables, quotations and fenced code', () => {
  const tree = render('# 标题\n\n**粗体** 与 *斜体*、`code`、~~删除~~\n\n1. 第一项\n   - 子项\n2. 第二项\n\n> 引用\n\n| 名称 | 数量 |\n| --- | --- |\n| 糖果 | 21 |\n\n```html\n<script>alert(1)</script>\n```');
  const tags = all(tree).map(item => item.tag);
  for (const tag of ['h1','strong','em','code','del','ol','ul','li','blockquote','table','th','td','pre']) assert.ok(tags.includes(tag), tag);
  assert.ok(plain(tree).includes('<script>alert(1)</script>'));
  assert.ok(!tags.includes('script'));
  assert.ok(plain(tree).includes('21'));
});
test('Untrusted Markdown cannot inject HTML, images, handlers, unsafe links or credential URLs', () => {
  const text = '<img src="https://evil.example/beacon" onerror="alert(1)">\n\n<script>parent.secret()</script>\n\n[bad](javascript:alert(1)) [data](data:text/html,attack) [key](https://user:secret@example.com) ![remote](https://evil.example/image) [safe](https://example.com/docs)';
  const tree = render(text);
  const links = all(tree).filter(item => item.tag === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].attributes.href, 'https://example.com/docs');
  assert.equal(links[0].attributes.rel, 'noopener noreferrer');
  assert.ok(plain(tree).includes('<script>parent.secret()</script>'));
  assert.ok(!all(tree).some(item => ['script','img','iframe','svg','style'].includes(item.tag)));
  assert.ok(!all(tree).some(item => Object.keys(item.attributes).some(key => key.startsWith('on'))));
});
test('Preview document keeps CSP before generated content, blocks resources and safely encodes identifiers', () => {
  const doc = renderer.previewDocument('<html><body><svg></svg></body></html>', '</script><script>attack</script>');
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('<html>'));
  for (const directive of ["connect-src 'none'", "img-src 'none'", "frame-src 'none'", "object-src 'none'", "form-action 'none'"]) assert.ok(doc.includes(directive));
  assert.ok(!doc.includes('const token = "</script>'));
  assert.ok(doc.includes('ResizeObserver'));
});
test('Only the bound opaque frame and matching token can resize, with bounded numeric height', () => {
  const source = {}, frame = { contentWindow: source };
  const event = { source, origin:'null', data:{type:'MIT_PREVIEW_SIZE',token:'test-frame',height:950} };
  assert.equal(renderer.previewHeight(event, frame, 'test-frame'), 950);
  for (const changed of [{source:{}},{origin:'http://localhost'},{data:{...event.data,token:'other'}},{data:{...event.data,height:Infinity}},
    {data:{...event.data,height:'950'}},{data:{...event.data,height:30001}},{data:{...event.data,height:-2}}]) assert.equal(renderer.previewHeight({...event,...changed},frame,'test-frame'),null);
});
test('Preview sizing bootstrap expands tall documents, adapts to width and stops viewport growth loops', () => {
  const html = renderer.previewDocument('<html></html>','frame-token');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const events = {}, messages = [];
  const body = { style:{setProperty(){}}, scrollHeight:1500, getBoundingClientRect(){return {height:this.scrollHeight};} };
  const context = { document:{body,documentElement:{style:{setProperty(){}}}}, innerWidth:900,
    getComputedStyle:()=>({marginTop:'0',marginBottom:'0'}), addEventListener:(name,fn)=>{events[name]=fn;},
    requestAnimationFrame:fn=>fn(), ResizeObserver:class{constructor(fn){this.fn=fn;}observe(){this.fn();}}, parent:{postMessage:message=>messages.push(message)} };
  vm.runInNewContext(script,context); events.DOMContentLoaded();
  assert.equal(messages.at(-1).height,1500);
  body.scrollHeight=2200; context.innerWidth=390; events.resize(); assert.equal(messages.at(-1).height,2200);
  body.scrollHeight=650; events.resize(); assert.equal(messages.at(-1).height,650);
  for(let i=0;i<40;i++){body.scrollHeight+=20;events.resize();}
  assert.ok(messages.length<20);
});
