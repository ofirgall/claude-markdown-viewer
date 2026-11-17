// Live Markdown preview of the conversation. UI ported from nvim-md-preview
// (https://github.com/ywsrock/nvim-md-preview, MIT): polls conversation.md and re-renders.
(() => {
  const $ = id => document.getElementById(id);
  const contentEl = $('content');
  const POLL_MS = 1000;
  const COPY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>';
  const MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
  const SUN = '<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  let lastText = null;
  // the page opens at the top of the newest turn, to read it top to bottom;
  // reaching its end (or a turn that fits on screen) turns follow on
  let follow = false;
  let mermaidCounter = 0;

  // ---- theme
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('themeIcon').innerHTML = theme === 'dark' ? MOON : SUN;
    $('hljs-theme').href = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github${theme === 'dark' ? '-dark' : ''}.min.css`;
    if (window.mermaid) mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default', securityLevel: 'strict' });
  }
  // theme.css (from the mod's settings) names the configured palette and its mode;
  // a toggle is remembered per configured palette, so changing it starts fresh
  const rootStyle = getComputedStyle(document.documentElement);
  const configured = rootStyle.getPropertyValue('--configured-theme').trim() || 'default';
  const themeKey = `cp-theme:${configured}`;
  const initialTheme = store.get(themeKey) || rootStyle.getPropertyValue('--configured-mode').trim()
    || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(initialTheme);
  $('themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    store.set(themeKey, next);
    applyTheme(next);
    if (lastText !== null) render(lastText, { keepScroll: true });
  };

  // ---- follow
  // follow = stay on the newest turn, scrolled to its end
  function setFollow(on, { noJump = false } = {}) {
    follow = on;
    $('followBtn').classList.toggle('active', on);
    if (!on || noJump) return;
    if (turns.length && cur !== turns.length - 1) {
      cur = turns.length - 1;
      try { history.replaceState(null, '', `#turn-${cur + 1}`); } catch { /* ignore */ }
      renderTurn();
      markActiveToc();
    }
    scrollTo({ top: document.body.scrollHeight });
  }
  setFollow(follow, { noJump: true });
  $('followBtn').onclick = () => setFollow(!follow);
  addEventListener('wheel', e => { if (e.deltaY < 0 && follow) setFollow(false); }, { passive: true });

  // ---- content width: 50 / 70 / 95% presets on click, 50–100% on the hover slider
  const WIDTH_PRESETS = [50, 70, 95];
  let width = 70;
  function setWidth(pct) {
    width = Math.min(100, Math.max(50, Math.round(pct)));
    document.documentElement.style.setProperty('--w', String(width / 100));
    $('widthLabel').textContent = `${width}%`;
    $('widthSlider').value = String(width);
    $('wideBtn').classList.toggle('active', width > 50);
    store.set('cp-width', String(width));
    if (lastText !== null) updateNav();
  }
  const cycleWidth = () => setWidth(WIDTH_PRESETS.find(p => p > width) ?? WIDTH_PRESETS[0]);
  $('wideBtn').onclick = cycleWidth;
  $('widthSlider').addEventListener('input', e => setWidth(Number(e.target.value)));
  setWidth(Number(store.get('cp-width')) || 70);

  // ---- tools expand/collapse
  let toolsOpen = false;
  $('toolsBtn').onclick = () => {
    toolsOpen = !toolsOpen;
    contentEl.querySelectorAll('details.tool, details.tool-group').forEach(d => { d.open = toolsOpen; });
    updateNav();
    $('toolsBtn').classList.toggle('active', toolsOpen);
  };

  // ---- markdown
  const slug = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';

  function transformAlerts(root) {
    root.querySelectorAll('blockquote').forEach(bq => {
      const p = bq.firstElementChild;
      const m = p && p.tagName === 'P' && /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(p.innerHTML);
      if (!m) return;
      const kind = m[1].toLowerCase();
      p.innerHTML = p.innerHTML.slice(m[0].length);
      if (!p.innerHTML.trim()) p.remove();
      const div = document.createElement('div');
      div.className = `markdown-alert markdown-alert-${kind}`;
      div.innerHTML = `<p class="markdown-alert-title">${kind[0].toUpperCase() + kind.slice(1)}</p>`;
      while (bq.firstChild) div.appendChild(bq.firstChild);
      bq.replaceWith(div);
    });
  }

  function enhanceCode(root) {
    // each diagram is titled by the closest heading before it (not the hidden turn heading)
    const titles = new Map();
    let last = '';
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,pre > code.language-mermaid').forEach(el => {
      if (el.tagName === 'CODE') titles.set(el, last);
      else if (!el.matches('.turn-body>h2')) last = el.textContent.trim();
    });
    root.querySelectorAll('pre > code').forEach(code => {
      const pre = code.parentElement;
      const lang = (/language-(\S+)/.exec(code.className) || [])[1];
      if (lang === 'mermaid') {
        const block = document.createElement('div');
        block.className = 'mermaid-block';
        block.dataset.source = code.textContent;
        if (titles.get(code)) block.dataset.title = titles.get(code);
        pre.replaceWith(block);
        return;
      }
      if (window.hljs) {
        if (lang && hljs.getLanguage(lang)) hljs.highlightElement(code);
        else if (!lang && code.textContent.length < 20000) {
          const r = hljs.highlightAuto(code.textContent);
          if (r.relevance > 5) { code.innerHTML = r.value; code.classList.add('hljs'); }
        }
      }
      const wrap = document.createElement('div');
      wrap.className = 'code-wrap';
      pre.replaceWith(wrap);
      wrap.appendChild(pre);
      if (lang) {
        const badge = document.createElement('span');
        badge.className = 'code-lang';
        badge.textContent = lang;
        wrap.appendChild(badge);
      }
      const btn = document.createElement('button');
      btn.className = 'copy-btn'; btn.title = 'Copy'; btn.innerHTML = COPY_ICON;
      btn.onclick = async () => {
        try { await navigator.clipboard.writeText(code.textContent); } catch { return; }
        btn.innerHTML = CHECK_ICON; btn.classList.add('copied');
        setTimeout(() => { btn.innerHTML = COPY_ICON; btn.classList.remove('copied'); }, 1500);
      };
      wrap.appendChild(btn);
    });
  }

  // Fold each run of 2+ consecutive tool calls into one "N tool calls" group;
  // opening it shows the individual (still collapsible) calls.
  const toolName = d => (/^\S+\s+([^\s—]+)/.exec(d.querySelector('summary').textContent) || [])[1] || 'tool';
  // keys skip the status icon (⏳ → 🔧/❌) so a call keeps its open state when it finishes
  const stripIcon = s => s.trim().replace(/^\S+\s+/, '');
  const detailsKey = d => d.dataset.key || stripIcon(d.querySelector(':scope > summary').textContent);

  function groupTools(root) {
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        const group = document.createElement('details');
        group.className = 'tool-group';
        group.dataset.key = `group:${stripIcon(run[0].querySelector('summary').textContent)}`;
        const counts = new Map();
        let errors = 0;
        let running = null;
        for (const d of run) {
          const name = toolName(d);
          counts.set(name, (counts.get(name) || 0) + 1);
          const label = d.querySelector('summary').textContent;
          if (label.startsWith('❌')) errors++;
          if (label.startsWith('⏳')) running = label.slice(2).trim();
        }
        const summary = document.createElement('summary');
        const count = document.createElement('span');
        count.className = 'tg-count';
        count.textContent = `🧰 ${run.length} tool calls`;
        const tools = document.createElement('span');
        tools.className = 'tg-tools';
        tools.textContent = [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(' · ');
        summary.append(count, tools);
        if (errors) {
          const b = document.createElement('span');
          b.className = 'tg-badge tg-err';
          b.textContent = `${errors} failed`;
          summary.append(b);
        }
        if (running) {
          const b = document.createElement('span');
          b.className = 'tg-badge tg-run';
          b.textContent = `running ${running}`;
          summary.append(b);
        }
        group.append(summary);
        run[0].before(group);
        run.forEach(d => group.append(d));
      }
      run = [];
    };
    for (const el of [...root.children]) {
      if (el.matches('details.tool')) run.push(el);
      else flush();
    }
    flush();
  }

  // ---- turns: the page shows one at a time
  let turns = [];          // [{ title, md }]
  let docTitle = 'Conversation';
  let cur = -1;            // index of the turn on screen
  let renderedKey = null;  // what is on screen, to skip identical re-renders

  // Split the document at the mod's turn headings (`## N. …`), outside code fences.
  function splitTurns(md) {
    const out = [];
    let title = 'Conversation';
    let fence = null;
    let current = null;
    for (const line of md.split('\n')) {
      const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (open) {
        if (!fence) fence = open[1];
        else if (open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      } else if (!fence) {
        const h1 = /^# (.+)$/.exec(line);
        if (h1 && !current) { title = h1[1].trim(); continue; }
        const h2 = /^## (\d+\..*)$/.exec(line);
        if (h2) { current = { title: h2[1].trim(), lines: [line] }; out.push(current); continue; }
      }
      if (current) current.lines.push(line);
    }
    return { title, turns: out.map(t => ({ title: t.title, md: t.lines.join('\n') })) };
  }

  function goTurn(i, { toBottom = false } = {}) {
    if (!turns.length) return;
    i = Math.max(0, Math.min(turns.length - 1, i));
    if (i !== turns.length - 1 && follow) setFollow(false, { noJump: true });
    cur = i;
    try { history.replaceState(null, '', `#turn-${i + 1}`); } catch { /* ignore */ }
    if (viewing) { viewing = null; fillFilesPanel(); }
    renderTurn({ force: true });
    scrollTo({ top: toBottom || follow ? document.body.scrollHeight : 0 });
    updateNav();
    markActiveToc();
  }

  function turnNavBar(where) {
    const bar = document.createElement('div');
    bar.className = `turn-nav turn-nav-${where}`;
    const mk = (cls, label, title, target) => {
      const b = document.createElement('button');
      b.className = `turn-nav-btn ${cls}`;
      b.disabled = target < 0 || target >= turns.length;
      b.innerHTML = label;
      if (!b.disabled) {
        b.title = turns[target].title;
        b.querySelector('.tn-title').textContent = turns[target].title;
        b.onclick = () => goTurn(target);
      }
      return b;
    };
    const pos = document.createElement('span');
    pos.className = 'turn-nav-pos';
    pos.textContent = `Turn ${cur + 1} / ${turns.length}`;
    // like a book: the way back at the top of the page, the way on at its foot
    if (where === 'top') {
      if (cur > 0) bar.append(mk('prev', '<span class="tn-arrow">←</span><span class="tn-title"></span>', 'Previous turn', cur - 1));
      bar.append(pos);
    } else {
      bar.append(pos);
      if (cur < turns.length - 1) bar.append(mk('next', '<span class="tn-title"></span><span class="tn-arrow">→</span>', 'Next turn', cur + 1));
    }
    return bar;
  }

  // ---- footer navigation: turns, code blocks, diagrams
  const NAV = {
    code: () => [...contentEl.querySelectorAll('.code-wrap')].filter(isShown),
    diagram: () => [...contentEl.querySelectorAll('.mermaid-block')].filter(isShown),
  };
  // inside a closed <details> = hidden (Chrome still reports boxes for it)
  function isShown(el) {
    for (let d = el.parentElement.closest('details'); d; d = d.parentElement.closest('details')) {
      if (!d.open) return false;
    }
    return true;
  }
  const headerH = () => document.querySelector('header').offsetHeight;

  // index of the last target whose top has reached the header line (-1: none yet)
  const atPageBottom = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
  function currentIndex(list) {
    // at the bottom, targets that can never reach the header line count once on screen
    const line = atPageBottom() ? innerHeight - document.getElementById('navBar').offsetHeight - 8 : headerH() + 16;
    let idx = -1;
    list.forEach((el, i) => { if (el.getBoundingClientRect().top <= line) idx = i; });
    return idx;
  }

  function navigate(kind, dir) {
    if (kind === 'turn') { goTurn(cur + dir); return; }
    const list = NAV[kind]();
    if (!list.length) return;
    const line = headerH() + 16;
    let target;
    if (dir > 0) target = list.find(el => el.getBoundingClientRect().top > line + 2);
    else target = [...list].reverse().find(el => el.getBoundingClientRect().top < line - 24);
    if (!target) return;
    setFollow(false);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.remove('nav-flash');
    void target.offsetWidth;
    target.classList.add('nav-flash');
  }

  function updateNav() {
    for (const group of document.querySelectorAll('#navBar .nav-group')) {
      if (group.dataset.kind === 'turn') {
        group.classList.toggle('empty', !turns.length);
        group.querySelector('.nav-pos').textContent = turns.length ? `${cur + 1}/${turns.length}` : '–';
        group.querySelector('.nav-prev').disabled = cur <= 0;
        group.querySelector('.nav-next').disabled = cur >= turns.length - 1;
        continue;
      }
      const list = NAV[group.dataset.kind]();
      const idx = currentIndex(list);
      group.classList.toggle('empty', !list.length);
      group.querySelector('.nav-pos').textContent = list.length ? `${Math.max(idx + 1, 0)}/${list.length}` : '–';
      const line = headerH() + 16;
      group.querySelector('.nav-prev').disabled = !list.some(el => el.getBoundingClientRect().top < line - 24);
      group.querySelector('.nav-next').disabled = atPageBottom() || !list.some(el => el.getBoundingClientRect().top > line + 2);
    }
  }

  document.querySelectorAll('#navBar .nav-group').forEach(group => {
    group.querySelector('.nav-prev').onclick = () => navigate(group.dataset.kind, -1);
    group.querySelector('.nav-next').onclick = () => navigate(group.dataset.kind, 1);
  });
  contentEl.addEventListener('toggle', () => updateNav(), true);

  // ---- pan and zoom on each diagram: Ctrl/⌘ + scroll (or a pinch) zooms at
  // the pointer, a drag pans, the corner buttons zoom and reset, and a
  // double-click opens it full screen (closes it there). The view is kept per diagram source, so a live
  // re-render of the turn doesn't lose it.
  const ZOOM_MIN = 0.2, ZOOM_MAX = 8, ZOOM_STEP = 1.25;
  const views = new Map();
  function panZoom(block, { full = false } = {}) {
    const svgEl = block.querySelector('svg');
    if (!svgEl) return;
    const key = block.dataset.source;
    const stage = document.createElement('div');
    stage.className = 'mmd-stage';
    stage.append(svgEl);
    const tools = document.createElement('div');
    tools.className = 'mmd-tools';
    const btn = (label, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.title = title;
      b.onclick = e => { e.stopPropagation(); fn(); };
      tools.append(b);
      return b;
    };
    let v = views.get(key) || { x: 0, y: 0, k: 1 };
    const apply = () => {
      stage.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`;
      pct.textContent = `${Math.round(v.k * 100)}%`;
      block.classList.toggle('mmd-moved', v.x !== 0 || v.y !== 0 || v.k !== 1);
      if (v.x === 0 && v.y === 0 && v.k === 1) views.delete(key); else views.set(key, v);
    };
    // zoom by `f` keeping the point (px, py), relative to the stage's resting place, still
    const zoomAt = (f, px, py) => {
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * f));
      const r = k / v.k;
      v = { k, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
      apply();
    };
    const center = () => ({ px: stage.offsetWidth / 2, py: stage.offsetHeight / 2 });
    const reset = () => { v = { x: 0, y: 0, k: 1 }; apply(); };
    const scrollHint = full ? 'scroll' : 'Ctrl + scroll';
    btn('−', `Zoom out (${scrollHint})`, () => { const c = center(); zoomAt(1 / ZOOM_STEP, c.px, c.py); });
    const pct = btn('100%', 'Reset', reset);
    pct.classList.add('mmd-pct');
    btn('+', `Zoom in (${scrollHint})`, () => { const c = center(); zoomAt(ZOOM_STEP, c.px, c.py); });
    btn('⟲', 'Reset', reset);
    if (full) btn('✕', 'Close (Esc or double-click)', closeDiagram);
    else btn('⛶', 'Full screen (or double-click)', () => openDiagram(block));
    const title = !full && block.dataset.title;
    if (title) {
      const cap = document.createElement('div');
      cap.className = 'mmd-title';
      cap.textContent = cap.title = title;
      block.replaceChildren(cap, stage, tools);
      block.classList.add('has-title');
    } else block.replaceChildren(stage, tools);
    block.classList.add('mmd-pz');
    block.title = `Drag to pan · ${scrollHint} to zoom · double-click to ${full ? 'close' : 'open full screen'}`;

    const local = e => {
      const r = block.getBoundingClientRect();
      return { px: e.clientX - r.left - stage.offsetLeft, py: e.clientY - r.top - stage.offsetTop };
    };
    block.addEventListener('wheel', e => {
      // inline, plain scrolling scrolls the page; full screen, it zooms
      if (!full && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { px, py } = local(e);
      // a mouse wheel moves in big steps (~100px a notch), a pinch in many small ones
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-dy * (Math.abs(dy) < 40 ? 0.01 : 0.002)), px, py);
    }, { passive: false });
    let drag = null;
    block.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('.mmd-tools, a')) return;
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: v.x, y: v.y };
      block.setPointerCapture(e.pointerId);
      block.classList.add('mmd-dragging');
    });
    block.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      v = { ...v, x: drag.x + e.clientX - drag.sx, y: drag.y + e.clientY - drag.sy };
      apply();
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      block.classList.remove('mmd-dragging');
    };
    block.addEventListener('pointerup', end);
    block.addEventListener('pointercancel', end);
    // a double-click opens the diagram full screen, or closes it there
    block.addEventListener('dblclick', e => {
      if (e.target.closest('.mmd-tools, .mmd-nav')) return;
      if (full) closeDiagram(); else openDiagram(block);
    });
    apply();
  }

  // ---- a diagram full screen: a floating panel over the page, 95% of the
  // window, with its own pan and zoom. ‹ › (or ←/→) step to the turn's other
  // diagrams; Esc, ✕ or a click outside closes it.
  let fullEl = null;
  let fullSource = null;
  const turnDiagrams = () => [...contentEl.querySelectorAll('.mermaid-block.mmd-pz')];
  // the diagrams are found again on each step: a live re-render replaces them
  function stepDiagram(d) {
    const list = turnDiagrams();
    const next = list[list.findIndex(b => b.dataset.source === fullSource) + d];
    if (next) openDiagram(next);
  }
  function openDiagram(inline) {
    const source = inline.dataset.source;
    const svgEl = inline.querySelector('.mmd-stage svg');
    if (!svgEl) return;
    closeDiagram();
    fullSource = source;
    const backdrop = document.createElement('div');
    backdrop.className = 'mmd-overlay';
    const block = document.createElement('div');
    block.className = 'mermaid-block mmd-full';
    block.dataset.source = `full:${source}`;
    views.delete(block.dataset.source); // open fitted to the screen
    const copy = svgEl.cloneNode(true);
    copy.removeAttribute('height');
    copy.setAttribute('width', '100%');
    copy.style.maxWidth = 'none';
    block.append(copy);
    backdrop.append(block);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeDiagram(); });
    document.body.append(backdrop);
    document.documentElement.classList.add('mmd-locked');
    fullEl = backdrop;
    panZoom(block, { full: true });

    const list = turnDiagrams();
    const at = list.indexOf(inline);
    if (list.length > 1 || inline.dataset.title) {
      const count = document.createElement('div');
      count.className = 'mmd-count';
      if (inline.dataset.title) {
        const t = document.createElement('b');
        t.textContent = inline.dataset.title;
        count.append(t);
      }
      if (list.length > 1) count.append(`Diagram ${at + 1} / ${list.length}`);
      block.append(count);
    }
    if (list.length > 1) {
      const nav = (cls, label, title, d) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = `mmd-nav ${cls}`; b.textContent = label; b.title = title;
        b.disabled = !list[at + d];
        b.onclick = e => { e.stopPropagation(); stepDiagram(d); };
        b.addEventListener('pointerdown', e => e.stopPropagation());
        b.addEventListener('dblclick', e => e.stopPropagation());
        block.append(b);
      };
      nav('prev', '‹', 'Previous diagram (←)', -1);
      nav('next', '›', 'Next diagram (→)', 1);
    }
  }
  function closeDiagram() {
    if (!fullEl) return;
    fullEl.remove();
    fullEl = null;
    document.documentElement.classList.remove('mmd-locked');
  }

  async function renderMermaid(root) {
    if (!window.mermaid) return;
    for (const block of root.querySelectorAll('.mermaid-block')) {
      try {
        const { svg } = await mermaid.render(`mmd-${++mermaidCounter}`, block.dataset.source);
        block.innerHTML = svg;
        panZoom(block);
      } catch (err) {
        block.innerHTML = '<div class="mermaid-error"></div>';
        block.firstChild.textContent = String(err && err.message || err).split('\n')[0];
      }
    }
  }

  function addAnchors(root) {
    const used = new Map();
    root.querySelectorAll('h1,h2,h3,h4').forEach(h => {
      let id = slug(h.textContent);
      const n = used.get(id) || 0;
      used.set(id, n + 1);
      if (n) id += `-${n}`;
      h.id = id;
      const a = document.createElement('a');
      a.className = 'anchor-link'; a.href = `#${id}`; a.textContent = '#';
      h.appendChild(a);
    });
  }

  // ---- TOC (one entry per turn)
  let tocKey = null;
  function buildToc() {
    const key = turns.map(t => t.title).join('\n');
    if (key === tocKey) return markActiveToc();
    tocKey = key;
    const toc = $('toc');
    toc.innerHTML = turns.length ? '' : '<div class="toc-empty">No turns yet</div>';
    turns.forEach((t, i) => {
      const a = document.createElement('a');
      a.href = `#turn-${i + 1}`;
      a.textContent = t.title;
      a.title = t.title;
      a.onclick = e => { e.preventDefault(); goTurn(i); };
      toc.appendChild(a);
    });
    markActiveToc();
  }
  function markActiveToc() {
    $('toc').querySelectorAll('a').forEach((a, i) => a.classList.toggle('active', i === cur));
  }
  let navQueued = false;
  addEventListener('scroll', () => {
    if (!navQueued) { navQueued = true; requestAnimationFrame(() => { navQueued = false; updateNav(); }); }
    // reaching the bottom of the newest turn turns follow back on
    const atBottom = innerHeight + scrollY >= document.body.scrollHeight - 40;
    if (atBottom && !follow && cur === turns.length - 1) setFollow(true);
  }, { passive: true });
  $('tocBtn').onclick = () => { document.body.classList.toggle('toc-open'); store.set('cp-toc', document.body.classList.contains('toc-open') ? '1' : '0'); };
  if (store.get('cp-toc') === '1') document.body.classList.add('toc-open');

  // ---- search: the turn on screen, or every turn ("All turns"), in text and,
  // each by its own box, tool calls, code blocks and diagrams (one hit per
  // diagram whose source matches). Only one turn is in the page, so the others
  // are counted from their own rendering (cached), and stepping past this
  // turn's last hit opens the next turn with one.
  let hits = [], hitIdx = -1;
  let searchAll = store.get('cp-search-all') === '1';
  const searchIn = { prompts: true, responses: true, tools: true, code: true, diagrams: true };
  try { Object.assign(searchIn, JSON.parse(store.get('cp-search-in') || '{}')); } catch { /* ignore */ }
  const SKIP_TEXT = '.copy-btn,.prompt-more,.code-lang,.anchor-link,svg,.turn-body>h2,.turn-nav,.mermaid-block';
  // whether text under el is left out by the checkboxes (in the page or a turn's own rendering)
  // each text is of one kind: a tool call's, a code block's, a prompt's, or
  // else Claude's reply
  function leftOut(el) {
    if (el?.closest('details.tool,details.tool-group>summary')) return !searchIn.tools;
    if (el?.closest('pre')) return !searchIn.code;
    if (el?.closest('.user-prompt')) return !searchIn.prompts;
    return !searchIn.responses;
  }
  const textCache = new Map(); // turn md -> { texts: [{ text, el }], diagrams: [source] }, lowercased
  function turnParts(md) {
    let parts = textCache.get(md);
    if (parts) return parts;
    const tpl = document.createElement('template');
    tpl.innerHTML = DOMPurify.sanitize(marked.parse(md, { gfm: true, breaks: false }));
    tpl.content.querySelector('h2')?.remove();
    const diagrams = [];
    tpl.content.querySelectorAll('code.language-mermaid').forEach(c => {
      diagrams.push(c.textContent.toLowerCase());
      c.closest('pre')?.remove();
    });
    const texts = [];
    const w = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) texts.push({ text: w.currentNode.textContent.toLowerCase(), el: w.currentNode.parentElement });
    parts = { texts, diagrams };
    if (textCache.size > 500) textCache.clear();
    textCache.set(md, parts);
    return parts;
  }
  function countIn({ texts, diagrams }, needle) {
    let n = 0;
    for (const { text, el } of texts) {
      if (leftOut(el)) continue;
      for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) n++;
    }
    if (searchIn.diagrams) n += diagrams.filter(d => d.includes(needle)).length;
    return n;
  }
  // hits per turn; the turn on screen counts what is marked in the page
  function turnCounts(needle) {
    return turns.map((t, i) => (i === cur ? hits.length : countIn(turnParts(t.md), needle)));
  }
  function showCount() {
    const q = $('searchInput').value.toLowerCase();
    if (!q) { $('searchCount').textContent = ''; return; }
    if (!searchAll) { $('searchCount').textContent = hits.length ? `${hitIdx + 1}/${hits.length}` : '0/0'; return; }
    const counts = turnCounts(q);
    const total = counts.reduce((a, b) => a + b, 0);
    const before = counts.slice(0, cur).reduce((a, b) => a + b, 0);
    const inTurns = counts.filter(Boolean).length;
    $('searchCount').textContent = total
      ? `${hits.length ? before + hitIdx + 1 : '–'}/${total} · ${inTurns} turn${inTurns === 1 ? '' : 's'}`
      : '0/0';
  }
  // the nearest other turn with a hit, stepping by dir (wrapping)
  function turnWithHit(dir, needle) {
    for (let k = 1; k < turns.length; k++) {
      const t = (cur + dir * k + turns.length * k) % turns.length;
      if (countIn(turnParts(turns[t].md), needle)) return t;
    }
    return -1;
  }
  function jumpTurnHit(dir) {
    const q = $('searchInput').value;
    const t = turnWithHit(dir, q.toLowerCase());
    if (t < 0) return false;
    goTurn(t);
    runSearch(q, null, { first: dir > 0 ? 0 : -1 });
    return true;
  }
  function stepHit(dir) {
    const next = hitIdx + dir;
    if (searchAll && (!hits.length || next < 0 || next >= hits.length) && jumpTurnHit(dir)) return;
    gotoHit(next);
  }
  function rerunSearch() { if ($('searchInput').value) runSearch($('searchInput').value); }
  function setSearchAll(on) {
    searchAll = on;
    store.set('cp-search-all', on ? '1' : '0');
    $('searchAll').checked = on;
    $('searchInput').placeholder = on ? 'Search all turns…' : 'Search this turn…';
    rerunSearch();
  }
  const SEARCH_BOXES = { prompts: 'searchPrompts', responses: 'searchResponses', tools: 'searchTools', code: 'searchCode', diagrams: 'searchDiagrams' };
  function setSearchIn(kind, on) {
    searchIn[kind] = on;
    store.set('cp-search-in', JSON.stringify(searchIn));
    $(SEARCH_BOXES[kind]).checked = on;
    rerunSearch();
  }
  function clearSearch() {
    contentEl.querySelectorAll('mark.search-hit').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
    contentEl.querySelectorAll('.search-hit-block').forEach(b => b.classList.remove('search-hit-block', 'current'));
    contentEl.normalize();
    hits = []; hitIdx = -1;
  }
  // keepIdx: a re-render keeps the place quietly; first: 0 or -1 picks the
  // first or last hit (a turn opened by stepping)
  function runSearch(q, keepIdx, { first } = {}) {
    clearSearch();
    if (!q) { $('searchCount').textContent = ''; return; }
    const needle = q.toLowerCase();
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement.closest(SKIP_TEXT) || leftOut(n.parentElement)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.textContent, lower = text.toLowerCase();
      let i = lower.indexOf(needle);
      if (i < 0) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      while (i >= 0) {
        frag.appendChild(document.createTextNode(text.slice(last, i)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = text.slice(i, i + needle.length);
        frag.appendChild(mark);
        hits.push(mark);
        last = i + needle.length;
        i = lower.indexOf(needle, last);
      }
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.replaceWith(frag);
    }
    if (searchIn.diagrams) {
      for (const block of contentEl.querySelectorAll('.mermaid-block')) {
        if (!(block.dataset.source || '').toLowerCase().includes(needle)) continue;
        block.classList.add('search-hit-block');
        hits.push(block);
      }
      hits.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    }
    if (keepIdx != null) { gotoHit(keepIdx < hits.length ? keepIdx : 0, true); return; }
    if (first != null) { gotoHit(first < 0 ? hits.length - 1 : 0); return; }
    // typing in "All turns" with no hit here: go to the nearest turn that has one
    if (searchAll && !hits.length && jumpTurnHit(1)) return;
    gotoHit(0);
  }
  function gotoHit(i, quiet) {
    if (!hits.length) { showCount(); return; }
    hitIdx = (i + hits.length) % hits.length;
    hits.forEach((h, j) => h.classList.toggle('current', j === hitIdx));
    showCount();
    if (quiet) return;
    const target = hits[hitIdx];
    for (let d = target.closest('details'); d; d = d.parentElement.closest('details')) d.open = true;
    target.closest('.user-prompt.collapsed')?.querySelector('.prompt-more')?.click();
    setFollow(false);
    target.scrollIntoView({ block: 'center' });
  }
  function openSearch() { $('searchBar').hidden = false; $('searchInput').focus(); $('searchInput').select(); }
  function closeSearch() { $('searchBar').hidden = true; clearSearch(); $('searchInput').value = ''; $('searchCount').textContent = ''; }
  $('searchBtn').onclick = () => ($('searchBar').hidden ? openSearch() : closeSearch());
  $('searchClose').onclick = closeSearch;
  $('searchNext').onclick = () => stepHit(1);
  $('searchPrev').onclick = () => stepHit(-1);
  $('searchAll').onchange = e => setSearchAll(e.target.checked);
  setSearchAll(searchAll);
  // the tip under the options: what the hovered (or focused) one covers, with
  // its part of a small mock turn lit
  const tip = $('searchTip');
  function showTip(opt) {
    if (!opt) { tip.hidden = true; return; }
    const name = opt.querySelector('span:not([class]),.sw-on')?.textContent;
    const scope = opt.dataset.kind === 'all';
    const text = tip.querySelector('.tip-text');
    text.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = scope ? (searchAll ? 'Scope: all turns' : 'Scope: this turn') : name;
    text.append(title, opt.dataset.tip);
    tip.querySelector('.tip-demo').dataset.focus = scope ? (searchAll ? 'all' : 'this') : opt.dataset.kind;
    tip.hidden = false;
  }
  $('searchBar').querySelectorAll('[data-tip]').forEach(opt => {
    opt.addEventListener('mouseenter', () => showTip(opt));
    opt.addEventListener('focusin', () => showTip(opt));
    opt.addEventListener('change', () => showTip(opt));
  });
  $('searchBar').addEventListener('mouseleave', () => { if (!$('searchBar').querySelector('[data-tip]:focus-within')) showTip(null); });
  $('searchBar').addEventListener('focusout', e => { if (!$('searchBar').contains(e.relatedTarget)) showTip(null); });
  for (const [kind, id] of Object.entries(SEARCH_BOXES)) {
    $(id).checked = searchIn[kind];
    $(id).onchange = e => setSearchIn(kind, e.target.checked);
  }
  $('searchInput').addEventListener('input', e => runSearch(e.target.value));
  $('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); }
    if (e.altKey && e.code === 'KeyA') { e.preventDefault(); setSearchAll(!searchAll); }
    if (e.altKey && e.code === 'KeyP') { e.preventDefault(); setSearchIn('prompts', !searchIn.prompts); }
    if (e.altKey && e.code === 'KeyR') { e.preventDefault(); setSearchIn('responses', !searchIn.responses); }
    if (e.altKey && e.code === 'KeyT') { e.preventDefault(); setSearchIn('tools', !searchIn.tools); }
    if (e.altKey && e.code === 'KeyC') { e.preventDefault(); setSearchIn('code', !searchIn.code); }
    if (e.altKey && e.code === 'KeyD') { e.preventDefault(); setSearchIn('diagrams', !searchIn.diagrams); }
    if (e.key === 'Escape') closeSearch();
  });

  // ---- keys
  addEventListener('keydown', e => {
    if (fullEl) {
      if (e.key === 'Escape') { e.preventDefault(); closeDiagram(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepDiagram(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepDiagram(1); }
      return;
    }
    const typing = e.target.closest('input,textarea');
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); openSearch(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); openSearch(); }
    else if (e.key === 't') $('tocBtn').click();
    else if (e.key === 'f') setFollow(!follow);
    else if (e.key === 'e') $('toolsBtn').click();
    else if (e.key === 'w') cycleWidth();
    else if (e.key === 'r') location.reload();
    else if (e.key === 'F') togglePin();
    else if (e.key === 'Escape' && document.body.classList.contains('files-peek')) unpeek();
    else if (e.key === 'Escape' && viewing) closeFile();
    else if (e.key === 'G') setFollow(true);
    else if (e.key === 'g') { setFollow(false, { noJump: true }); scrollTo({ top: 0 }); }
    else if (e.key === 'h') navigate('turn', -1);
    else if (e.key === 'l') navigate('turn', 1);
    else if (e.key === 'j') navigate('turn', 1);
    else if (e.key === 'k') navigate('turn', -1);
    else if (e.key === ']') navigate('code', 1);
    else if (e.key === '[') navigate('code', -1);
    else if (e.key === '}') navigate('diagram', 1);
    else if (e.key === '{') navigate('diagram', -1);
  });

  // ---- render: only the turn on screen
  const openKeys = new Set();
  // Long prompts show their first 4 lines and a "Read more" toggle; the
  // prompts opened stay open across re-renders (keyed by turn and index).
  const openPrompts = new Set();
  // The distance from the top of `box` to the bottom of its 4th rendered line
  // of text, or null when it has 4 lines or fewer.
  function fourthLineBottom(box) {
    const top = box.getBoundingClientRect().top;
    const lines = [];
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n; (n = walker.nextNode());) {
      if (!n.data.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.height && !lines.some(l => Math.abs(l.top - r.top) < r.height / 2)) lines.push({ top: r.top, bottom: r.bottom });
      }
    }
    if (lines.length <= 4) return null;
    lines.sort((a, b) => a.top - b.top);
    return Math.ceil(lines[3].bottom - top);
  }
  function collapsePrompts(body) {
    body.querySelectorAll('.user-prompt').forEach((el, i) => {
      const key = `${cur}:${i}`;
      const text = document.createElement('div');
      text.className = 'prompt-text';
      text.append(...el.childNodes);
      el.append(text);
      const cut = fourthLineBottom(text);
      if (cut == null) return;
      text.style.setProperty('--prompt-cut', `${cut}px`);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'prompt-more';
      const set = open => {
        el.classList.toggle('collapsed', !open);
        btn.textContent = open ? 'Show less' : 'Read more';
        if (open) openPrompts.add(key); else openPrompts.delete(key);
      };
      btn.onclick = () => set(el.classList.contains('collapsed'));
      el.append(btn);
      set(openPrompts.has(key));
    });
  }
  function renderTurn({ force = false } = {}) {
    if (viewing) return; // a file is on screen: the turn waits until it closes
    $('loadingSkeleton').style.display = 'none';
    contentEl.style.display = '';
    if (!turns.length) {
      renderedKey = null;
      contentEl.innerHTML = '<p class="turn-empty">No turns yet.</p>';
      return;
    }
    const turn = turns[cur];
    const key = `${cur}/${turns.length}\n${turn.md}`;
    if (!force && key === renderedKey) return;

    contentEl.querySelectorAll('details').forEach(d => {
      if (d.open) openKeys.add(detailsKey(d)); else openKeys.delete(detailsKey(d));
    });
    const sameTurn = renderedKey !== null && renderedKey.startsWith(`${cur}/`);
    const y = scrollY;
    renderedKey = key;

    const body = document.createElement('div');
    body.className = 'turn-body';
    body.innerHTML = DOMPurify.sanitize(marked.parse(turn.md, { gfm: true, breaks: false }));
    transformAlerts(body);
    enhanceCode(body);
    groupTools(body);
    body.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    body.querySelectorAll('details').forEach(d => { if (openKeys.has(detailsKey(d)) || toolsOpen) d.open = true; });

    contentEl.replaceChildren(turnNavBar('top'), body, turnNavBar('bottom'));
    fillFilesPanel();
    addAnchors(body);
    collapsePrompts(body);

    if (!$('searchBar').hidden && $('searchInput').value) runSearch($('searchInput').value, hitIdx);
    renderMermaid(body).then(() => {
      if (follow) scrollTo({ top: document.body.scrollHeight });
      updateNav();
    });
    if (follow) scrollTo({ top: document.body.scrollHeight });
    else if (sameTurn) scrollTo({ top: y });
    updateNav();
  }

  function applyText(md) {
    const parsed = splitTurns(md);
    turns = parsed.turns;
    if (parsed.title !== docTitle || document.title !== parsed.title) {
      docTitle = parsed.title;
      $('title').textContent = docTitle;
      document.title = docTitle;
    }
    if (cur < 0) {
      const fromHash = /^#turn-(\d+)$/.exec(location.hash);
      if (fromHash && Number(fromHash[1]) <= turns.length) { cur = Number(fromHash[1]) - 1; setFollow(false, { noJump: true }); }
    }
    const opening = cur < 0;
    if (follow || cur < 0 || cur >= turns.length) cur = turns.length - 1;
    $('updated').textContent = `updated ${new Date().toLocaleTimeString()}`;
    buildToc();
    renderTurn();
    if (opening) {
      scrollTo({ top: 0 });
      if (cur === turns.length - 1 && atPageBottom()) setFollow(true, { noJump: true });
    }
  }

  // compatibility for callers that re-render everything (theme switch)
  function render() { renderTurn({ force: true }); }

  $('refreshBtn').onclick = () => location.reload();

  // data.js carries the version of the page's own files: when the mod
  // rewrites them, reload to pick them up
  let pageVersion = null;
  function checkVersion(v) {
    if (pageVersion === null) pageVersion = v;
    else if (v && v !== pageVersion) location.reload();
  }

  // ---- the conversation's details (meta.json, written by the mod)
  const ICON = {
    ws: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-11.3 7.4"/>',
    pr: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10M18 17V9a2 2 0 0 0-2-2h-4m2-3-3 3 3 3"/>',
    id: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  };
  const svg = name => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
  function chip(tag, cls, icon, text, title) {
    const el = document.createElement(tag);
    el.className = `meta-chip ${cls}`;
    el.innerHTML = svg(icon);
    const span = document.createElement('span');
    span.textContent = text;
    el.append(span);
    el.title = title;
    return el;
  }
  let lastMetaText = null;
  function showMeta(m) {
    try {
      const text = JSON.stringify(m ?? null);
      if (text === lastMetaText || !m) return;
      lastMetaText = text;
      const items = [];
      if (m.workspace) items.push(chip('span', 'meta-ws', 'ws', m.workspace.split('/').filter(Boolean).at(-1) || m.workspace, `Workspace: ${m.workspace}`));
      if (m.branch) {
        const b = chip(m.repoUrl ? 'a' : 'span', 'meta-branch', 'branch', m.branch, `Branch: ${m.branch}`);
        if (m.repoUrl) { b.href = `${m.repoUrl}/tree/${m.branch.split('/').map(encodeURIComponent).join('/')}`; b.target = '_blank'; b.rel = 'noopener noreferrer'; }
        items.push(b);
      }
      if (m.pr && /^https?:\/\//.test(m.pr.url)) {
        const state = String(m.pr.state || '').toLowerCase();
        const p = chip('a', `meta-pr pr-${state}`, 'pr', `#${m.pr.number}`, `PR #${m.pr.number} (${state}): ${m.pr.title}`);
        p.href = m.pr.url; p.target = '_blank'; p.rel = 'noopener noreferrer';
        items.push(p);
      }
      if (m.id) {
        const c = chip('button', 'meta-id', 'id', m.id.slice(0, 8), `Conversation ${m.id}: click to copy`);
        c.onclick = () => navigator.clipboard?.writeText(m.id).then(() => {
          c.classList.add('copied'); setTimeout(() => c.classList.remove('copied'), 1200);
        });
        items.push(c);
      }
      $('meta').replaceChildren(...items);
    } catch { /* not there yet */ }
  }

  // ---- the files Claude edited: a header list (F), an "Edited" line at the
  // end of each turn, and Markdown files opened in place of the turn, kept
  // live from the copies the mod writes to files/<hash>.js
  let edited = [];
  let homeDir = '';
  let filesKey = '';
  let viewing = null; // { path, copy, md } while a file is on screen
  const FILE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 3v5h5M9 13h6M9 17h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const shortPath = p => homeDir && p.startsWith(homeDir + '/') ? `~${p.slice(homeDir.length)}` : p;
  const baseName = p => p.split('/').filter(Boolean).at(-1) || p;
  const fileUrl = p => `file://${p.split('/').map(encodeURIComponent).join('/')}`;

  function fileRow(f) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const name = document.createElement(f.copy ? 'button' : 'a');
    name.className = 'file-name';
    name.title = f.copy ? `Open ${f.path} here` : `Open ${f.path} in the browser`;
    const dir = shortPath(f.path).slice(0, -baseName(f.path).length);
    name.innerHTML = `${FILE_SVG}<span class="file-dir"></span><b></b>`;
    name.querySelector('.file-dir').textContent = `\u200E${dir}\u200E`; // keeps ~ first in the right-to-left clip
    name.querySelector('b').textContent = baseName(f.path);
    if (f.copy) name.onclick = () => openFile(f);
    else { name.href = fileUrl(f.path); name.target = '_blank'; name.rel = 'noopener'; }
    row.append(name);
    const side = document.createElement('span');
    side.className = 'file-side';
    const copy = document.createElement('button');
    copy.className = 'file-copy'; copy.textContent = 'copy'; copy.title = 'Copy the path';
    copy.onclick = () => navigator.clipboard?.writeText(f.path).then(() => {
      copy.textContent = 'copied'; setTimeout(() => { copy.textContent = 'copy'; }, 1200);
    });
    side.append(copy);
    row.append(side);
    return row;
  }

  function showFiles(files, home) {
    homeDir = home;
    const key = JSON.stringify(files);
    if (key === filesKey) return;
    filesKey = key;
    edited = files;
    if (viewing) viewing.copy = files.find(f => f.path === viewing.path)?.copy ?? viewing.copy;
    $('filesCtl').hidden = !files.length;
    $('filesEdge').hidden = !files.length;
    if (!files.length) setPanel(false);
    fillFilesPanel();
  }
  // the panel lists the files edited in the turn on screen
  function fillFilesPanel() {
    const turn = turns[cur];
    const n = turn ? parseInt(turn.title, 10) : NaN;
    const list = edited.filter(f => f.turns.includes(n));
    $('filesCount').textContent = String(list.length);
    $('filesBtn').classList.toggle('none', !list.length);
    const head = document.createElement('div');
    head.className = 'files-head';
    head.textContent = list.length ? `Turn ${n} · ${list.length} file${list.length === 1 ? '' : 's'} edited`
      : `Turn ${Number.isNaN(n) ? '' : n} · no files edited`;
    const rows = list.map(f => {
      const row = fileRow(f);
      if (viewing?.path === f.path) row.classList.add('current');
      return row;
    });
    $('filesPanel').replaceChildren(head, ...rows);
  }
  // hover opens it (peek) until the pointer leaves; a click or F pins it
  let peekTimer = 0;
  function peek(on) {
    clearTimeout(peekTimer);
    if (on) document.body.classList.add('files-peek');
    else peekTimer = setTimeout(() => document.body.classList.remove('files-peek'), 350);
  }
  function setPanel(pin) {
    document.body.classList.toggle('files-pin', pin);
    $('filesBtn').classList.toggle('active', pin);
    store.set('cp-files', pin ? '1' : '0');
    if (!pin) peek(false);
  }
  function unpeek() { // a file or a turn was picked: an unpinned panel gets out of the way
    clearTimeout(peekTimer);
    document.body.classList.remove('files-peek');
  }
  function togglePin() { setPanel(!document.body.classList.contains('files-pin')); }
  for (const el of [$('filesBtn'), $('filesEdge'), $('filesPanel')]) {
    el.addEventListener('mouseenter', () => peek(true));
    el.addEventListener('mouseleave', () => peek(false));
  }
  $('filesBtn').onclick = togglePin;
  if (store.get('cp-files') === '1') setPanel(true);

  function openFile(f) {
    unpeek();
    closeDiagram();
    viewing = { path: f.path, copy: f.copy, md: null };
    fillFilesPanel();
    setFollow(false, { noJump: true });
    load(f.copy);
  }
  window.__mdpFile = d => {
    if (!viewing || d.path !== viewing.path || d.md === viewing.md) return;
    const first = viewing.md === null;
    viewing.md = d.md;
    showFile(first);
  };
  function showFile(first) {
    const y = scrollY;
    const bar = document.createElement('div');
    bar.className = 'file-bar';
    const back = document.createElement('button');
    back.className = 'turn-nav-btn file-back';
    back.textContent = `← Turn ${parseInt(turns[cur]?.title, 10) || ''}`;
    back.title = 'Back to the conversation (Esc)';
    back.onclick = closeFile;
    const path = document.createElement('span');
    path.className = 'file-path';
    path.textContent = shortPath(viewing.path);
    path.title = viewing.path;
    const raw = document.createElement('a');
    raw.className = 'file-raw'; raw.textContent = 'raw'; raw.href = fileUrl(viewing.path);
    raw.target = '_blank'; raw.rel = 'noopener'; raw.title = 'Open the file itself';
    bar.append(back, path, raw);
    const body = document.createElement('div');
    body.className = 'file-body';
    body.innerHTML = DOMPurify.sanitize(marked.parse(viewing.md, { gfm: true, breaks: false }));
    transformAlerts(body);
    enhanceCode(body);
    body.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    contentEl.replaceChildren(bar, body);
    addAnchors(body);
    if (!$('searchBar').hidden && $('searchInput').value) runSearch($('searchInput').value, hitIdx);
    renderMermaid(body).then(updateNav);
    scrollTo({ top: first ? 0 : y });
    updateNav();
  }
  function closeFile() {
    if (!viewing) return;
    viewing = null;
    fillFilesPanel();
    renderTurn({ force: true });
    scrollTo({ top: 0 });
  }

  // The page is opened as a file:// page, which can't fetch() files but can
  // load scripts: the mod writes data.js (the conversation), and each poll
  // loads it again.
  window.__mdpData = d => {
    checkVersion(d.version);
    showMeta(d.meta);
    showFiles(d.files || [], d.home || '');
    if (d.md !== lastText) { lastText = d.md; applyText(d.md); }
  };
  function load(name) {
    return new Promise(resolve => {
      const el = document.createElement('script');
      el.src = `${name}?t=${Date.now()}`;
      el.onload = () => { el.remove(); resolve(true); };
      el.onerror = () => { el.remove(); resolve(false); };
      document.head.append(el);
    });
  }
  async function poll() {
    await Promise.all([load('data.js'), viewing?.copy ? load(viewing.copy) : null]);
    setTimeout(poll, POLL_MS);
  }
  poll();
})();
