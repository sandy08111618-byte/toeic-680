// ═══════════════════════════════════════════════════════
//  Firebase Sync Module — 多益 680 練功表
//  跨裝置同步：使用「同步碼」綁定裝置，不需帳號登入
// ═══════════════════════════════════════════════════════

(function () {
  const FB_CONFIG = {
    apiKey:            "AIzaSyD-24vDdAKVSf1bGIGFJjH5jWc3rfzA1s4",
    authDomain:        "toeic-680.firebaseapp.com",
    projectId:         "toeic-680",
    storageBucket:     "toeic-680.firebasestorage.app",
    messagingSenderId: "755263530423",
    appId:             "1:755263530423:web:e42b5a863485de930bf432"
  };

  const SYNC_CODE_KEY = 'toeic_syncCode';
  const LAST_SYNC_KEY = 'toeic_lastSync';

  let _db          = null;
  let _syncTimer   = null;
  let _initialized = false;

  // ── 初始化 Firebase ───────────────────────────────────
  function init() {
    if (_initialized) return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
      _db = firebase.firestore();
      _initialized = true;
      console.log('[Sync] Firebase ready');
    } catch (e) {
      console.error('[Sync] Init failed:', e);
    }
  }

  // ── 同步碼管理 ────────────────────────────────────────
  function getSyncCode() {
    return localStorage.getItem(SYNC_CODE_KEY) || null;
  }

  function generateSyncCode() {
    const adj  = ['swift','brave','calm','wise','bold','kind','cool','soft','warm','pure'];
    const noun = ['tiger','panda','moon','star','wave','leaf','fire','snow','rain','rose'];
    const a = adj[Math.floor(Math.random() * adj.length)];
    const n = noun[Math.floor(Math.random() * noun.length)];
    const d = Math.floor(Math.random() * 9000) + 1000;
    return `${a}-${n}-${d}`;
  }

  function getOrCreateSyncCode() {
    let code = getSyncCode();
    if (!code) {
      code = generateSyncCode();
      localStorage.setItem(SYNC_CODE_KEY, code);
    }
    return code;
  }

  function setSyncCode(code) {
    const clean = code.trim().toLowerCase();
    localStorage.setItem(SYNC_CODE_KEY, clean);
    localStorage.removeItem(LAST_SYNC_KEY); // 重置，下次強制從雲端拉
    return clean;
  }

  // ── Firestore 文件參照 ────────────────────────────────
  function docRef(code) {
    return _db.collection('users').doc(code || getSyncCode());
  }

  // ── 上傳至雲端 ────────────────────────────────────────
  async function syncToCloud() {
    if (!_db) { init(); }
    if (!_db) return false;
    const code = getSyncCode();
    if (!code) return false;

    try {
      const payload = {
        words:       JSON.parse(localStorage.getItem('toeic_words')    || '[]'),
        checkins:    JSON.parse(localStorage.getItem('toeic_checkins') || '[]'),
        logs:        JSON.parse(localStorage.getItem('toeic_logs')     || '[]'),
        goal:        JSON.parse(localStorage.getItem('toeic_goal')     || '10'),
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
      };
      await docRef(code).set(payload);
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      console.log('[Sync] ↑ 上傳成功');
      return true;
    } catch (e) {
      console.error('[Sync] 上傳失敗:', e);
      return false;
    }
  }

  // ── 從雲端下載 ────────────────────────────────────────
  async function syncFromCloud(code) {
    if (!_db) { init(); }
    if (!_db) return null;
    const useCode = code || getSyncCode();
    if (!useCode) return null;

    try {
      const snap = await docRef(useCode).get();
      if (!snap.exists) {
        console.log('[Sync] 雲端沒有資料（此同步碼是第一次使用）');
        return 'empty';
      }
      const data = snap.data();
      if (data.words)              localStorage.setItem('toeic_words',    JSON.stringify(data.words));
      if (data.checkins)           localStorage.setItem('toeic_checkins', JSON.stringify(data.checkins));
      if (data.logs)               localStorage.setItem('toeic_logs',     JSON.stringify(data.logs));
      if (data.goal !== undefined) localStorage.setItem('toeic_goal',     JSON.stringify(data.goal));
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      console.log('[Sync] ↓ 下載成功，共', data.words?.length, '個單字');
      return data;
    } catch (e) {
      console.error('[Sync] 下載失敗:', e);
      return null;
    }
  }

  // ── 防抖自動同步（資料變更後 2 秒才真正上傳）────────────
  function scheduleSync(delayMs = 2000) {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(syncToCloud, delayMs);
  }

  // ── 上次同步時間（顯示用）────────────────────────────
  function getLastSyncTime() {
    const t = localStorage.getItem(LAST_SYNC_KEY);
    if (!t) return null;
    const d = new Date(t);
    return d.toLocaleString('zh-TW', {
      month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // ── 對外 API ─────────────────────────────────────────
  window.FirebaseSync = {
    init,
    getSyncCode,
    getOrCreateSyncCode,
    setSyncCode,
    syncToCloud,
    syncFromCloud,
    scheduleSync,
    getLastSyncTime,
  };
})();
