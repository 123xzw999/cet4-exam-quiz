/* ==========================================================================
   本地状态：答题记录 / 错题本 / 收藏 / 进度 / 主观题草稿（localStorage）
   ========================================================================== */
window.Store = (function () {
  var KEY = "cet4quiz.v2";
  var d = { answers: {}, wrong: {}, fav: {}, pos: {}, subj: {}, shown: {} };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        d.answers = o.answers || {};
        d.wrong = o.wrong || {};
        d.fav = o.fav || {};
        d.pos = o.pos || {};
        d.subj = o.subj || {};
        d.shown = o.shown || {};
      }
    } catch (e) { /* 隐私模式 / file:// 下忽略 */ }
  }

  var saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    }, 200);
  }

  return {
    load: load,
    all: function () { return d; },

    /* ---------- 答题 ---------- */
    answer: function (qid, choice, ok) {
      var prev = d.answers[qid];
      d.answers[qid] = { c: choice, ok: !!ok, t: Date.now(), n: (prev ? (prev.n || 1) : 0) + 1 };
      if (ok) delete d.wrong[qid]; else d.wrong[qid] = 1;
      save();
    },
    getAnswer: function (qid) { return d.answers[qid] || null; },

    /* ---------- 错题本 ---------- */
    wrongList: function () { return Object.keys(d.wrong); },
    wrongCount: function () { return Object.keys(d.wrong).length; },
    dropWrong: function (qid) { delete d.wrong[qid]; save(); },
    clearWrong: function () { d.wrong = {}; save(); },

    /* ---------- 收藏 ---------- */
    toggleFav: function (qid) {
      if (d.fav[qid]) delete d.fav[qid]; else d.fav[qid] = 1;
      save();
      return !!d.fav[qid];
    },
    isFav: function (qid) { return !!d.fav[qid]; },
    favList: function () { return Object.keys(d.fav); },
    favCount: function () { return Object.keys(d.fav).length; },
    clearFav: function () { d.fav = {}; save(); },

    /* ---------- 主观题草稿 ---------- */
    getSubjText: function (pid, kind) { return (d.subj[pid] || {})[kind] || ""; },
    setSubjText: function (pid, kind, text) {
      d.subj[pid] = d.subj[pid] || {};
      d.subj[pid][kind] = text;
      save();
    },
    getSubjShown: function (pid) { return !!d.shown[pid]; },
    setSubjShown: function (pid) { d.shown[pid] = 1; save(); },

    /* ---------- 进度 ---------- */
    setPos: function (k, v) { d.pos[k] = v; save(); },
    getPos: function (k) { return d.pos[k]; },

    /* ---------- 统计 ---------- */
    stats: function () {
      var done = 0, right = 0;
      for (var k in d.answers) { done++; if (d.answers[k].ok) right++; }
      return { done: done, right: right, rate: done ? Math.round(right / done * 100) : 0 };
    },
    paperProgress: function (pid, nos) {
      var done = 0, right = 0;
      for (var i = 0; i < nos.length; i++) {
        var a = d.answers[pid + "#" + nos[i]];
        if (a) { done++; if (a.ok) right++; }
      }
      return { done: done, total: nos.length, right: right };
    },
    /* 跨多套卷统计（用于年份卡片） */
    nosProgress: function (pids, nos) {
      var done = 0, right = 0;
      for (var i = 0; i < pids.length; i++) {
        var pr = this.paperProgress(pids[i], nos);
        done += pr.done; right += pr.right;
      }
      return { done: done, total: nos.length, right: right };
    },

    resetAll: function () {
      d = { answers: {}, wrong: {}, fav: {}, pos: {}, subj: {}, shown: {} };
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
  };
})();
window.Store.load();
