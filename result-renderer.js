/* Safe, dependency-free formatting. Model HTML is never parsed into the host DOM. */
(function exposeResultRenderer(global) {
  'use strict';
  function node(parent, tag, text) {
    const element = parent.ownerDocument.createElement(tag);
    if (text !== undefined) element.textContent = text;
    parent.append(element);
    return element;
  }
  function inline(parent, text, depth = 0) {
    if (depth > 10) { node(parent, 'span', text); return; }
    const pattern = /(`+)([^\n]*?)\1|\*\*([^\n]+?)\*\*|__([^\n]+?)__|\*([^\n*]+)\*|~~([^\n]+?)~~|\[([^\]\n]+)\]\(([^\s)]+)\)/g;
    let position = 0, match;
    while ((match = pattern.exec(text))) {
      if (match.index > position) node(parent, 'span', text.slice(position, match.index));
      if (match[1]) node(parent, 'code', match[2]);
      else if (match[3] || match[4]) inline(node(parent, 'strong'), match[3] || match[4], depth + 1);
      else if (match[5]) inline(node(parent, 'em'), match[5], depth + 1);
      else if (match[6]) inline(node(parent, 'del'), match[6], depth + 1);
      else {
        let url;
        try { url = new URL(match[8]); } catch { url = null; }
        if (url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && text[match.index - 1] !== '!') {
          const link = node(parent, 'a');
          link.setAttribute('href', url.href); link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer'); link.setAttribute('referrerpolicy', 'no-referrer');
          inline(link, match[7], depth + 1);
        } else node(parent, 'span', match[0]);
      }
      position = pattern.lastIndex;
    }
    if (position < text.length) node(parent, 'span', text.slice(position));
  }
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
  const tableRule = line => line.includes('|') && cells(line).every(cell => /^:?-{3,}:?$/.test(cell));
  const listLine = line => /^(\s*)([-+*]|\d+[.)])\s+(.+)$/.exec(line);
  function renderMarkdown(parent, text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    const startsBlock = at => /^\s*$|^ {0,3}(#{1,6})\s|^ {0,3}(`{3,}|~{3,})|^ {0,3}>|^\s*(?:[-*_]\s*){3,}$/.test(lines[at]) || listLine(lines[at]) || (at + 1 < lines.length && tableRule(lines[at + 1]));
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        const codeLines = []; i++;
        while (i < lines.length && !(lines[i].trim().startsWith(fence[1]) && /^\s*[`~]+\s*$/.test(lines[i]))) codeLines.push(lines[i++]);
        if (i < lines.length) i++;
        const pre = node(parent, 'pre');
        node(pre, 'code', codeLines.join('\n'));
        continue;
      }
      const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) { inline(node(parent, `h${heading[1].length}`), heading[2]); i++; continue; }
      if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) { node(parent, 'hr'); i++; continue; }
      if (/^ {0,3}>/.test(line)) {
        const quote = [];
        while (i < lines.length && /^ {0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^ {0,3}>\s?/, ''));
        // Treat the quoted content as inline text to bound nesting on untrusted input.
        inline(node(parent, 'blockquote'), quote.join('\n')); continue;
      }
      if (i + 1 < lines.length && line.includes('|') && tableRule(lines[i + 1])) {
        const table = node(parent, 'table');
        const header = node(node(table, 'thead'), 'tr');
        cells(line).forEach(cell => inline(node(header, 'th'), cell)); i += 2;
        const body = node(table, 'tbody');
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          const row = node(body, 'tr'); cells(lines[i++]).forEach(cell => inline(node(row, 'td'), cell));
        }
        continue;
      }
      const list = listLine(line);
      if (list) {
        const ordered = /^\d/.test(list[2]);
        const root = node(parent, ordered ? 'ol' : 'ul');
        if (ordered && parseInt(list[2], 10) !== 1) root.setAttribute('start', String(parseInt(list[2], 10)));
        const stack = [{ indent: list[1].length, list: root, ordered, item: null }];
        while (i < lines.length) {
          const entry = listLine(lines[i]);
          if (!entry) break;
          const indent = entry[1].length;
          const entryOrdered = /^\d/.test(entry[2]);
          while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
          let current = stack[stack.length - 1];
          if (indent > current.indent && current.item) {
            current = { indent, ordered: entryOrdered, list: node(current.item, entryOrdered ? 'ol' : 'ul'), item: null };
            stack.push(current);
          } else if (entryOrdered !== current.ordered) break;
          current.item = node(current.list, 'li'); inline(current.item, entry[3]); i++;
        }
        continue;
      }
      const paragraph = [line]; i++;
      while (i < lines.length && !startsBlock(i)) paragraph.push(lines[i++]);
      inline(node(parent, 'p'), paragraph.join('\n'));
    }
  }
  function previewDocument(html, token) {
    const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    // This identifier is not a credential. Only this frame's source window and
    // token can resize its own host element; the host also bounds the height.
    const identifier = JSON.stringify(token).replace(/</g, '\\u003c');
    const bootstrap = `(() => {
      const token = ${identifier};
      let last = 0, queued = false, lastWidth = 0, growth = 0;
      function measure() {
        queued = false;
        const body = document.body;
        if (!body) return;
        document.documentElement.style.setProperty('overflow-y', 'hidden', 'important');
        body.style.setProperty('overflow-y', 'visible', 'important');
        body.style.setProperty('min-height', '0', 'important');
        body.style.setProperty('height', 'auto', 'important');
        const margins = getComputedStyle(body);
        const height = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height) + (parseFloat(margins.marginTop)||0) + (parseFloat(margins.marginBottom)||0));
        if (innerWidth !== lastWidth) { lastWidth = innerWidth; growth = 0; }
        if (height === last || height < 1) return;
        // Stop viewport-relative generated layouts from growing indefinitely.
        if (height > last && ++growth > 12) return;
        last = height;
        parent.postMessage({ type: 'MIT_PREVIEW_SIZE', token, height }, '*');
      }
      function queue() { if (!queued) { queued = true; requestAnimationFrame(measure); } }
      addEventListener('DOMContentLoaded', () => {
        new ResizeObserver(queue).observe(document.body);
        queue();
      });
      addEventListener('load', queue);
      addEventListener('resize', queue);
    })();`;
    return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><script>${bootstrap}</script>${html.replace(/^<!doctype[^>]*>/i, '')}`;
  }
  function previewHeight(event, frame, token) {
    const data = event.data;
    if (event.origin !== 'null' || event.source !== frame.contentWindow || data?.type !== 'MIT_PREVIEW_SIZE' || data.token !== token ||
        !Number.isInteger(data.height) || data.height < 1 || data.height > 30000) return null;
    return Math.max(240, data.height);
  }
  const renderer = { renderMarkdown, previewDocument, previewHeight };
  global.MITResultRenderer = renderer;
  if (typeof module !== 'undefined' && module.exports) module.exports = renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
