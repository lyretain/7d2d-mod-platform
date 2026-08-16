function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function renderBlocks(markdown) {
  const chunks = String(markdown || '').replace(/\r\n/g, '\n').split(/```[\w-]*\n?/);
  let html = '';
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (index % 2 === 1) {
      html += `<pre><code>${escapeHtml(chunk.replace(/\n$/, ''))}</code></pre>`;
      continue;
    }
    for (const raw of chunk.split(/\n{2,}/)) {
      const block = raw.trim();
      if (!block) continue;
      if (block.startsWith('# ')) html += `<h1>${inline(block.slice(2))}</h1>`;
      else if (block.startsWith('## ')) html += `<h2>${inline(block.slice(3))}</h2>`;
      else if (block.startsWith('### ')) html += `<h3>${inline(block.slice(4))}</h3>`;
      else if (block.split('\n').every((line) => /^[-*]\s/.test(line))) {
        html += `<ul>${block.split('\n').map((line) => `<li>${inline(line.replace(/^[-*]\s/, ''))}</li>`).join('')}</ul>`;
      }
      else if (block.split('\n').every((line) => /^\d+\.\s/.test(line))) {
        html += `<ol>${block.split('\n').map((line) => `<li>${inline(line.replace(/^\d+\.\s/, ''))}</li>`).join('')}</ol>`;
      }
      else html += `<p>${block.split('\n').map(inline).join('<br>')}</p>`;
    }
  }
  return html;
}

export function renderUserGuide(markdown, lang = 'zh') {
  const isEn = lang === 'en';
  const title = isEn ? 'Player and host guide · Hordepin' : '玩家与服主教程 · 潮印';
  const home = isEn ? 'Back to Hordepin' : '返回平台';
  return `<!doctype html>
<html lang="${isEn ? 'en' : 'zh-CN'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; background: #101114; color: #e8e6e1; font: 16px/1.65 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; }
    main { width: min(760px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 64px; }
    a { color: #e8a317; }
    h1 { color: #e8a317; font-size: 32px; line-height: 1.25; margin: 0 0 12px; }
    h2 { margin: 32px 0 10px; font-size: 22px; }
    h3 { margin: 22px 0 8px; font-size: 17px; }
    p, li { color: #d7d4ce; }
    .muted { color: #8b909c; margin: 0 0 24px; }
    ul, ol { padding-left: 1.2em; }
    code { font-family: ui-monospace, Consolas, monospace; font-size: 0.92em; }
    p code, li code { background: #1c1f26; padding: 0.1em 0.35em; border-radius: 4px; }
    pre { overflow: auto; background: #171a20; border: 1px solid #2c313c; border-radius: 10px; padding: 14px 16px; }
    pre code { color: #f3efe6; }
    nav { display: flex; gap: 16px; margin-bottom: 28px; color: #8b909c; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <nav><a href="/">${home}</a><a href="/guide">简体中文</a><a href="/guide?lang=en">English</a></nav>
    ${renderBlocks(markdown)}
  </main>
</body>
</html>`;
}
