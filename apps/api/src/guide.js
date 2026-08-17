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
  const title = isEn ? 'Player and host guide · Hordepin' : '玩家与服主教程 · Hordepin';
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
    footer { display: flex; flex-wrap: wrap; gap: 8px 16px; justify-content: space-between; align-items: center; margin-top: 40px; padding-top: 16px; border-top: 1px solid #2c313c; color: #8b909c; font-size: 13px; }
    footer a { color: #e8a317; }
    .github-link { display: inline-flex; align-items: center; gap: 6px; }
    .github-link svg { width: 14px; height: 14px; fill: currentColor; }
  </style>
</head>
<body>
  <main>
    <nav><a href="/">${home}</a><a href="/about">${isEn ? 'About' : '关于'}</a><a href="/guide">简体中文</a><a href="/guide?lang=en">English</a></nav>
    ${renderBlocks(markdown)}
    <footer>
      <span>© 2026 Lyretain</span>
      <a class="github-link" href="https://github.com/lyretain/7d2d-mod-platform" target="_blank" rel="noreferrer" aria-label="${isEn ? 'GitHub repository' : 'GitHub 仓库'}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
        lyretain/7d2d-mod-platform
      </a>
      <span>${isEn ? 'Sponsored by' : '赞助'} <a href="https://aicocloud.com/" target="_blank" rel="noreferrer">AICOCLOUD</a></span>
    </footer>
  </main>
</body>
</html>`;
}
