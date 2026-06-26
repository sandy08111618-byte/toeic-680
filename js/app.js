// ═══════════════════════════════════════════════════
//  多益 680 練功表 — Main Application
// ═══════════════════════════════════════════════════

// ── Constants ──────────────────────────────────────
const POS_LABELS  = { noun:'名詞', verb:'動詞', adj:'形容詞', adv:'副詞', other:'其他' };
const STATUS_LABELS = { new:'未熟', learning:'學習中', mastered:'精熟' };

// 間隔複習天數：第1次→1天後，第2次→3天後，第3次→7天後...
const SRS_INTERVALS = [1, 3, 7, 14, 30];

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

  // ── Spaced Repetition (SRS) ────────────────────────
  getDueWords() {
    const t = today();
    return DB.getWords().filter(w => w.nextReviewDate && w.nextReviewDate <= t);
  },

  recordReview(id, success) {
    const words = DB.getWords();
    const i = words.findIndex(w => w.id === id);
    if (i < 0) return null;
    const now = today();
    const oldCount = words[i].reviewCount || 0;
    const count = success ? oldCount + 1 : Math.max(0, oldCount - 1);
    const intervalDays = success
      ? SRS_INTERVALS[Math.min(count - 1, SRS_INTERVALS.length - 1)]
      : 1; // 答錯：明天再複習
    const nextDate = new Date(now + 'T00:00:00');
    nextDate.setDate(nextDate.getDate() + intervalDays);
    Object.assign(words[i], {
      reviewCount:    count,
      nextReviewDate: nextDate.toISOString().slice(0, 10),
      lastReviewedAt: now,
      status: count >= SRS_INTERVALS.length ? 'mastered' : count > 0 ? 'learning' : 'new',
    });
    DB.saveWords(words);
    return words[i];
  },

  // ── Daily activity log (自動紀錄，不需手動打卡) ────
  getActivity() { return JSON.parse(localStorage.getItem('toeic_activity') || '{}'); },
  logActivity(type) { // type: 'new' | 'review'
    const t = today();
    const act = DB.getActivity();
    if (!act[t]) act[t] = { new: 0, review: 0 };
    act[t][type]++;
    localStorage.setItem('toeic_activity', JSON.stringify(act));
    if (window.FirebaseSync) FirebaseSync.scheduleSync();
  },

  // ── Daily goal ──────────────────────────────────────
  getGoal()  { return parseInt(localStorage.getItem('toeic_goal') || '10'); },
  saveGoal(n){ localStorage.setItem('toeic_goal', String(n)); if (window.FirebaseSync) FirebaseSync.scheduleSync(); },
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
  const dueWords   = DB.getDueWords();
  const prevSession = DB.getSession();

  const header = el('div', 'page-header');
  header.innerHTML = `<h1>今日學習</h1><span class="text-muted">${formatDateFull(today())}</span>`;
  view.appendChild(header);

  // 未完成的學習 session
  if (prevSession && prevSession.phase !== 'DONE') {
    const contCard = el('div', 'card');
    contCard.innerHTML = `
      <div style="margin-bottom:12px">
        <div style="font-weight:700;margin-bottom:4px">有未完成的練習</div>
        <div class="text-muted">繼續上次的學習進度</div>
      </div>`;
    const row = el('div', 'flex-row');
    const btnCont = el('button', 'btn btn-primary', '繼續練習');
    const btnNew  = el('button', 'btn btn-ghost',   '重新開始');
    btnCont.onclick = () => { _session = prevSession; dispatchPhase(view, _session.phase); };
    btnNew.onclick  = () => { DB.clearSession(); _session = null; renderLearningIdle(view); };
    row.append(btnCont, btnNew);
    contCard.appendChild(row);
    view.appendChild(contCard);
    return;
  }

  const hasNew = todayWords.length > 0;
  const hasDue = dueWords.length > 0;
  const todayActivity = DB.getActivity()[today()] || {};
  const completedToday = (todayActivity.new || 0) > 0;

  // 今日新單字 卡片
  const newCard = el('div', 'card learn-section-card');
  const newTitle = el('div', 'learn-section-title', '今日新單字');
  const newDesc = el('div', 'learn-section-count');

  if (hasNew) {
    if (completedToday) {
      newDesc.innerHTML = `<span class="done-badge">今日已完成</span> 共 ${todayWords.length} 個單字`;
    } else {
      newDesc.textContent = `${todayWords.length} 個單字等待學習`;
    }
    const btnNew = el('button', 'btn btn-primary', '開始學習');
    btnNew.onclick = () => startSession(view, todayWords);

    const list = el('ul', 'word-preview-list');
    todayWords.slice(0, 5).forEach(w => {
      const li = el('li', 'word-preview-item');
      li.innerHTML = `<span class="badge badge-${w.pos}">${POS_LABELS[w.pos] || w.pos}</span>
        <span class="word-en">${w.word}</span><span class="word-zh">${w.meaning}</span>`;
      list.appendChild(li);
    });
    if (todayWords.length > 5) {
      const more = el('li', 'word-preview-item text-muted');
      more.textContent = `…還有 ${todayWords.length - 5} 個`;
      list.appendChild(more);
    }
    newCard.append(newTitle, newDesc, list, btnNew);
  } else {
    newDesc.textContent = '今天還沒有新增單字';
    newDesc.className = 'learn-section-count text-muted';
    const btnGo = el('button', 'btn btn-ghost', '前往單字庫新增');
    btnGo.onclick = () => showTab('vocab');
    newCard.append(newTitle, newDesc, btnGo);
  }
  view.appendChild(newCard);

  // 今日到期複習 卡片
  const dueCard = el('div', 'card learn-section-card');
  const dueTitle = el('div', 'learn-section-title', '今日到期複習');
  const dueDesc = el('div', 'learn-section-count');

  if (hasDue) {
    dueDesc.textContent = `${dueWords.length} 個單字需要複習`;
    const btnReview = el('button', 'btn btn-primary', '開始複習');
    btnReview.onclick = () => startReviewSession(view, dueWords);
    dueCard.append(dueTitle, dueDesc, btnReview);
  } else {
    dueDesc.textContent = '今天沒有到期的複習';
    dueDesc.className = 'learn-section-count text-muted';
    const note = el('div', 'text-muted');
    note.style.fontSize = '12px';
    note.textContent = DB.getWords().filter(w => w.nextReviewDate).length > 0
      ? '很好，繼續保持！'
      : '完成新單字學習後，複習計畫會自動安排';
    dueCard.append(dueTitle, dueDesc, note);
  }
  view.appendChild(dueCard);
}

function startSession(view, words) {
  _session = {
    date: today(),
    phase: 'SPELLING',
    words: words.map(w => w.id),
    wordIndex: 0,
    failedIds: [],
    remedialIndex: 0,
    remedialPending: null,  // initialized when first entering REMEDIAL
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
      // Initialize the pending queue on first entry into REMEDIAL
      if (!_session.remedialPending) {
        _session.remedialPending = [..._session.failedIds];
        DB.saveSession(_session);
      }
      if (_session.failedIds.length === 0 || _session.remedialPending.length === 0) {
        dispatchPhase(view, 'WORDSEARCH_F');
        return;
      }
      const id = _session.remedialPending[0];
      const word = getWord(id);
      if (!word) {
        _session.remedialPending.shift();
        DB.saveSession(_session);
        dispatchPhase(view, 'REMEDIAL');
        return;
      }
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
  // Word answered correctly — shift it off the pending queue, then show word search
  const correctedId = _session.remedialPending.shift();
  DB.saveSession(_session);

  const allWords = DB.getWords();
  const word = allWords.find(w => w.id === correctedId);

  const afterWS = () => {
    if (_session.remedialPending.length === 0) {
      dispatchPhase(view, 'WORDSEARCH_F');
    } else {
      dispatchPhase(view, 'REMEDIAL');
    }
  };

  if (word) {
    renderWordSearchSingle(view, word, afterWS);
  } else {
    afterWS();
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
  const failedTotal        = _session.failedIds?.length || 0;
  const remedialRemaining  = _session.remedialPending?.length || 0;
  const total = isRemedial ? failedTotal : _session.words.length;
  const idx   = isRemedial ? (failedTotal - remedialRemaining) : _session.wordIndex;

  view.innerHTML = '';

  // Progress bar
  const pWrap = el('div', 'progress-bar-wrap');
  const pFill = el('div', 'progress-bar-fill');
  pFill.style.width = `${((idx) / total) * 100}%`;
  pWrap.appendChild(pFill);
  view.appendChild(pWrap);

  // Phase label
  const phaseText = isRemedial
    ? `補救複習  還有 ${remedialRemaining} 個`
    : `拼字練習  ${idx+1} / ${total}`;
  const phase = el('div', 'text-muted', phaseText);
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
      // Preserve hintUsed flag if the hint button was clicked before answering
      const prevResult = _session.results[word.id] || {};
      _session.results[word.id] = { ...prevResult, spelling: 'correct' };
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
    _session.results[word.id] = { spelling: 'hint', hintUsed: true };
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
      if (_session.phase === 'REMEDIAL') {
        // Move this word to the end of the pending queue (keep cycling until correct)
        _session.remedialPending.push(_session.remedialPending.shift());
        DB.saveSession(_session);
        dispatchPhase(view, 'REMEDIAL');
      } else {
        advanceToNextWord(view);
      }
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

function renderWordSearchSingle(view, word, onCompleteCb) {
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
      showToast('全部找到！');
      if (onCompleteCb) {
        setTimeout(() => onCompleteCb(), 400);
      } else {
        setTimeout(() => advanceToNextWord(view), 400);
      }
    },
  });
  _wsGame.render();
}

// ── Final Combined Word Search ──────────────────────

function renderWordSearchFinal(view, words) {
  view.innerHTML = '';

  // Banner depends on whether we went through remedial
  const hadFailed = _session.failedIds.length > 0;
  const banner = el('div', 'phase-banner');
  banner.innerHTML = `
    <div class="icon">🏁</div>
    <h2>${hadFailed ? '補救完成，最終挑戰！' : '全部拼對！最終挑戰！'}</h2>
    <p>在一個大格子裡找出今天所有 ${words.length} 個單字，也可以在下方直接拼出</p>`;
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

  // Give-up button
  const btnGiveup = el('button', 'btn btn-danger ws-giveup-btn', '放棄');
  btnGiveup.onclick = () => openGiveUpConfirm(view);
  view.appendChild(btnGiveup);
}

function openGiveUpConfirm(view) {
  const overlay = el('div', 'modal-overlay confirm-overlay');
  const dialog  = el('div', 'confirm-dialog');
  dialog.innerHTML = `
    <h3>確定要放棄嗎？</h3>
    <p>尚未找到或拼出的單字將被標為「未熟」，下次練習時重新學習。</p>`;

  const row = el('div', 'confirm-btn-row');
  const btnNo  = el('button', 'btn btn-ghost', '取消');
  const btnYes = el('button', 'btn btn-danger', '確定放棄');

  btnNo.onclick = () => document.body.removeChild(overlay);

  btnYes.onclick = () => {
    document.body.removeChild(overlay);
    // Mark unfound/unspelled words as 未熟, reset SRS
    if (_wsGame) {
      const unfound = _wsGame.getUnfoundWords();
      const allWords = DB.getWords();
      unfound.forEach(wordStr => {
        const wordObj = allWords.find(w => w.word.toUpperCase() === wordStr);
        if (wordObj) {
          DB.updateWord(wordObj.id, {
            status: 'new',
            reviewCount: 0,
            nextReviewDate: null,
            lastReviewedAt: today(),
          });
          if (_session) {
            const prev = _session.results[wordObj.id] || {};
            _session.results[wordObj.id] = { ...prev, spelling: prev.spelling || 'failed', giveUp: true };
          }
        }
      });
      if (_session) DB.saveSession(_session);
      _wsGame.destroy();
      _wsGame = null;
    }
    finishSession(view);
  };

  row.append(btnNo, btnYes);
  dialog.appendChild(row);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
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

  // 記錄 SRS：只有「第一次就拼對、沒按提示、沒進補救」才算真正學會
  _session.words.forEach(id => {
    const r = _session.results[id];
    const trueSuccess = r?.spelling === 'correct'
      && !r?.hintUsed                          // 沒有按過提示
      && !_session.failedIds.includes(id);     // 沒有進過補救階段
    DB.recordReview(id, trueSuccess);
  });
  DB.logActivity('new');
  DB.clearSession();
  _session = null;

  view.innerHTML = '';
  const done = el('div', 'done-screen');
  done.innerHTML = `
    <div class="done-label">${pct === 100 ? '全對！' : pct >= 60 ? '完成' : '繼續加油'}</div>
    <h2>今日練習完成</h2>
    <p class="subtitle">下次複習時間已自動安排好</p>
    <div class="done-stats">
      <div class="done-stat-item"><div class="stat-val">${total}</div><div class="stat-key">今日單字</div></div>
      <div class="done-stat-item"><div class="stat-val">${correct}</div><div class="stat-key">拼字正確</div></div>
      <div class="done-stat-item"><div class="stat-val">${failed}</div><div class="stat-key">需加強</div></div>
      <div class="done-stat-item"><div class="stat-val">${pct}%</div><div class="stat-key">正確率</div></div>
    </div>`;

  const btnNew = el('button', 'btn btn-primary btn-full', '繼續新增單字');
  btnNew.onclick = () => showTab('vocab');
  done.appendChild(btnNew);

  const btnRe = el('button', 'btn btn-ghost btn-full', '查看學習統計');
  btnRe.style.marginTop = '8px';
  btnRe.onclick = () => showTab('stats');
  done.appendChild(btnRe);

  view.appendChild(done);
}

// ══════════════════════════════════════════════════════════
//  REVIEW SESSION  (間隔複習，僅拼字，不含 word search)
// ══════════════════════════════════════════════════════════

let _reviewSession = null;

function startReviewSession(view, dueWords) {
  _reviewSession = {
    date:       today(),
    words:      dueWords.map(w => w.id),
    currentIdx: 0,
    results:    {}, // id → 'correct' | 'failed'
  };
  renderReviewSpelling(view);
}

function renderReviewSpelling(view) {
  if (!_reviewSession || _reviewSession.currentIdx >= _reviewSession.words.length) {
    renderReviewDone(view);
    return;
  }

  const allWords = DB.getWords();
  const id   = _reviewSession.words[_reviewSession.currentIdx];
  const word = allWords.find(w => w.id === id);
  if (!word) { _reviewSession.currentIdx++; renderReviewSpelling(view); return; }

  const total = _reviewSession.words.length;
  const idx   = _reviewSession.currentIdx;

  view.innerHTML = '';

  // 進度條
  const pWrap = el('div', 'progress-bar-wrap');
  const pFill = el('div', 'progress-bar-fill');
  pFill.style.width = `${(idx / total) * 100}%`;
  pWrap.appendChild(pFill);
  view.appendChild(pWrap);

  const phaseLabel = el('div', 'text-muted', `複習  ${idx + 1} / ${total}`);
  phaseLabel.style.cssText = 'text-align:center;padding:8px 0;font-size:13px';
  view.appendChild(phaseLabel);

  // 單字提示卡
  const prompt = el('div', 'word-prompt');
  prompt.innerHTML = `
    <div class="pos-label">${POS_LABELS[word.pos] || word.pos}</div>
    <div class="meaning">${word.meaning}</div>
    ${word.example ? `<div class="example">${_maskWord(word.example, word.word)}</div>` : ''}`;
  view.appendChild(prompt);

  const hintDisp = el('div', 'hint-display');
  hintDisp.style.display = 'none';
  view.appendChild(hintDisp);

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

  const actions = el('div', 'spelling-actions');
  const btnCheck  = el('button', 'btn btn-primary', '確認');
  const btnGiveup = el('button', 'btn btn-gray', '看答案');
  btnGiveup.style.gridColumn = '1 / -1';
  actions.append(btnCheck, btnGiveup);
  view.appendChild(actions);

  let answered = false;
  const advance = () => { _reviewSession.currentIdx++; renderReviewSpelling(view); };

  const doCheck = () => {
    if (answered) return;
    const val = input.value.trim().toLowerCase();
    if (!val) return;
    if (val === word.word.toLowerCase()) {
      answered = true;
      input.classList.add('correct');
      input.value = word.word;
      btnCheck.disabled = btnGiveup.disabled = true;
      _reviewSession.results[id] = 'correct';
      DB.addLog({ date: today(), wordId: id, type: 'spelling', result: 'correct' });
      showToast('答對了');
      setTimeout(advance, 900);
    } else {
      input.classList.add('wrong');
      setTimeout(() => input.classList.remove('wrong'), 400);
    }
  };

  btnCheck.onclick = doCheck;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doCheck(); });

  btnGiveup.onclick = () => {
    if (answered) return;
    answered = true;
    btnCheck.disabled = btnGiveup.disabled = true;
    hintDisp.textContent = word.word;
    hintDisp.style.display = '';
    hintDisp.style.background = 'var(--warning-pale)';
    hintDisp.style.color = 'var(--warning)';
    _reviewSession.results[id] = 'failed';
    DB.addLog({ date: today(), wordId: id, type: 'spelling', result: 'failed' });
    const nextBtn = el('button', 'btn btn-gray btn-full', '下一個');
    nextBtn.style.marginTop = '12px';
    nextBtn.onclick = advance;
    view.appendChild(nextBtn);
  };

  setTimeout(() => { try { input.focus(); } catch(_) {} }, 180);
}

function renderReviewDone(view) {
  // 記錄 SRS 複習
  if (_reviewSession) {
    _reviewSession.words.forEach(id => {
      DB.recordReview(id, _reviewSession.results[id] === 'correct');
    });
    DB.logActivity('review');
  }

  const total   = _reviewSession?.words.length || 0;
  const correct = Object.values(_reviewSession?.results || {}).filter(r => r === 'correct').length;
  _reviewSession = null;

  view.innerHTML = '';
  const done = el('div', 'done-screen');
  done.innerHTML = `
    <div class="done-label">複習完成</div>
    <h2>今日複習結束</h2>
    <p class="subtitle">複習結果已記錄，下次間隔已更新</p>
    <div class="done-stats">
      <div class="done-stat-item"><div class="stat-val">${total}</div><div class="stat-key">複習單字</div></div>
      <div class="done-stat-item"><div class="stat-val">${correct}</div><div class="stat-key">答對</div></div>
      <div class="done-stat-item"><div class="stat-val">${total - correct}</div><div class="stat-key">需加強</div></div>
      <div class="done-stat-item"><div class="stat-val">${total ? Math.round(correct/total*100) : 0}%</div><div class="stat-key">正確率</div></div>
    </div>`;

  const btnHome = el('button', 'btn btn-primary btn-full', '回到學習首頁');
  btnHome.onclick = () => showTab('learning', true);
  done.appendChild(btnHome);

  const btnStats = el('button', 'btn btn-ghost btn-full', '查看學習統計');
  btnStats.style.marginTop = '8px';
  btnStats.onclick = () => showTab('stats');
  done.appendChild(btnStats);

  view.appendChild(done);
}

// ══════════════════════════════════════════════════════════
//  VOCABULARY VIEW
// ══════════════════════════════════════════════════════════

let _vocabFilter = 'all';
let _vocabGroup  = 'none'; // 'none' | 'day' | 'week' | 'month'
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

  // Filter chips (status)
  const filterRow = el('div', 'vocab-filter-row');
  [['all','全部'],['new','未熟'],['learning','學習中'],['mastered','精熟']].forEach(([k, label]) => {
    const chip = el('button', `filter-chip${_vocabFilter === k ? ' active' : ''}`, label);
    chip.onclick = () => {
      _vocabFilter = k;
      filterRow.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderWordList(listContainer);
    };
    filterRow.appendChild(chip);
  });
  view.appendChild(filterRow);

  // Group chips (time grouping)
  const groupRow = el('div', 'vocab-filter-row vocab-group-row');
  const groupLabel = el('span', 'group-row-label', '分組：');
  groupRow.appendChild(groupLabel);
  [['none','不分組'],['day','分天'],['week','分週'],['month','分月']].forEach(([k, label]) => {
    const chip = el('button', `filter-chip${_vocabGroup === k ? ' active' : ''}`, label);
    chip.onclick = () => {
      _vocabGroup = k;
      groupRow.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderWordList(listContainer);
    };
    groupRow.appendChild(chip);
  });
  view.appendChild(groupRow);

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

  if (_vocabGroup === 'none') {
    filtered.forEach(word => renderWordCard(container, word));
  } else {
    // Group words by day / week / month
    const groupMap = new Map();
    filtered.forEach(w => {
      const key   = _groupKey(w.addedAt);
      const label = _groupLabel(w.addedAt);
      if (!groupMap.has(key)) groupMap.set(key, { label, words: [] });
      groupMap.get(key).words.push(w);
    });
    // Sort groups newest-first
    [...groupMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .forEach(([, group]) => {
        const hdr = el('div', 'vocab-group-header');
        hdr.innerHTML = `<span class="vocab-group-label">${group.label}</span><span class="vocab-group-count">${group.words.length} 個</span>`;
        container.appendChild(hdr);
        group.words.forEach(word => renderWordCard(container, word));
      });
  }
}

function _groupKey(dateStr) {
  if (!dateStr) return 'unknown';
  if (_vocabGroup === 'day') return dateStr;
  if (_vocabGroup === 'week') {
    const d = new Date(dateStr + 'T00:00:00');
    const year = d.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }
  if (_vocabGroup === 'month') return dateStr.slice(0, 7);
  return 'unknown';
}

function _groupLabel(dateStr) {
  if (!dateStr) return '未知日期';
  if (_vocabGroup === 'day') return formatDateFull(dateStr);
  if (_vocabGroup === 'week') {
    const d = new Date(dateStr + 'T00:00:00');
    const year = d.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return `${year} 年  第 ${week} 週`;
  }
  if (_vocabGroup === 'month') {
    const [y, m] = dateStr.slice(0, 7).split('-');
    return `${y} 年 ${parseInt(m)} 月`;
  }
  return dateStr;
}

function renderWordCard(container, word) {
  const card = el('div', 'word-card');
  card.innerHTML = `
    <div class="word-card-header">
      <span class="word-card-en">${word.word}</span>
      <span class="badge badge-${word.pos}">${POS_LABELS[word.pos] || word.pos}</span>
      <span class="badge badge-${word.status}">${STATUS_LABELS[word.status]}</span>
    </div>
    <div class="word-card-zh">${word.meaning}</div>
    ${word.example ? `<div class="word-card-example">${word.example}</div>` : ''}`;

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
    document.querySelectorAll('.word-card').forEach(c => {
      c.classList.remove('expanded');
      const ar = c.querySelector('.word-card-actions');
      if (ar) ar.style.display = 'none';
    });
    if (!was) { card.classList.add('expanded'); actRow.style.display = 'flex'; }
  };

  container.appendChild(card);
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
      DB.addWord({ id: genId(), word, pos: selectedPos, meaning, example: exInput.value.trim(), status: 'new', addedAt: today(), lastReviewedAt: null, reviewCount: 0, nextReviewDate: null });
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
  header.innerHTML = `<h1>學習打卡</h1><span class="text-muted">${formatDateFull(today())}</span>`;
  view.appendChild(header);

  const goal     = DB.getGoal();
  const activity = DB.getActivity();
  const todayAct = activity[today()] || { new: 0, review: 0 };
  const todayNewCount = DB.getWords().filter(w => w.addedAt === today()).length;
  const dueTodayCount = DB.getDueWords().length; // 今日到期的複習數

  // ── 今日進度 ────────────────────────────────────────
  const progCard = el('div', 'card');
  progCard.appendChild(el('div', 'section-title', '今日進度'));

  // 新單字進度條
  const newPct = Math.min(100, Math.round(todayNewCount / goal * 100));
  const newRow = el('div', 'progress-row');
  newRow.innerHTML = `
    <div class="progress-row-label">新增單字</div>
    <div class="progress-row-bar">
      <div class="progress-bar-wrap" style="margin:0">
        <div class="progress-bar-fill" style="width:${newPct}%;background:var(--blue)"></div>
      </div>
    </div>
    <div class="progress-row-val">${todayNewCount} / ${goal}</div>`;
  progCard.appendChild(newRow);

  // 複習進度
  const reviewedToday = todayAct.review > 0;
  const reviewRow = el('div', 'progress-row');
  reviewRow.innerHTML = `
    <div class="progress-row-label">到期複習</div>
    <div class="progress-row-bar">
      <div class="progress-bar-wrap" style="margin:0">
        <div class="progress-bar-fill" style="width:${reviewedToday ? 100 : 0}%;background:var(--green)"></div>
      </div>
    </div>
    <div class="progress-row-val">${reviewedToday ? '已完成' : dueTodayCount > 0 ? `${dueTodayCount} 個待複習` : '無'}</div>`;
  progCard.appendChild(reviewRow);

  // 每日目標設定
  const goalRow = el('div');
  goalRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--gray)';
  goalRow.innerHTML = `<span class="text-muted" style="font-size:13px;flex:1">每日目標：<strong>${goal}</strong> 個新單字</span>`;
  const btnGoal = el('button', 'btn btn-ghost', '調整');
  btnGoal.style.cssText = 'padding:4px 12px;font-size:12px;flex-shrink:0';
  btnGoal.onclick = () => openGoalModal(view);
  goalRow.appendChild(btnGoal);
  progCard.appendChild(goalRow);

  view.appendChild(progCard);

  // ── 連續天數 ────────────────────────────────────────
  const reviewStreak = calcReviewStreak();
  const goalStreak   = calcGoalStreak();

  const streakCard = el('div', 'card');
  streakCard.appendChild(el('div', 'section-title', '連續記錄'));
  streakCard.innerHTML += `
    <div class="streak-grid">
      <div class="streak-item">
        <div class="streak-num">${reviewStreak}</div>
        <div class="streak-label">連續複習天數</div>
        <div class="streak-sub">每天有學習或複習</div>
      </div>
      <div class="streak-item">
        <div class="streak-num">${goalStreak}</div>
        <div class="streak-label">達標天數</div>
        <div class="streak-sub">新增 ≥ ${goal} 個單字</div>
      </div>
    </div>`;
  view.appendChild(streakCard);
}

// 每日目標調整 modal
function openGoalModal(view) {
  const overlay = el('div', 'modal-overlay');
  const sheet   = el('div', 'modal-sheet');
  sheet.innerHTML = '<div class="modal-handle"></div><div class="modal-title">調整每日目標</div>';

  const current = DB.getGoal();
  let val = current;

  const counter = el('div', 'minutes-input-wrap');
  const btnM = el('button', 'minutes-btn', '−');
  const disp  = el('div', 'minutes-display', `${val} 個`);
  const btnP  = el('button', 'minutes-btn', '+');
  btnM.onclick = () => { val = Math.max(1, val - 1);  disp.textContent = `${val} 個`; };
  btnP.onclick = () => { val = Math.min(50, val + 1); disp.textContent = `${val} 個`; };
  counter.append(btnM, disp, btnP);
  sheet.appendChild(counter);

  const note = el('div', 'backup-note', '設定每天要新增的單字目標數');
  sheet.appendChild(note);

  const btnSave = el('button', 'btn btn-primary btn-full', '儲存');
  btnSave.style.marginTop = '12px';
  btnSave.onclick = () => {
    DB.saveGoal(val);
    overlay.remove();
    showTab('checkin', true);
  };
  sheet.appendChild(btnSave);

  const btnCancel = el('button', 'btn btn-gray btn-full', '取消');
  btnCancel.style.marginTop = '8px';
  btnCancel.onclick = () => overlay.remove();
  sheet.appendChild(btnCancel);

  overlay.appendChild(sheet);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

// 連續複習天數（有 new 或 review activity 即算）
function calcReviewStreak() {
  const activity = DB.getActivity();
  const checkFn = d => { const a = activity[d]; return !!(a && (a.new > 0 || a.review > 0)); };
  let streak = 0;
  for (let i = 1; i <= 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if (checkFn(d.toISOString().slice(0, 10))) streak++; else break;
  }
  if (checkFn(today())) streak++;
  return streak;
}

// 達標天數（當天新增單字 >= 目標）
function calcGoalStreak() {
  const goal = DB.getGoal();
  const words = DB.getWords();
  const byDay = {};
  words.forEach(w => { if (w.addedAt) byDay[w.addedAt] = (byDay[w.addedAt] || 0) + 1; });
  const checkFn = d => (byDay[d] || 0) >= goal;
  let streak = 0;
  for (let i = 1; i <= 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if (checkFn(d.toISOString().slice(0, 10))) streak++; else break;
  }
  if (checkFn(today())) streak++;
  return streak;
}

function calcStreak() { return calcReviewStreak(); } // 保留舊函數給 stats 用

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

  const btnExport = el('button', 'btn btn-primary btn-full', '匯出備份 JSON');
  btnExport.onclick = exportData;
  backupCard.appendChild(btnExport);

  const impRow = el('div');
  impRow.style.marginTop = '8px';
  const btnImport = el('button', 'btn btn-ghost btn-full', '匯入備份 JSON');
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
    sec6.appendChild(el('h3', null, '跨裝置同步'));
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
    const btnNow = el('button', 'btn btn-primary btn-full', '立即同步至雲端');
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
    const btnSwitch = el('button', 'btn btn-ghost btn-full', '輸入其他裝置的同步碼');
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
