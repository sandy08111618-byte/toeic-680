// ═══════════════════════════════════════════════════
//  多益 680 練功表 — Main Application
// ═══════════════════════════════════════════════════

// ── Constants ──────────────────────────────────────
const POS_LABELS  = { noun:'名詞', verb:'動詞', adj:'形容詞', adv:'副詞', other:'其他' };
const STATUS_LABELS = { new:'未熟', learning:'學習中', mastered:'精熟' };

// ── Utilities ──────────────────────────────────────
function genId() { return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function today()  { return new Date().toISOString().slice(0, 10); }

function formatDateShort(d) {
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth()+1}/${dt.getDate()}`;
}

function formatDateFull(d) {
  const dt = new Date(d + 'T00:00:00');
  const days = ['日','一','二','三','四','五','六'];
  return `${dt.getFullYear()}/${dt.getMonth()+1}/${dt.getDate()} (週${days[dt.getDay()]})`;
}

function showToast(msg, duration = 1800) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ── Data Layer (localStorage) ──────────────────────
const DB = {
  // Words
  getWords()  { return JSON.parse(localStorage.getItem('toeic_words') || '[]'); },
  saveWords(w){ localStorage.setItem('toeic_words', JSON.stringify(w)); if (window.FirebaseSync) FirebaseSync.scheduleSync(); },
  addWord(w)  {
    const words = DB.getWords();
    words.unshift(w);
    DB.saveWords(words);
    return w;
  },
  updateWord(id, patch) {
    const words = DB.getWords();
    const i = words.findIndex(w => w.id === id);
    if (i >= 0) { Object.assign(words[i], patch); DB.saveWords(words); return words[i]; }
    return null;
  },
  deleteWord(id) {
    const words = DB.getWords().filter(w => w.id !== id);
    DB.saveWords(words);
  },
  getTodayWords() {
    const t = today();
    return DB.getWords().filter(w => w.addedAt === t);
  },

  // Session (daily learning state)
  getSession()  { return JSON.parse(localStorage.getItem('toeic_session') || 'null'); },
  saveSession(s){ localStorage.setItem('toeic_session', JSON.stringify(s)); },
  clearSession(){ localStorage.removeItem('toeic_session'); },

  // Check-ins
  getCheckins() { return JSON.parse(localStorage.getItem('toeic_checkins') || '[]'); },
  saveCheckins(c){ localStorage.setItem('toeic_checkins', JSON.stringify(c)); if (window.FirebaseSync) FirebaseSync.scheduleSync(); },
  addCheckin(c) {
    const cis = DB.getCheckins().filter(x => x.date !== c.date); // one per day
    cis.unshift(c);
    DB.saveCheckins(cis);
    return c;
  },
  getTodayCheckin() {
    const t = today();
    return DB.getCheckins().find(c => c.date === t) || null;
  },

  // Session results log (for stats)
  getLogs() { return JSON.parse(localStorage.getItem('toeic_logs') || '[]'); },
  addLog(entry) {
    const logs = DB.getLogs();
    logs.push(entry);
    // Keep only last 90 days
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
    const cutStr = cutoff.toISOString().slice(0, 10);
    DB._saveLogs(logs.filter(l => l.date >= cutStr));
  },
  _saveLogs(l){ localStorage.setItem('toeic_logs', JSON.stringify(l)); if (window.FirebaseSync) FirebaseSync.scheduleSync(); },
};

// ── Router ─────────────────────────────────────────
let _activeTab = '';
const _app = () => document.getElementById('app');

function showTab(tab, force) {
  if (tab === _activeTab && !force) return;
  _activeTab = tab;
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  const app = _app();
  app.innerHTML = '';

  // Clean up any active word search
  if (_wsGame) { _wsGame.destroy(); _wsGame = null; }

  switch (tab) {
    case 'learning': renderLearning(app); break;
    case 'vocab':    renderVocab(app);    break;
    case 'checkin':  renderCheckin(app);  break;
    case 'stats':    renderStats(app);    break;
  }
}

// ══════════════════════════════════════════════════════════
//  LEARNING VIEW  (daily learning session state machine)
// ══════════════════════════════════════════════════════════

/*
  Session phases:
    IDLE           → pick today's words, show "開始練習"
    SPELLING       → show Chinese meaning, user types English
    WORDSEARCH_S   → single-word word search (3-5 occurrences)
    REMEDIAL       → re-do failed words (spelling only, no hints)
    WORDSEARCH_F   → combined final word search
    DONE           → completion screen
*/

let _session = null;
let _wsGame  = null;

function renderLearning(app) {
  _session = DB.getSession();

  if (_session && _session.date !== today()) {
    DB.clearSession();
    _session = null;
  }

  const view = el('div', 'view');
  app.appendChild(view);

  if (!_session) {
    renderLearningIdle(view);
  } else {
    dispatchPhase(view, _session.phase);
  }
}

function renderLearningIdle(view) {
  view.innerHTML = '';
  const todayWords = DB.getTodayWords();
  const prevSession = DB.getSession();

  const header = el('div', 'page-header');
  header.innerHTML = `<h1>今日學習</h1><span class="text-muted">${formatDateFull(today())}</span>`;
  view.appendChild(header);

  // If there's a saved session for today, offer to continue
  if (prevSession && prevSession.phase !== 'DONE') {
    const contCard = el('div', 'card');
    contCard.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span style="font-size:24px">⏸️</span>
        <div><div style="font-weight:600">有未完成的練習</div>
        <div class="text-muted">繼續上次的學習進度</div></div>
      </div>`;
    const row = el('div', 'flex-row', '');
    const btnCont = el('button', 'btn btn-primary', '繼續練習');
    const btnNew  = el('button', 'btn btn-ghost',   '重新開始');
    btnCont.onclick = () => { _session = prevSession; dispatchPhase(view, _session.phase); };
    btnNew.onclick  = () => { DB.clearSession(); _session = null; renderLearningIdle(view); };
    row.append(btnCont, btnNew);
    contCard.appendChild(row);
    view.appendChild(contCard);
    return;
  }

  if (todayWords.length === 0) {
    const empty = el('div', 'empty-state');
    empty.innerHTML = `
      <div class="empty-icon">📝</div>
      <p>今天還沒有新增單字<br>先到「單字庫」新增今天要練習的單字吧！</p>`;
    const btn = el('button', 'btn btn-primary', '前往單字庫');
    btn.onclick = () => showTab('vocab');
    empty.appendChild(btn);
    view.appendChild(empty);
    return;
  }

  // Show today's words
  const card = el('div', 'card session-idle');
  card.innerHTML = `<div class="section-title">今日練習單字（${todayWords.length} 個）</div>`;

  const list = el('ul', 'word-preview-list');
  todayWords.forEach(w => {
    const li = el('li', 'word-preview-item');
    li.innerHTML = `
      <span class="badge badge-${w.pos}">${POS_LABELS[w.pos] || w.pos}</span>
      <span class="word-en">${w.word}</span>
      <span class="word-zh">${w.meaning}</span>`;
    list.appendChild(li);
  });
  card.appendChild(list);

  const btn = el('button', 'btn btn-primary btn-full', '開始今日練習 ▶');
  btn.style.marginTop = '14px';
  btn.onclick = () => startSession(view, todayWords);
  card.appendChild(btn);
  view.appendChild(card);
}

function startSession(view, words) {
  _session = {
    date: today(),
    phase: 'SPELLING',
    words: words.map(w => w.id),
    wordIndex: 0,
    failedIds: [],
    remedialIndex: 0,
    results: {},   // id → { spelling:'correct'|'hint'|'failed' }
    startedAt: Date.now(),
  };
  DB.saveSession(_session);
  dispatchPhase(view, 'SPELLING');
}

function dispatchPhase(view, phase) {
  _session.phase = phase;
  DB.saveSession(_session);
  if (_wsGame) { _wsGame.destroy(); _wsGame = null; }
  view.innerHTML = '';

  const allWords = DB.getWords();
  const getWord = id => allWords.find(w => w.id === id);

  switch (phase) {
    case 'SPELLING': {
      const id = _session.words[_session.wordIndex];
      const word = getWord(id);
      if (!word) { advanceSpelling(view); return; }
      renderSpelling(view, word, false);
      break;
    }
    case 'WORDSEARCH_S': {
      const id = _session.words[_session.wordIndex];
      const word = getWord(id);
      if (!word) { advanceSpelling(view); return; }
      renderWordSearchSingle(view, word);
      break;
    }
    case 'REMEDIAL': {
      if (_session.failedIds.length === 0 || _session.remedialIndex >= _session.failedIds.length) {
        dispatchPhase(view, 'WORDSEARCH_F');
        return;
      }
      const id = _session.failedIds[_session.remedialIndex];
      const word = getWord(id);
      if (!word) { _session.remedialIndex++; DB.saveSession(_session); dispatchPhase(view, 'REMEDIAL'); return; }
      renderSpelling(view, word, true);
      break;
    }
    case 'WORDSEARCH_F': {
      const wordObjs = _session.words.map(getWord).filter(Boolean);
      renderWordSearchFinal(view, wordObjs);
      break;
    }
    case 'DONE': {
      renderDone(view);
      break;
    }
  }
}

// Called after spelling finishes for current word (whether pass or fail).
function advanceSpelling(view) {
  if (_session.phase === 'REMEDIAL') {
    advanceRemedial(view);
    return;
  }
  const id = _session.words[_session.wordIndex];
  const result = _session.results[id] || {};
  if (result.spelling === 'correct') {
    dispatchPhase(view, 'WORDSEARCH_S');
  } else {
    advanceToNextWord(view);
  }
}

function advanceRemedial(view) {
  _session.remedialIndex++;
  DB.saveSession(_session);
  if (_session.remedialIndex >= _session.failedIds.length) {
    dispatchPhase(view, 'WORDSEARCH_F');
  } else {
    dispatchPhase(view, 'REMEDIAL');
  }
}

function advanceToNextWord(view) {
  _session.wordIndex++;
  if (_session.wordIndex < _session.words.length) {
    dispatchPhase(view, 'SPELLING');
  } else {
    if (_session.failedIds.length > 0) {
      _session.remedialIndex = 0;
      dispatchPhase(view, 'REMEDIAL');
    } else {
      dispatchPhase(view, 'WORDSEARCH_F');
    }
  }
}

// ── Spelling Practice ───────────────────────────────

function renderSpelling(view, word, isRemedial) {
  const allWords = DB.getWords();
  const total = isRemedial ? _session.failedIds.length : _session.words.length;
  const idx   = isRemedial ? _session.remedialIndex    : _session.wordIndex;

  view.innerHTML = '';

  // Progress bar
  const pWrap = el('div', 'progress-bar-wrap');
  const pFill = el('div', 'progress-bar-fill');
  pFill.style.width = `${((idx) / total) * 100}%`;
  pWrap.appendChild(pFill);
  view.appendChild(pWrap);

  // Phase label
  const phase = el('div', 'text-muted', isRemedial ? `🔄 補救複習  ${idx+1} / ${total}` : `✏️ 拼字練習  ${idx+1} / ${total}`);
  phase.style.cssText = 'text-align:center;padding:8px 0;font-size:13px';
  view.appendChild(phase);

  // Word prompt card
  const prompt = el('div', 'word-prompt');
  prompt.innerHTML = `
    <div class="pos-label">${POS_LABELS[word.pos] || word.pos}</div>
    <div class="meaning">${word.meaning}</div>
    ${word.example ? `<div class="example">${_maskWord(word.example, word.word)}</div>` : ''}`;
  view.appendChild(prompt);

  // Hint display (hidden initially)
  const hintDisp = el('div', 'hint-display');
  hintDisp.style.display = 'none';
  view.appendChild(hintDisp);

  // Input
  const inputWrap = el('div', 'spelling-input-wrap');
  const input = el('input', 'spelling-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.autocorrect = 'off';
  input.autocapitalize = 'none';
  input.spellcheck = false;
  input.placeholder = '拼出英文單字…';
  inputWrap.appendChild(input);
  view.appendChild(inputWrap);

  // Action buttons
  const actions = el('div', 'spelling-actions');
  const btnCheck  = el('button', 'btn btn-primary', '確認');
  const btnHint   = el('button', 'btn btn-ghost',   '提示 (前2字)');
  const btnGiveup = el('button', 'btn btn-gray',     '不知道，直接看答案');
  btnGiveup.style.gridColumn = '1 / -1';

  actions.append(btnCheck, btnHint, btnGiveup);
  view.appendChild(actions);

  // State
  let hintShown = false;
  let answered  = false;

  const doCheck = () => {
    if (answered) return;
    const val = input.value.trim().toLowerCase();
    if (!val) return;

    if (val === word.word.toLowerCase()) {
      answered = true;
      input.classList.add('correct');
      input.value = word.word;
      btnCheck.disabled = btnHint.disabled = btnGiveup.disabled = true;
      _session.results[word.id] = { spelling: 'correct' };
      DB.updateWord(word.id, { status: word.status === 'new' ? 'learning' : word.status, lastReviewedAt: today() });
      DB.addLog({ date: today(), wordId: word.id, type: 'spelling', result: 'correct' });
      DB.saveSession(_session);
      showToast('✅ 答對了！');
      setTimeout(() => advanceSpelling(view), 900);
    } else {
      input.classList.add('wrong');
      setTimeout(() => input.classList.remove('wrong'), 400);
      if (!hintShown) {
        showToast('拼錯了，按「提示」看前兩個字母');
      }
    }
  };

  btnCheck.onclick = doCheck;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doCheck(); });

  btnHint.onclick = () => {
    if (answered) return;
    hintShown = true;
    const prefix = word.word.slice(0, 2);
    const blanks  = '_'.repeat(word.word.length - 2);
    hintDisp.textContent = prefix + blanks;
    hintDisp.style.display = '';
    input.placeholder = `${prefix}${'_'.repeat(word.word.length - 2)}`;
    input.focus();
    btnHint.disabled = true;
    _session.results[word.id] = { spelling: 'hint' };
    DB.saveSession(_session);
  };

  btnGiveup.onclick = () => {
    if (answered) return;
    answered = true;
    btnCheck.disabled = btnHint.disabled = btnGiveup.disabled = true;
    hintDisp.textContent = word.word;
    hintDisp.style.display = '';
    hintDisp.style.background = 'var(--warning-pale)';
    hintDisp.style.color = 'var(--warning)';

    _session.results[word.id] = { spelling: 'failed' };
    if (!_session.failedIds.includes(word.id)) _session.failedIds.push(word.id);
    DB.updateWord(word.id, { status: 'new', lastReviewedAt: today() });
    DB.addLog({ date: today(), wordId: word.id, type: 'spelling', result: 'failed' });
    DB.saveSession(_session);
    showToast('記得多看幾次喔！');

    const nextBtn = el('button', 'btn btn-gray btn-full', '繼續下一個 →');
    nextBtn.style.marginTop = '12px';
    nextBtn.onclick = () => {
      if (_session.phase === 'REMEDIAL') advanceRemedial(view);
      else advanceToNextWord(view);
    };
    view.appendChild(nextBtn);
  };

  // Focus after short delay (avoid keyboard flicker on phase transition)
  setTimeout(() => { try { input.focus(); } catch(_) {} }, 180);
}

function _maskWord(sentence, word) {
  const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return sentence.replace(re, '<span style="color:var(--primary);font-weight:700">___</span>');
}

// ── Single-Word Word Search ─────────────────────────

function renderWordSearchSingle(view, word) {
  view.innerHTML = '';

  const banner = el('div', 'phase-banner');
  banner.innerHTML = `
    <div class="icon">🔍</div>
    <h2>拼字正確！</h2>
    <p>現在在格子中找出所有隱藏的「<strong>${word.word.toUpperCase()}</strong>」</p>`;
  view.appendChild(banner);

  const container = el('div');
  view.appendChild(container);

  _wsGame = new WordSearchGame({
    container,
    words: [word.word],
    labels: { [word.word.toUpperCase()]: word.meaning },
    mode: 'single',
    occurrences: 4,
    onComplete: () => {
      if (_wsGame) { _wsGame.destroy(); _wsGame = null; }
      DB.updateWord(word.id, { status: 'learning' });
      showToast('🎉 全部找到！');
      setTimeout(() => advanceToNextWord(view), 400);
    },
  });
  _wsGame.render();
}

// ── Final Combined Word Search ──────────────────────

function renderWordSearchFinal(view, words) {
  view.innerHTML = '';

  const allWords = DB.getWords();

  // Banner depends on whether we went through remedial
  const hadFailed = _session.failedIds.length > 0;
  const banner = el('div', 'phase-banner');
  banner.innerHTML = `
    <div class="icon">🏁</div>
    <h2>${hadFailed ? '補救完成，最終挑戰！' : '全部拼對！最終挑戰！'}</h2>
    <p>在一個大格子裡找出今天所有 ${words.length} 個單字</p>`;
  view.appendChild(banner);

  const container = el('div');
  view.appendChild(container);

  const wsLabels = {};
  words.forEach(w => { wsLabels[w.word.toUpperCase()] = w.meaning; });

  _wsGame = new WordSearchGame({
    container,
    words: words.map(w => w.word),
    labels: wsLabels,
    mode: 'combined',
    onComplete: () => {
      if (_wsGame) { _wsGame.destroy(); _wsGame = null; }
      finishSession(view);
    },
  });
  _wsGame.render();
}

// ── Session Completion ──────────────────────────────

function finishSession(view) {
  const allWords = DB.getWords();
  const sessionWords = _session.words.map(id => allWords.find(w => w.id === id)).filter(Boolean);

  // Count results
  let correct = 0, failed = 0;
  sessionWords.forEach(w => {
    const r = _session.results[w.id];
    if (r?.spelling === 'correct') { correct++; DB.updateWord(w.id, { status: 'mastered' }); }
    else if (r?.spelling === 'failed') { failed++; }
  });

  _session.phase = 'DONE';
  _session.completedAt = Date.now();
  DB.saveSession(_session);

  dispatchPhase(view, 'DONE');
}

function renderDone(view) {
  const allWords = DB.getWords();
  const sessionWords = _session.words.map(id => allWords.find(w => w.id === id)).filter(Boolean);
  const total   = sessionWords.length;
  const correct = sessionWords.filter(w => _session.results[w.id]?.spelling === 'correct').length;
  const failed  = sessionWords.filter(w => _session.results[w.id]?.spelling === 'failed').length;
  const pct = total ? Math.round((correct / total) * 100) : 0;

  view.innerHTML = '';
  const done = el('div', 'done-screen');
  done.innerHTML = `
    <div class="done-icon">${pct === 100 ? '🏆' : pct >= 60 ? '🎉' : '💪'}</div>
    <h2>今日練習完成！</h2>
    <p class="subtitle">繼續加油，多益 680 指日可待！</p>
    <div class="done-stats">
      <div class="done-stat-item"><div class="stat-val">${total}</div><div class="stat-key">今日單字</div></div>
      <div class="done-stat-item"><div class="stat-val">${correct}</div><div class="stat-key">拼字正確</div></div>
      <div class="done-stat-item"><div class="stat-val">${failed}</div><div class="stat-key">需再加強</div></div>
      <div class="done-stat-item"><div class="stat-val">${pct}%</div><div class="stat-key">正確率</div></div>
    </div>`;

  const btnNew = el('button', 'btn btn-primary btn-full', '繼續新增單字');
  btnNew.onclick = () => { DB.clearSession(); _session = null; showTab('vocab'); };
  done.appendChild(btnNew);

  const btnRe = el('button', 'btn btn-ghost btn-full', '查看今日成果');
  btnRe.style.marginTop = '8px';
  btnRe.onclick = () => showTab('stats');
  done.appendChild(btnRe);

  view.appendChild(done);
}

// ══════════════════════════════════════════════════════════
//  VOCABULARY VIEW
// ══════════════════════════════════════════════════════════

let _vocabFilter = 'all';
let _vocabSearch = '';

function renderVocab(app) {
  const view = el('div', 'view');
  app.appendChild(view);

  const header = el('div', 'page-header');
  header.innerHTML = '<h1>單字庫</h1>';
  view.appendChild(header);

  // Search + Add button row
  const toolbar = el('div', 'vocab-toolbar');
  const search = el('input', 'vocab-search');
  search.type = 'text';
  search.placeholder = '搜尋單字…';
  search.value = _vocabSearch;
  search.oninput = () => { _vocabSearch = search.value; renderWordList(listContainer); };
  toolbar.appendChild(search);
  view.appendChild(toolbar);

  // Filter chips
  const filterRow = el('div', 'vocab-filter-row');
  [['all','全部'],['new','未熟'],['learning','學習中'],['mastered','精熟']].forEach(([k, label]) => {
    const chip = el('button', `filter-chip${_vocabFilter === k ? ' active' : ''}`, label);
    chip.onclick = () => {
      _vocabFilter = k;
      view.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderWordList(listContainer);
    };
    filterRow.appendChild(chip);
  });
  view.appendChild(filterRow);

  // Word list
  const listContainer = el('div', 'word-list-container');
  view.appendChild(listContainer);
  renderWordList(listContainer);

  // FAB
  const fab = el('button', 'fab', '+');
  fab.title = '新增單字';
  fab.onclick = () => openAddWordModal(listContainer);
  app.appendChild(fab);
}

function renderWordList(container) {
  container.innerHTML = '';
  const words = DB.getWords();
  const q = _vocabSearch.trim().toLowerCase();

  let filtered = words;
  if (_vocabFilter !== 'all') filtered = filtered.filter(w => w.status === _vocabFilter);
  if (q) filtered = filtered.filter(w =>
    w.word.toLowerCase().includes(q) || w.meaning.includes(q)
  );

  if (filtered.length === 0) {
    const empty = el('div', 'empty-state');
    empty.innerHTML = `<div class="empty-icon">🔍</div><p>${q || _vocabFilter !== 'all' ? '找不到符合的單字' : '還沒有任何單字，按右下角 + 新增吧！'}</p>`;
    container.appendChild(empty);
    return;
  }

  filtered.forEach(word => {
    const card = el('div', 'word-card');
    card.innerHTML = `
      <div class="word-card-header">
        <span class="word-card-en">${word.word}</span>
        <span class="badge badge-${word.pos}">${POS_LABELS[word.pos] || word.pos}</span>
        <span class="badge badge-${word.status}">${STATUS_LABELS[word.status]}</span>
      </div>
      <div class="word-card-zh">${word.meaning}</div>
      ${word.example ? `<div class="word-card-example">${word.example}</div>` : ''}`;

    if (word.example) {
      card.onclick = () => card.classList.toggle('expanded');
    }

    // Actions row (shown on expand)
    if (word.example || true) {
      const actRow = el('div', 'word-card-actions');
      actRow.style.display = 'none';

      const btnEdit = el('button', 'btn btn-ghost', '編輯');
      btnEdit.style.cssText = 'padding:6px 12px;font-size:13px';
      btnEdit.onclick = e => { e.stopPropagation(); openEditWordModal(word, () => renderWordList(container)); };

      const btnDel = el('button', 'btn btn-danger', '刪除');
      btnDel.style.cssText = 'padding:6px 12px;font-size:13px';
      btnDel.onclick = e => {
        e.stopPropagation();
        if (confirm(`確定要刪除「${word.word}」嗎？`)) {
          DB.deleteWord(word.id);
          renderWordList(container);
          showToast('已刪除');
        }
      };

      // Status cycle button
      const nextStatus = { new:'learning', learning:'mastered', mastered:'new' };
      const statusBtn = el('button', 'btn btn-gray', `→ ${STATUS_LABELS[nextStatus[word.status]]}`);
      statusBtn.style.cssText = 'padding:6px 12px;font-size:13px;margin-left:auto';
      statusBtn.onclick = e => {
        e.stopPropagation();
        DB.updateWord(word.id, { status: nextStatus[word.status] });
        renderWordList(container);
      };

      actRow.append(btnEdit, btnDel, statusBtn);
      card.appendChild(actRow);

      card.onclick = () => {
        const was = card.classList.contains('expanded');
        document.querySelectorAll('.word-card').forEach(c => { c.classList.remove('expanded'); c.querySelector('.word-card-actions').style.display = 'none'; });
        if (!was) { card.classList.add('expanded'); actRow.style.display = 'flex'; }
      };
    }

    container.appendChild(card);
  });
}

function openAddWordModal(listContainer, prefill) {
  openWordModal({ mode: 'add', prefill, onSave: () => renderWordList(listContainer) });
}

function openEditWordModal(word, onSave) {
  openWordModal({ mode: 'edit', prefill: word, wordId: word.id, onSave });
}

function openWordModal({ mode, prefill, wordId, onSave }) {
  const overlay = el('div', 'modal-overlay');

  const sheet = el('div', 'modal-sheet');
  sheet.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-title">${mode === 'add' ? '新增單字' : '編輯單字'}</div>`;

  // Form
  const wordInput = el('input', 'form-input');
  wordInput.placeholder = '英文單字';
  wordInput.type = 'text';
  wordInput.autocorrect = 'off';
  wordInput.autocapitalize = 'none';
  wordInput.spellcheck = false;
  if (prefill?.word) wordInput.value = prefill.word;

  // Lemmatizer hint
  const lemmaHint = el('div', 'lemma-hint');
  lemmaHint.style.display = 'none';
  let _suggestedBase = null;

  // Dictionary auto-fill debounce timer
  let _dictTimer = null;

  wordInput.addEventListener('input', () => {
    const val = wordInput.value.trim();
    // ── Lemmatizer hint ──
    if (!val || val.length < 3) { lemmaHint.style.display = 'none'; }
    else {
      const detected = detectBaseForm(val);
      if (detected) {
        _suggestedBase = detected.base;
        lemmaHint.style.display = 'flex';
        lemmaHint.querySelector('.hint-text').textContent = `🔍 ${detected.description}`;
      } else {
        lemmaHint.style.display = 'none';
        _suggestedBase = null;
      }
    }
    // ── Dictionary auto-fill (debounced 700 ms) ──
    clearTimeout(_dictTimer);
    if (val.length >= 2) {
      _dictTimer = setTimeout(() => fetchAndFillDict(val), 700);
    }
  });

  const hintText = el('span', 'hint-text');
  const hintAccept = el('button', 'btn btn-ghost', '採用原形');
  hintAccept.style.cssText = 'padding:4px 10px;font-size:12px';
  hintAccept.onclick = () => {
    if (_suggestedBase) { wordInput.value = _suggestedBase; lemmaHint.style.display = 'none'; }
  };
  lemmaHint.append(hintText, hintAccept);

  const autoFillStatus = el('div', 'auto-fill-status');
  autoFillStatus.style.display = 'none';

  const wrapWord = el('div', 'form-group');
  wrapWord.append(el('label', 'form-label', '英文單字'), wordInput, lemmaHint, autoFillStatus);
  sheet.appendChild(wrapWord);

  // POS
  const posGroup = el('div', 'form-group');
  posGroup.appendChild(el('label', 'form-label', '詞性'));
  const pillGroup = el('div', 'pill-group');
  let selectedPos = prefill?.pos || 'noun';
  Object.entries(POS_LABELS).forEach(([k, v]) => {
    const pill = el('button', `pill${k === selectedPos ? ' selected' : ''}`, v);
    pill.type = 'button';
    pill.dataset.pos = k;
    pill.onclick = () => { selectedPos = k; pillGroup.querySelectorAll('.pill').forEach(p => p.classList.remove('selected')); pill.classList.add('selected'); };
    pillGroup.appendChild(pill);
  });
  posGroup.appendChild(pillGroup);
  sheet.appendChild(posGroup);

  // Meaning
  const meaningInput = el('input', 'form-input');
  meaningInput.placeholder = '中文意思（例：談判；協商）';
  meaningInput.type = 'text';
  if (prefill?.meaning) meaningInput.value = prefill.meaning;
  const wrapMeaning = el('div', 'form-group');
  wrapMeaning.append(el('label', 'form-label', '中文意思'), meaningInput);
  sheet.appendChild(wrapMeaning);

  // Example
  const exInput = el('textarea', 'form-input');
  exInput.placeholder = '例句（可選）';
  exInput.rows = 2;
  if (prefill?.example) exInput.value = prefill.example;
  const wrapEx = el('div', 'form-group');
  wrapEx.append(el('label', 'form-label', '例句（可選）'), exInput);
  sheet.appendChild(wrapEx);

  // ── Auto-fill from dictionary (FreeDictionary + MyMemory) ────────────────
  async function fetchAndFillDict(rawWord) {
    const word = rawWord.trim().toLowerCase();
    if (!word || word.length < 2) return;
    autoFillStatus.textContent = '🔍 查詢字典中…';
    autoFillStatus.className = 'auto-fill-status loading';
    autoFillStatus.style.display = '';
    try {
      // 1. FreeDictionary API (free, no key)
      const res = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
      );
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      if (!Array.isArray(data) || !data[0]?.meanings) throw new Error('empty');

      let definition = '', example = '', posFound = '';
      outer: for (const meaning of data[0].meanings) {
        for (const def of meaning.definitions || []) {
          if (!definition && def.definition) {
            definition = def.definition;
            posFound   = meaning.partOfSpeech;
          }
          if (!example && def.example) example = def.example;
          if (definition && example) break outer;
        }
      }
      if (!definition) throw new Error('no def');

      // 2. MyMemory Translation API (free, no key)
      const trRes = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(definition)}&langpair=en|zh-TW`
      );
      const trData = await trRes.json();
      const chMeaning = trData?.responseData?.translatedText || '';

      // Auto-fill only when field is empty or was previously auto-filled
      if (chMeaning && (!meaningInput.value || meaningInput.dataset.auto === '1')) {
        meaningInput.value = chMeaning;
        meaningInput.dataset.auto = '1';
      }
      if (example && (!exInput.value || exInput.dataset.auto === '1')) {
        exInput.value = example;
        exInput.dataset.auto = '1';
      }
      // Auto-select POS
      const posMap = { noun: 'noun', verb: 'verb', adjective: 'adj', adverb: 'adv' };
      const mappedPos = posMap[posFound];
      if (mappedPos) {
        selectedPos = mappedPos;
        pillGroup.querySelectorAll('.pill').forEach(p => {
          p.classList.toggle('selected', p.dataset.pos === mappedPos);
        });
      }

      autoFillStatus.textContent = '✅ 已自動填入，可自行修改';
      autoFillStatus.className = 'auto-fill-status success';
      setTimeout(() => { autoFillStatus.style.display = 'none'; }, 3500);
    } catch (_) {
      autoFillStatus.textContent = '⚠️ 查無此單字，請手動填入';
      autoFillStatus.className = 'auto-fill-status error';
      setTimeout(() => { autoFillStatus.style.display = 'none'; }, 2500);
    }
  }

  // Save button
  const btnSave = el('button', 'btn btn-primary btn-full', mode === 'add' ? '新增' : '儲存');
  btnSave.onclick = () => {
    const word    = wordInput.value.trim();
    const meaning = meaningInput.value.trim();
    if (!word || !meaning) { showToast('請填寫英文單字和中文意思'); return; }

    if (mode === 'add') {
      DB.addWord({ id: genId(), word, pos: selectedPos, meaning, example: exInput.value.trim(), status: 'new', addedAt: today(), lastReviewedAt: null });
      showToast(`已新增「${word}」`);
    } else {
      DB.updateWord(wordId, { word, pos: selectedPos, meaning, example: exInput.value.trim() });
      showToast(`已更新「${word}」`);
    }
    overlay.remove();
    onSave?.();
  };
  sheet.appendChild(btnSave);

  const btnCancel = el('button', 'btn btn-gray btn-full', '取消');
  btnCancel.style.marginTop = '8px';
  btnCancel.onclick = () => overlay.remove();
  sheet.appendChild(btnCancel);

  overlay.appendChild(sheet);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);

  setTimeout(() => wordInput.focus(), 120);
}

// ══════════════════════════════════════════════════════════
//  CHECK-IN VIEW
// ══════════════════════════════════════════════════════════

function renderCheckin(app) {
  const view = el('div', 'view');
  app.appendChild(view);

  const header = el('div', 'page-header');
  header.innerHTML = '<h1>每日打卡</h1>';
  view.appendChild(header);

  // Streak card
  const streak = calcStreak();
  const streakCard = el('div', 'checkin-streak');
  streakCard.innerHTML = `
    <div class="streak-num">${streak}</div>
    <div class="streak-label">連續打卡天數 🔥</div>`;
  view.appendChild(streakCard);

  // Today's check-in form
  const existing = DB.getTodayCheckin();
  const formCard = el('div', 'checkin-form-card');
  formCard.innerHTML = `<h3>${existing ? '今日已打卡 ✅' : '今日打卡'}</h3>`;

  let minutes = existing?.minutes || 30;

  // Minutes picker
  const minWrap = el('div', 'minutes-input-wrap');
  const btnMinus = el('button', 'minutes-btn', '−');
  const minDisp  = el('div', 'minutes-display', `${minutes} 分鐘`);
  const btnPlus  = el('button', 'minutes-btn', '+');

  btnMinus.onclick = () => { minutes = Math.max(5, minutes - 5); minDisp.textContent = `${minutes} 分鐘`; };
  btnPlus.onclick  = () => { minutes = Math.min(480, minutes + 5); minDisp.textContent = `${minutes} 分鐘`; };
  minWrap.append(btnMinus, minDisp, btnPlus);
  formCard.appendChild(minWrap);

  const noteInput = el('input', 'form-input');
  noteInput.placeholder = '備註（今天讀了什麼？可選）';
  noteInput.type = 'text';
  noteInput.value = existing?.note || '';
  noteInput.style.marginBottom = '12px';
  formCard.appendChild(noteInput);

  const btnSave = el('button', 'btn btn-primary btn-full', existing ? '更新打卡' : '打卡！');
  btnSave.onclick = () => {
    DB.addCheckin({ date: today(), minutes, note: noteInput.value.trim() });
    showToast('✅ 打卡成功！');
    showTab('checkin', true);
  };
  formCard.appendChild(btnSave);
  view.appendChild(formCard);

  // Recent check-ins
  const checkins = DB.getCheckins().slice(0, 7);
  if (checkins.length > 0) {
    const recentSec = el('div', 'recent-checkins');
    recentSec.appendChild(el('h3', null, '最近打卡記錄'));
    checkins.forEach(ci => {
      const item = el('div', 'checkin-item');
      item.innerHTML = `
        <span class="ci-date">${formatDateShort(ci.date)}</span>
        <span class="ci-min">${ci.minutes} 分</span>
        <span class="ci-note">${ci.note || '—'}</span>`;
      recentSec.appendChild(item);
    });
    view.appendChild(recentSec);
  }
}

function calcStreak() {
  const checkins = DB.getCheckins().map(c => c.date).sort().reverse();
  if (!checkins.length) return 0;
  let streak = 0;
  let cur = today();
  for (const date of checkins) {
    if (date === cur) { streak++; const d = new Date(cur + 'T00:00:00'); d.setDate(d.getDate() - 1); cur = d.toISOString().slice(0, 10); }
    else if (date < cur) break;
  }
  return streak;
}

// ══════════════════════════════════════════════════════════
//  STATS VIEW
// ══════════════════════════════════════════════════════════

function renderStats(app) {
  const view = el('div', 'view');
  app.appendChild(view);

  const header = el('div', 'page-header');
  header.innerHTML = '<h1>學習統計</h1>';
  view.appendChild(header);

  const words    = DB.getWords();
  const checkins = DB.getCheckins();
  const logs     = DB.getLogs();

  // Overall stats
  const statsGrid = el('div', 'stats-grid');
  const total      = words.length;
  const mastered   = words.filter(w => w.status === 'mastered').length;
  const learning   = words.filter(w => w.status === 'learning').length;
  const streak     = calcStreak();

  [
    [total,    '總單字數'],
    [mastered, '已精熟'],
    [learning, '學習中'],
    [streak,   '連續天數 🔥'],
  ].forEach(([v, k]) => {
    const card = el('div', 'stat-card');
    card.innerHTML = `<div class="sv">${v}</div><div class="sk">${k}</div>`;
    statsGrid.appendChild(card);
  });

  const sec1 = el('div', 'stats-section');
  sec1.appendChild(el('h3', null, '整體進度'));
  sec1.appendChild(statsGrid);
  view.appendChild(sec1);

  // 28-day heatmap
  const sec2 = el('div', 'stats-section');
  sec2.appendChild(el('h3', null, '28 天學習紀錄'));
  sec2.appendChild(buildHeatmap(checkins));
  view.appendChild(sec2);

  // Weekly stats
  const sec3 = el('div', 'stats-section');
  sec3.appendChild(el('h3', null, '每週回顧'));
  sec3.appendChild(buildWeeklyStats(words, checkins, logs));
  view.appendChild(sec3);

  // Spelling accuracy trend
  const sec4 = el('div', 'stats-section');
  sec4.appendChild(el('h3', null, '4 週拼字正確率'));
  sec4.appendChild(buildAccuracyChart(logs));
  view.appendChild(sec4);

  // Export / Import backup
  const sec5 = el('div', 'stats-section');
  sec5.appendChild(el('h3', null, '資料備份'));

  const backupCard = el('div', 'card');

  const btnExport = el('button', 'btn btn-primary btn-full', '📤 匯出備份 JSON');
  btnExport.onclick = exportData;
  backupCard.appendChild(btnExport);

  const impRow = el('div');
  impRow.style.marginTop = '8px';
  const btnImport = el('button', 'btn btn-ghost btn-full', '📥 匯入備份 JSON');
  btnImport.onclick = () => {
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.accept = '.json';
    fi.onchange = ev => importData(ev.target.files[0]);
    fi.click();
  };
  impRow.appendChild(btnImport);
  backupCard.appendChild(impRow);

  backupCard.appendChild(el('div', 'backup-note', '可儲存至 iCloud / Google Drive 作為備份，換手機時匯入即可恢復所有資料'));

  sec5.appendChild(backupCard);
  view.appendChild(sec5);

  // ── 雲端同步區塊 ─────────────────────────────────────
  if (window.FirebaseSync) {
    const sec6 = el('div', 'stats-section');
    sec6.appendChild(el('h3', null, '☁️ 跨裝置同步'));
    const syncCard = el('div', 'card');

    const syncCode = FirebaseSync.getOrCreateSyncCode();

    // 同步碼顯示
    const codeLabel = el('div', 'form-label', '你的同步碼');
    const codeRow   = el('div', 'sync-code-row');
    const codeDisp  = el('div', 'sync-code-display', syncCode);
    const btnCopy   = el('button', 'btn btn-ghost', '複製');
    btnCopy.style.flexShrink = '0';
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(syncCode)
        .then(() => showToast('✅ 同步碼已複製！'))
        .catch(() => showToast('同步碼：' + syncCode));
    };
    codeRow.append(codeDisp, btnCopy);

    const syncNote = el('div', 'backup-note', '在另一台裝置的「統計」頁面輸入此同步碼，資料就會自動同步');

    // 上次同步狀態
    const syncStatusEl = el('div', 'sync-status-line');
    const lastSync = FirebaseSync.getLastSyncTime();
    syncStatusEl.textContent = lastSync ? `✅ 上次同步：${lastSync}` : '⬜ 尚未同步至雲端';

    // 立即同步按鈕
    const btnNow = el('button', 'btn btn-primary btn-full', '🔄 立即同步至雲端');
    btnNow.style.marginTop = '12px';
    btnNow.onclick = async () => {
      btnNow.disabled = true;
      btnNow.textContent = '同步中…';
      const ok = await FirebaseSync.syncToCloud();
      btnNow.disabled = false;
      btnNow.textContent = '🔄 立即同步至雲端';
      if (ok) {
        showToast('✅ 已同步至雲端！');
        syncStatusEl.textContent = `✅ 上次同步：${FirebaseSync.getLastSyncTime()}`;
      } else {
        showToast('❌ 同步失敗，請檢查網路');
      }
    };

    // 換裝置按鈕
    const btnSwitch = el('button', 'btn btn-ghost btn-full', '📱 輸入其他裝置的同步碼');
    btnSwitch.style.marginTop = '8px';
    btnSwitch.onclick = openSyncCodeModal;

    syncCard.append(codeLabel, codeRow, syncNote, syncStatusEl, btnNow, btnSwitch);
    sec6.appendChild(syncCard);
    view.appendChild(sec6);
  }
}

function buildHeatmap(checkins) {
  const ciMap = {};
  checkins.forEach(c => { ciMap[c.date] = c.minutes; });

  const wrap = el('div', 'heatmap-wrap');

  const grid = el('div', 'heatmap-grid');
  for (let i = 27; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const mins = ciMap[dateStr] || 0;
    const level = mins === 0 ? 0 : mins < 30 ? 1 : mins < 60 ? 2 : mins < 90 ? 3 : 4;
    const cell = el('div', 'hm-cell');
    cell.dataset.level = level;
    cell.title = `${formatDateShort(dateStr)}: ${mins ? mins + ' 分鐘' : '未打卡'}`;
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);

  const legend = el('div', 'heatmap-legend');
  legend.innerHTML = `少 ${[0,1,2,3,4].map(l => `<span class="hm-legend-cell hm-cell" data-level="${l}" style="display:inline-block"></span>`).join('')} 多`;
  wrap.appendChild(legend);

  return wrap;
}

function buildWeeklyStats(words, checkins, logs) {
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 6);
  const wsStr = weekStart.toISOString().slice(0, 10);

  const newWords     = words.filter(w => w.addedAt >= wsStr).length;
  const masteredW    = words.filter(w => w.status === 'mastered' && w.lastReviewedAt >= wsStr).length;
  const checkinDays  = checkins.filter(c => c.date >= wsStr).length;
  const weekLogs     = logs.filter(l => l.type === 'spelling' && l.date >= wsStr);
  const acc = weekLogs.length ? Math.round(weekLogs.filter(l => l.result === 'correct').length / weekLogs.length * 100) : null;

  const grid = el('div', 'stats-grid');
  [
    [newWords,   '本週新增單字'],
    [masteredW,  '本週精熟單字'],
    [checkinDays, '本週打卡天數'],
    [acc !== null ? acc + '%' : '—', '本週拼字準確率'],
  ].forEach(([v, k]) => {
    const card = el('div', 'stat-card');
    card.innerHTML = `<div class="sv">${v}</div><div class="sk">${k}</div>`;
    grid.appendChild(card);
  });
  return grid;
}

function buildAccuracyChart(logs) {
  const wrap = el('div', 'accuracy-chart');

  const bars = el('div', 'accuracy-bars');
  const labels = el('div', 'flex-row');
  labels.style.cssText = 'gap:8px;margin-top:4px';

  for (let w = 3; w >= 0; w--) {
    const end   = new Date(); end.setDate(end.getDate() - w * 7);
    const start = new Date(end); start.setDate(start.getDate() - 6);
    const s = start.toISOString().slice(0, 10);
    const e = end.toISOString().slice(0, 10);
    const wLogs = logs.filter(l => l.type === 'spelling' && l.date >= s && l.date <= e);
    const pct = wLogs.length ? Math.round(wLogs.filter(l => l.result === 'correct').length / wLogs.length * 100) : 0;

    const bWrap = el('div', 'acc-bar-wrap');
    const bar = el('div', 'acc-bar');
    bar.style.height = `${Math.max(4, pct * 0.8)}px`;
    const val = el('div', 'acc-bar-val', wLogs.length ? pct + '%' : '—');
    bWrap.append(bar, val);
    bars.appendChild(bWrap);

    const lbl = el('div', 'acc-bar-label acc-bar-wrap');
    lbl.textContent = `W${4-w}`;
    lbl.style.flex = '1';
    lbl.style.textAlign = 'center';
    labels.appendChild(lbl);
  }

  wrap.append(el('h3', null, '（W4 = 最近一週）'), bars, labels);
  return wrap;
}

// ══════════════════════════════════════════════════════════
//  EXPORT / IMPORT
// ══════════════════════════════════════════════════════════

function exportData() {
  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    words:    DB.getWords(),
    checkins: DB.getCheckins(),
    logs:     DB.getLogs(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `toeic-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('✅ 備份已下載！');
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.version || !Array.isArray(data.words)) throw new Error('bad format');
      if (!confirm(`即將匯入 ${data.words.length} 個單字，這會覆蓋現有所有資料。確定繼續？`)) return;
      DB.saveWords(data.words);
      if (Array.isArray(data.checkins)) DB.saveCheckins(data.checkins);
      if (Array.isArray(data.logs))     DB._saveLogs(data.logs);
      showToast(`✅ 匯入成功！共 ${data.words.length} 個單字`);
      showTab(_activeTab, true);
    } catch (_) {
      showToast('❌ 匯入失敗，請確認檔案格式');
    }
  };
  reader.readAsText(file);
}

// ══════════════════════════════════════════════════════════
//  SYNC CODE MODAL
// ══════════════════════════════════════════════════════════

function openSyncCodeModal() {
  const overlay = el('div', 'modal-overlay');
  const sheet   = el('div', 'modal-sheet');
  sheet.innerHTML = '<div class="modal-handle"></div><div class="modal-title">使用其他裝置的同步碼</div>';

  const input = el('input', 'form-input');
  input.placeholder = '例：swift-panda-4829';
  input.type = 'text';
  input.autocapitalize = 'none';
  input.autocorrect = 'off';
  input.spellcheck = false;
  sheet.appendChild(input);

  const note = el('div', 'backup-note', '輸入舊裝置「統計」頁面顯示的同步碼，即可從雲端下載所有資料');
  sheet.appendChild(note);

  const statusMsg = el('div', 'sync-status-line');
  statusMsg.style.marginBottom = '4px';
  sheet.appendChild(statusMsg);

  const btnConfirm = el('button', 'btn btn-primary btn-full', '確認，下載雲端資料');
  btnConfirm.style.marginTop = '12px';
  btnConfirm.onclick = async () => {
    const code = input.value.trim().toLowerCase();
    if (!code) { showToast('請輸入同步碼'); return; }
    btnConfirm.disabled = true;
    btnConfirm.textContent = '同步中…';
    statusMsg.textContent = '🔄 連線中…';

    FirebaseSync.setSyncCode(code);
    const result = await FirebaseSync.syncFromCloud(code);

    if (result === 'empty') {
      statusMsg.textContent = '⚠️ 找不到此同步碼的資料，請確認輸入是否正確';
      btnConfirm.disabled = false;
      btnConfirm.textContent = '確認，下載雲端資料';
    } else if (!result) {
      statusMsg.textContent = '❌ 同步失敗，請檢查網路連線';
      btnConfirm.disabled = false;
      btnConfirm.textContent = '確認，下載雲端資料';
    } else {
      overlay.remove();
      showToast('✅ 同步成功！已更新所有資料');
      showTab(_activeTab, true);
    }
  };
  sheet.appendChild(btnConfirm);

  const btnCancel = el('button', 'btn btn-gray btn-full', '取消');
  btnCancel.style.marginTop = '8px';
  btnCancel.onclick = () => overlay.remove();
  sheet.appendChild(btnCancel);

  overlay.appendChild(sheet);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
  setTimeout(() => input.focus(), 120);
}

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
}

function init() {
  registerSW();
  setupNav();
  showTab('learning');

  // Firebase 雲端同步（背景執行，不阻塞畫面）
  if (window.FirebaseSync) {
    FirebaseSync.init();
    (async () => {
      const code = FirebaseSync.getOrCreateSyncCode();
      const result = await FirebaseSync.syncFromCloud(code);
      if (result && result !== 'empty') {
        // 雲端有新資料 → 重新載入目前頁面
        showToast('☁️ 已從雲端同步資料');
        showTab(_activeTab, true);
      } else if (result === 'empty') {
        // 第一次用這組同步碼 → 把本機資料上傳到雲端
        FirebaseSync.syncToCloud();
      }
    })();
  }
}

// Scripts are at bottom of <body>, so DOM is already ready when this runs.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
