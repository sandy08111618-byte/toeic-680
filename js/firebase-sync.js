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
        activity:    JSON.parse(localStorage.getItem('toeic_activity') || '{}'),
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

  // ── 合併輔助：單字清單取聯集，以較進步的版本優先 ────────
  function _mergeWords(local, cloud) {
    const map = new Map();
    // 先載入雲端
    (cloud || []).forEach(w => map.set(w.id, w));
    // 再用本機覆蓋：若同一個 id，保留進度較多的那個
    (local || []).forEach(w => {
      const existing = map.get(w.id);
      if (!existing) {
        map.set(w.id, w); // 只在本機有 → 保留
      } else {
        const localScore = (w.reviewCount || 0) * 1e12 +
          (w.lastReviewedAt ? new Date(w.lastReviewedAt).getTime() : 0);
        const cloudScore = (existing.reviewCount || 0) * 1e12 +
          (existing.lastReviewedAt ? new Date(existing.lastReviewedAt).getTime() : 0);
        if (localScore >= cloudScore) map.set(w.id, w);
      }
    });
    return Array.from(map.values());
  }

  // 合併打卡紀錄（以 date 為 key，本機優先）
  function _mergeCheckins(local, cloud) {
    const map = new Map();
    (cloud || []).forEach(c => map.set(c.date, c));
    (local || []).forEach(c => map.set(c.date, c)); // 本機蓋過雲端
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }

  // 合併學習紀錄（以 date 為 key，取較完整的）
  function _mergeLogs(local, cloud) {
    const map = new Map();
    (cloud || []).forEach(l => map.set(l.date + (l.startedAt || ''), l));
    (local || []).forEach(l => map.set(l.date + (l.startedAt || ''), l));
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  // 合併每日活動（取較大值）
  function _mergeActivity(local, cloud) {
    const merged = Object.assign({}, cloud || {});
    Object.keys(local || {}).forEach(date => {
      if (!merged[date]) {
        merged[date] = local[date];
      } else {
        merged[date] = {
          new:    Math.max(merged[date].new    || 0, local[date].new    || 0),
          review: Math.max(merged[date].review || 0, local[date].review || 0),
        };
      }
    });
    return merged;
  }

  // ── 從雲端下載（智慧合併，不覆蓋本機資料）──────────────
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

      // 智慧合併：取本機與雲端的聯集，不直接覆蓋
      if (data.words) {
        const local = JSON.parse(localStorage.getItem('toeic_words') || '[]');
        const merged = _mergeWords(local, data.words);
        localStorage.setItem('toeic_words', JSON.stringify(merged));
      }
      if (data.checkins) {
        const local = JSON.parse(localStorage.getItem('toeic_checkins') || '[]');
        localStorage.setItem('toeic_checkins', JSON.stringify(_mergeCheckins(local, data.checkins)));
      }
      if (data.logs) {
        const local = JSON.parse(localStorage.getItem('toeic_logs') || '[]');
        localStorage.setItem('toeic_logs', JSON.stringify(_mergeLogs(local, data.logs)));
      }
      if (data.goal !== undefined && !localStorage.getItem('toeic_goal')) {
        localStorage.setItem('toeic_goal', JSON.stringify(data.goal));
      }
      if (data.activity) {
        const local = JSON.parse(localStorage.getItem('toeic_activity') || '{}');
        localStorage.setItem('toeic_activity', JSON.stringify(_mergeActivity(local, data.activity)));
      }

      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      console.log('[Sync] ↓ 下載成功，共', data.words?.length, '個雲端單字');

      // 合併後立刻上傳，確保雲端也有本機的新資料
      scheduleSync(1000);

      return data;
    } catch (e) {
      console.error('[Sync] 下載失敗:', e);
      return null;
    }
  }

  // ── 防抖自動同步（資料變更後 1 秒才真正上傳）────────────
  function scheduleSync(delayMs = 1000) {
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
