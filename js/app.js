/* ==========================================================================
   四级真题刷题系统 —— 主逻辑
   登录 → 首页(年份/考期/套卷) → 整卷考试·听力·阅读·主观题 / 刷题
   ========================================================================== */
(function () {
  "use strict";

  var INDEX = window.__CET4_INDEX || [];
  var AUDIO = window.__CET4_AUDIO || {};
  window.__CET4_PAPERS = window.__CET4_PAPERS || {};
  var PAPERS = window.__CET4_PAPERS;
  var loading = {};
  var view = document.getElementById("view");

  var ACCOUNT = { user: "12345678", pass: "xiaoxiang888" };
  var SESSION_KEY = "cet4quiz.login";

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function partOf(no) {
    if (no <= 25) return "listening";
    if (no <= 35) return "cloze";
    if (no <= 45) return "matching";
    return "reading";
  }
  var PART_LABEL = { listening: "听力理解", cloze: "选词填空", matching: "长篇阅读（信息匹配）", reading: "仔细阅读" };
  var EXPLAIN_LABEL = {
    "定位": "原文定位", "信号": "信号提示", "替换": "同义替换", "排除": "干扰项排除",
    "判型": "题型判定", "拆句": "题干拆句", "选项": "选项分析",
    "锚点": "段落锚点", "改写": "同义改写", "辨邻": "邻近段辨析",
    "词性槽": "词性槽位", "依据": "锁定依据", "竞争词": "竞争词淘汰", "易错": "易错提醒"
  };
  var EXPLAIN_ORDER = ["判型", "拆句", "定位", "信号", "替换", "选项", "排除",
    "锚点", "改写", "辨邻", "词性槽", "依据", "竞争词", "易错"];

  function toast(msg) {
    var t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1700);
  }
  function meta(pid) {
    for (var i = 0; i < INDEX.length; i++) if (INDEX[i].id === pid) return INDEX[i];
    return null;
  }
  function qidOf(pid, no) { return pid + "#" + no; }

  /* 音频：本套无独立音频时，回退到它共用的那一套 */
  function audioFor(pid) {
    if (AUDIO[pid]) return AUDIO[pid];
    var m = meta(pid);
    if (m && m.share && AUDIO[m.share]) {
      var a = AUDIO[m.share];
      return {
        label: a.label, page: a.page, m3u8: a.m3u8, aid: a.aid, ok: a.ok,
        segs: a.segs, pieces: a.pieces || [], sharedFrom: m.share
      };
    }
    return null;
  }

  /* ---------------- 数据加载 ---------------- */
  function loadPaper(pid) {
    if (PAPERS[pid]) return Promise.resolve(PAPERS[pid]);
    if (loading[pid]) return loading[pid];
    loading[pid] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "data/papers/" + pid + ".js";
      s.onload = function () {
        PAPERS[pid] = window.__CET4_PAPERS[pid];
        if (PAPERS[pid]) resolve(PAPERS[pid]); else reject(new Error("数据为空"));
      };
      s.onerror = function () { reject(new Error("无法加载 " + pid)); };
      document.head.appendChild(s);
    });
    return loading[pid];
  }
  function paperOf(pid) { return PAPERS[pid] || null; }

  /* ---------------- 状态 ---------------- */
  var S = {
    view: "home",
    year: null,
    pid: null,
    mode: null,           // full | listening | reading | subjective
    queue: [], qi: 0,
    cur: null, curPid: null,
    revealed: false,
    submitted: false,
    secKey: null,         // 考试页原文当前分区
    struct: null,
    practice: { mode: "sequence", arg: null },
    startAt: 0
  };

  /* ================================================================
     登录
     ================================================================ */
  function isLogged() {
    try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch (e) { return false; }
  }
  function setLogged(v) {
    try { v ? sessionStorage.setItem(SESSION_KEY, "1") : sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function initLogin() {
    $("loginUser").value = ACCOUNT.user;     // 打开即显示用户名
    $("loginPass").value = "";               // 密码留空，由用户输入
    $("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var u = $("loginUser").value.trim();
      var p = $("loginPass").value;
      if (u === ACCOUNT.user && p === ACCOUNT.pass) {
        setLogged(true);
        enterApp();
      } else {
        var err = $("loginErr");
        err.hidden = false;
        err.textContent = u !== ACCOUNT.user ? "用户名不正确" : "密码不正确，请重新输入";
        $("loginPass").focus();
      }
    });
    if (isLogged()) enterApp();
    else setTimeout(function () { $("loginPass").focus(); }, 60);
  }

  function enterApp() {
    $("login").hidden = true;
    $("app").hidden = false;
    document.body.classList.remove("logged-out");
    try {
      refreshBadges();
      renderHome();
    } catch (err) {
      $("view").innerHTML = '<div class="empty"><div class="ei">⚠️</div>' +
        '<p>页面初始化出错</p><p style="font-size:12.5px;color:#b6a7ae;margin-top:6px">' +
        esc(err.message) + "</p></div>";
      console.error(err);
    }
  }

  function logout() {
    setLogged(false);
    document.body.classList.add("logged-out");
    $("app").hidden = true;
    $("login").hidden = false;
    $("loginErr").hidden = true;
    $("loginUser").value = ACCOUNT.user;
    $("loginPass").value = "";
    setTimeout(function () { $("loginPass").focus(); }, 60);
  }

  /* ================================================================
     首页：年份 → 考期 → 套卷 × 模式
     ================================================================ */
  function years() {
    var seen = {}, out = [];
    INDEX.forEach(function (p) { if (!seen[p.year]) { seen[p.year] = 1; out.push(p.year); } });
    return out.sort();
  }

  function renderHome() {
    S.view = "home"; S.cur = null; S.pid = null;
    setNav("home");
    var st = Store.stats();
    var total = INDEX.reduce(function (n, p) { return n + p.count; }, 0);
    var audioN = Object.keys(AUDIO).length;

    var h = '<section class="hero">';
    h += '<h2>选择<em>考试年份</em></h2>';
    h += '<p class="sub">46 套真题按考期编排 · 每套可选「整卷考试 / 听力 / 阅读 / 主观题」四种模式' +
      ' · 27 套含在线听力原声（共用套自动跟随）</p>';
    h += '<div class="hero-stats">' +
      hs(total, "总题量") + hs(INDEX.length, "套真题") + hs(audioN, "套听力音频") +
      hs(st.done, "已作答") + hs(st.rate + "%", "正确率") +
      '</div></section>';

    h += '<div class="years">';
    years().forEach(function (y) {
      var ps = INDEX.filter(function (p) { return p.year === y; });
      var nos = []; ps.forEach(function (p) { nos = nos.concat(p.nos); });
      var pr = Store.nosProgress(ps.map(function (p) { return p.id; }), nos);
      var pct = Math.round(pr.done / pr.total * 100);
      var hasAudio = ps.some(function (p) { return !!audioFor(p.id); });
      h += '<button class="year' + (S.year === y ? " on" : "") + '" data-year="' + y + '">' +
        '<div class="yn">' + y + '</div>' +
        '<div class="yl">' + ps.length + ' 套 · ' + pr.total + ' 题' +
        (hasAudio ? " · 含听力音频" : "") + '</div>' +
        '<div class="yb"><i style="width:' + pct + '%"></i></div>' +
        '<div class="yp">已做 ' + pr.done + ' / ' + pr.total + ' · 正确率 ' +
        (pr.done ? Math.round(pr.right / pr.done * 100) : 0) + '%</div></button>';
    });
    h += '</div>';

    if (S.year) {
      var yearPapers = INDEX.filter(function (p) { return p.year === S.year; });
      ["上半年", "下半年"].forEach(function (half) {
        var list = yearPapers.filter(function (p) { return p.half === half; });
        if (!list.length) return;
        var periods = [];
        list.forEach(function (p) { if (periods.indexOf(p.period) < 0) periods.push(p.period); });
        periods.forEach(function (per) {
          var ps = list.filter(function (p) { return p.period === per; });
          h += '<section class="period">';
          h += '<div class="period-head"><h3>' + esc(per) + '</h3>' +
            '<span class="ptag">' + half + '</span>' +
            '<span class="pnum">' + ps.length + ' 套 · ' + ps[0].label + '</span></div>';
          ps.forEach(function (p) {
            var pr = Store.paperProgress(p.id, p.nos);
            var pct = Math.round(pr.done / pr.total * 100);
            var hasL = p.nos.indexOf(1) >= 0;
            var hasR = p.nos.some(function (n) { return n >= 26; });
            var au = audioFor(p.id);
            var audioTag = au ? (" · 🎧 " + (au.sharedFrom ? "共用第 " + au.sharedFrom.split("-").pop() + " 套音频" : "有听力音频")) : "";
            h += '<div class="paper-row">';
            h += '<div class="pinfo2"><b>' + esc(p.label) + ' ' + esc(p.set) + '</b>' +
              '<div class="pm2">' + p.count + ' 题' + audioTag +
              ' · 已做 ' + pr.done + ' · 正确率 ' + (pr.done ? Math.round(pr.right / pr.done * 100) : 0) + '%</div>' +
              '<div class="pbar3"><i style="width:' + pct + '%"></i></div></div>';
            h += '<div class="mode-btns">';
            h += mb(p.id, "full", "📄", "整卷考试");
            if (hasL) h += mb(p.id, "listening", "🎧", "听力部分");
            if (hasR) h += mb(p.id, "reading", "📖", "阅读部分");
            h += mb(p.id, "subjective", "✍️", "主观题部分");
            h += '</div></div>';
          });
          h += '</section>';
        });
      });
    } else {
      h += '<div class="empty" style="margin-top:16px"><div class="ei">👆</div>' +
        '<p>先选一个年份，下面会列出该年全部套卷与练习模式</p></div>';
    }

    h += '<div class="sec-title">刷题与统计<span class="line"></span></div>';
    h += '<div class="papers">' +
      '<div class="year" data-quick="sequence"><div class="yn" style="font-size:22px">顺序刷题</div>' +
      '<div class="yl">从 2020 年 7 月一路刷到 2026 年</div></div>' +
      '<div class="year" data-quick="random"><div class="yn" style="font-size:22px">随机练习</div>' +
      '<div class="yl">随机抽 100 题混合练习</div></div>' +
      '<div class="year" data-quick="wrong"><div class="yn" style="font-size:22px">错题本</div>' +
      '<div class="yl">做错的题自动收录</div></div>' +
      '<div class="year" data-quick="fav"><div class="yn" style="font-size:22px">我的收藏</div>' +
      '<div class="yl">随时回看标记过的题</div></div>' +
      '</div>';

    view.innerHTML = h;

    view.querySelectorAll("[data-year]").forEach(function (b) {
      b.onclick = function () {
        S.year = (S.year === this.dataset.year) ? null : this.dataset.year;
        renderHome();
        if (S.year) {
          var el = view.querySelector(".period");
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      };
    });
    view.querySelectorAll("[data-mode-btn]").forEach(function (b) {
      b.onclick = function () { openPaper(this.dataset.pid, this.dataset.modeBtn); };
    });
    view.querySelectorAll("[data-quick]").forEach(function (b) {
      b.onclick = function () { startPractice(this.dataset.quick, null, 0); };
    });
  }
  function hs(n, l) { return '<div class="hs"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
  function mb(pid, mode, icon, label) {
    return '<button data-pid="' + pid + '" data-mode-btn="' + mode + '"><span class="mi">' + icon +
      '</span><b>' + label + '</b></button>';
  }

  /* ================================================================
     打开某套卷的某个模式
     ================================================================ */
  function openPaper(pid, mode) {
    S.pid = pid; S.mode = mode; S.submitted = false; S.revealed = false;
    S.startAt = Date.now();
    view.innerHTML = '<div class="loading">正在载入 ' + esc(pid) + ' …</div>';
    loadPaper(pid).then(function () {
      if (mode === "subjective") renderSubjective();
      else renderExam();
    }).catch(function (e) {
      view.innerHTML = '<div class="empty"><div class="ei">⚠️</div><p>题目数据加载失败</p>' +
        '<p style="font-size:12.5px;color:#b6a7ae;margin-top:6px">' + esc(e.message) + '</p></div>';
    });
  }

  function modeNos(p, mode) {
    if (mode === "listening") return p.nos.filter(function (n) { return n <= 25; });
    if (mode === "reading") return p.nos.filter(function (n) { return n >= 26; });
    return p.nos.slice();
  }

  /* ---------------- 试卷结构（Part / Section） ---------------- */
  var DIRECTIONS = {
    LA: "In this section, you will hear three news reports. At the end of each news report, you will hear two or three questions. Both the news report and the questions will be spoken only once. After you hear a question, you must choose the best answer from the four choices marked A), B), C) and D).",
    LB: "In this section, you will hear two long conversations. At the end of each conversation, you will hear four questions. Both the conversation and the questions will be spoken only once. After you hear a question, you must choose the best answer from the four choices marked A), B), C) and D).",
    LC: "In this section, you will hear three passages. At the end of each passage, you will hear three or four questions. Both the passage and the questions will be spoken only once. After you hear a question, you must choose the best answer from the four choices marked A), B), C) and D).",
    RA: "In this section, there is a passage with ten blanks. You are required to select one word for each blank from a list of choices given in a word bank following the passage. Read the passage through carefully before making your choices. Each choice in the bank is identified by a letter. You may not use any of the words in the bank more than once.",
    RB: "In this section, you are going to read a passage with ten statements attached to it. Each statement contains information given in one of the paragraphs. Identify the paragraph from which the information is derived. You may choose a paragraph more than once. Each paragraph is marked with a letter.",
    RC: "There are 2 passages in this section. Each passage is followed by some questions or unfinished statements. For each of them there are four choices marked A), B), C) and D). You should decide on the best choice."
  };
  /* 四级固定题号分布：
     听力  Section A 新闻报道 1-7 / Section B 长对话 8-15 / Section C 听力篇章 16-25
     阅读  Section A 选词填空 26-35 / Section B 长篇阅读 36-45 / Section C 仔细阅读 46-50、51-55 */
  var STRUCT = [
    { part: "II", en: "Listening Comprehension", zh: "听力理解", from: 1, to: 25,
      secs: [
        { key: "LA", letter: "A", zh: "新闻报道", dir: DIRECTIONS.LA, from: 1, to: 7 },
        { key: "LB", letter: "B", zh: "长对话", dir: DIRECTIONS.LB, from: 8, to: 15 },
        { key: "LC", letter: "C", zh: "听力篇章", dir: DIRECTIONS.LC, from: 16, to: 25 }
      ] },
    { part: "III", en: "Reading Comprehension", zh: "阅读理解", from: 26, to: 55,
      secs: [
        { key: "RA", letter: "A", zh: "选词填空", dir: DIRECTIONS.RA, from: 26, to: 35 },
        { key: "RB", letter: "B", zh: "长篇阅读（信息匹配）", dir: DIRECTIONS.RB, from: 36, to: 45 },
        { key: "RC1", letter: "C", tag: "(1)", zh: "仔细阅读 · 第一篇", dir: DIRECTIONS.RC, from: 46, to: 50 },
        { key: "RC2", letter: "C", tag: "(2)", zh: "仔细阅读 · 第二篇", dir: DIRECTIONS.RC, from: 51, to: 55 }
      ] }
  ];

  /* 按当前模式过滤出实际要考的 Part/Section */
  function examStructure(p, nos) {
    var out = [];
    STRUCT.forEach(function (part) {
      var secs = [];
      part.secs.forEach(function (sc) {
        var list = nos.filter(function (n) { return n >= sc.from && n <= sc.to; });
        if (!list.length) return;
        var q = p.questions.filter(function (x) { return list.indexOf(x.no) >= 0; })[0];
        secs.push({
          key: sc.key, letter: sc.letter, tag: sc.tag || "", zh: sc.zh, dir: sc.dir,
          nos: list, part: part.part, partEn: part.en, partZh: part.zh,
          passage: q ? (q.passage || (p.passages && q.pref && p.passages[q.pref]) || "") : ""
        });
      });
      if (secs.length) out.push({ part: part.part, en: part.en, zh: part.zh, secs: secs });
    });
    return out;
  }
  function flatSections(struct) {
    var out = [];
    struct.forEach(function (p) { p.secs.forEach(function (s) { out.push(s); }); });
    return out;
  }
  function sectionByNo(struct, no) {
    var all = flatSections(struct);
    for (var i = 0; i < all.length; i++) if (all[i].nos.indexOf(no) >= 0) return all[i];
    return all[0] || null;
  }

  /* ================================================================
     考试页（整卷 / 听力 / 阅读）
     ================================================================ */
  function renderExam() {
    var p = paperOf(S.pid), m = meta(S.pid);
    var nos = modeNos(m, S.mode);
    S.queue = nos.map(function (n) { return { pid: S.pid, no: n }; });
    var struct = examStructure(p, nos);
    S.struct = struct;
    var all = flatSections(struct);
    S.secKey = all.length ? all[0].key : null;
    S.view = "exam";
    setNav(null);

    var modeName = { full: "整卷考试", listening: "听力部分", reading: "阅读部分" }[S.mode];
    var hasAudio = !!audioFor(S.pid) && nos.indexOf(1) >= 0;

    var h = '<div class="exam">';
    h += '<div class="exam-head">' +
      '<button class="back" id="backHome">←</button>' +
      '<div class="etitle">' + esc(m.label) + " " + esc(m.set) +
      '<small>' + modeName + ' · ' + nos.length + ' 题</small></div>' +
      '<div class="egrow"><div class="einfo"><span id="examProgress"></span>' +
      '<span class="timer" id="examTimer">00:00</span></div>' +
      '<div class="pbar2"><i id="examBar" style="width:0%"></i></div></div>' +
      '<div class="eact"><button class="btn sm ghost" id="sheetBtn">答题卡</button>' +
      '<button class="btn sm primary" id="submitBtn">提交试卷</button></div></div>';

    /* 单栏真卷流：Part → Section → Directions → 原文 → 题目 */
    h += '<div class="paper-flow"><div id="qflow"></div></div>';
    h += '<div id="scoreBox"></div></div>';
    view.innerHTML = h;

    $("backHome").onclick = function () { renderHome(); };
    $("sheetBtn").onclick = openSheet;
    $("submitBtn").onclick = submitExam;
    $("qflow").addEventListener("click", onQListClick);

    renderQFlow(struct, hasAudio);
    bindPassageToggle();
    if (hasAudio) bindAudio(S.pid);
    updateExamProgress();
    startTimer();
  }

  /* 连续排布整卷：Part → Section → Directions → 原文 → 题目（与真卷一致） */
  function renderQFlow(struct, hasAudio) {
    var p = paperOf(S.pid), h = "";
    struct.forEach(function (part) {
      h += '<h2 class="part-h"><span class="part-no">Part ' + part.part + '</span>' +
        '<span class="part-en">' + esc(part.en) + '</span>' +
        '<span class="part-zh">' + esc(part.zh) + '</span></h2>';
      if (part.part === "II" && hasAudio) h += audioBox(S.pid);
      part.secs.forEach(function (sec) {
        h += '<h3 class="sec-h" id="sec-' + sec.key + '" data-key="' + sec.key + '">' +
          '<span class="sec-no">Section ' + sec.letter + (sec.tag ? " " + sec.tag : "") + '</span>' +
          '<span class="sec-zh">' + esc(sec.zh) + '</span>' +
          '<span class="sec-range">第 ' + sec.nos[0] + "–" + sec.nos[sec.nos.length - 1] + ' 题</span></h3>';
        h += '<p class="sec-dir"><b>Directions:</b> ' + esc(sec.dir) + '</p>';
        /* 原文：直接排在题目之前，和真卷一样 */
        if (sec.passage) {
          h += '<div class="passage-block" id="pass-' + sec.key + '">' +
            '<div class="pb-head">📖 阅读原文' +
            '<span class="pb-hint">' + esc(sec.zh) + ' · 可折叠</span></div>' +
            '<div class="pb-body">' + passageHTML(sec.passage, sec.key) + '</div></div>';
        }
        sec.nos.forEach(function (no) {
          var q = findQ(p, no);
          if (q) h += qItemHTML(q);
        });
      });
    });
    $("qflow").innerHTML = h;
  }

  /* 原文块折叠 */
  function bindPassageToggle() {
    document.querySelectorAll(".pb-head").forEach(function (hd) {
      hd.onclick = function () {
        this.parentNode.classList.toggle("collapsed");
      };
    });
  }

  function findQ(p, no) {
    for (var i = 0; i < p.questions.length; i++) if (p.questions[i].no === no) return p.questions[i];
    return null;
  }

  /* ---------------- 听力播放器 ---------------- */
  function audioBox(pid) {
    var a = audioFor(pid);
    if (!a) return "";
    var h = '<div class="audio-box"><div class="atitle">🎧 听力原声' +
      '<span class="live">链接已验证可用</span></div>';
    if (a.sharedFrom) {
      var sm = meta(a.sharedFrom);
      h += '<div class="audio-fallback" style="margin:0 0 9px">本套听力与「' +
        esc((sm ? sm.label + " " + sm.set : a.sharedFrom)) + '」共用同一音频</div>';
    }
    h += '<audio id="audioEl" controls preload="none"></audio>';
    if (a.pieces && a.pieces.length) {
      h += '<div class="seg-list" id="segList">' +
        a.pieces.map(function (x) {
          return '<button data-seek="' + x.start + '" title="' + esc(x.label) + '">' +
            esc(x.label.replace(/\s*·\s*/g, " ")) + " " + fmtTime(x.start) + '</button>';
        }).join("") +
        '</div>';
    }
    h += '<div class="audio-fallback">若播放器不可用，可' +
      '<a href="' + esc(a.page) + '" target="_blank" rel="noopener">在来源页收听 ↗</a></div></div>';
    return h;
  }
  function fmtTime(t) {
    t = Math.floor(t);
    return ("0" + Math.floor(t / 60)).slice(-2) + ":" + ("0" + (t % 60)).slice(-2);
  }

  /* hls.js 按需加载：多 CDN 依次兜底，加载失败也不影响页面其它功能 */
  var HLS_URLS = [
    "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js",
    "https://unpkg.com/hls.js@1.5.17/dist/hls.min.js",
    "https://cdn.bootcdn.net/ajax/libs/hls.js/1.5.17/hls.min.js",
    "https://lib.baomitu.com/hls.js/1.5.17/hls.min.js"
  ];
  var hlsWaiters = null;
  function ensureHls(cb) {
    if (window.Hls && window.Hls.isSupported && window.Hls.isSupported()) return cb(true);
    if (hlsWaiters) { hlsWaiters.push(cb); return; }
    hlsWaiters = [cb];
    var i = 0, settled = false;
    function finish(ok) {
      if (settled) return;
      settled = true;
      var list = hlsWaiters; hlsWaiters = null;
      list.forEach(function (f) { try { f(ok); } catch (e) {} });
    }
    (function next() {
      if (i >= HLS_URLS.length) return finish(false);
      var sc = document.createElement("script");
      sc.src = HLS_URLS[i++];
      sc.onload = function () { window.Hls ? finish(true) : next(); };
      sc.onerror = function () { next(); };
      document.head.appendChild(sc);
    })();
    setTimeout(function () { finish(!!window.Hls); }, 12000);
  }

  function bindAudio(pid) {
    var el = $("audioEl"), a = audioFor(pid);
    if (!el || !a) return;
    var segList = $("segList");
    if (segList) segList.onclick = function (e) {
      var b = e.target.closest("button[data-seek]");
      if (!b) return;
      try { el.currentTime = parseFloat(b.dataset.seek); el.play(); } catch (err) {}
      this.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
    };
    /* Safari / iOS 原生支持 HLS，直接给 src */
    if (el.canPlayType("application/vnd.apple.mpegurl")) { el.src = a.m3u8; return; }
    var hint = document.createElement("div");
    hint.className = "audio-fallback";
    hint.textContent = "正在加载播放组件…";
    el.parentNode.insertBefore(hint, el.nextSibling);
    ensureHls(function (ok) {
      if (ok && window.Hls.isSupported()) {
        hint.remove();
        var hls = new window.Hls({ lowLatencyMode: false });
        hls.loadSource(a.m3u8);
        hls.attachMedia(el);
      } else {
        hint.innerHTML = '⚠️ 播放组件加载失败（可能网络受限），请点下方来源页链接收听';
      }
    });
  }

  /* ---------------- 题目卡片 ---------------- */
  function qItemHTML(q) {
    var qid = qidOf(S.pid, q.no);
    var rec = Store.getAnswer(qid);
    var cls = "qitem";
    if (S.submitted) cls += rec ? (rec.ok ? " right" : " wrong") : "";
    var h = '<div class="' + cls + '" id="q-' + q.no + '" data-qno="' + q.no + '">';
    h += '<div class="qhead"><div class="qno">' + q.no + '</div>' +
      '<div class="qfrom">' + PART_LABEL[q.part] + (q.type ? " · " + esc(q.type) : "") + '</div>' +
      '<div class="spacer"></div>';
    if (S.submitted) {
      h += rec ? (rec.ok ? '<span class="mark ok">✓ 答对</span>' : '<span class="mark bad">✗ 答错</span>')
        : '<span class="mark bad" style="background:#f3f4f7;color:#6b7280">未作答</span>';
    }
    h += '</div>';
    if (q.stem) h += '<p class="qstem">' + esc(q.stem) + '</p>';
    if (q.stemZh) h += '<p class="qstem-zh">' + esc(q.stemZh) + '</p>';

    if (q.part === "cloze" && q.wordBank) {
      h += '<div class="bank" data-bank="' + q.no + '">' +
        Object.keys(q.wordBank).map(function (k) {
          return '<button data-k="' + k + '" data-no="' + q.no + '"><span class="bk">' + k + '</span>' +
            esc(q.wordBank[k]) + '</button>';
        }).join("") + '</div>';
    } else if (q.part === "matching") {
      var ps = q.paraOptions || "ABCDEFGHIJKLMNOP".split("");
      h += '<div class="para-pick" data-bank="' + q.no + '">' +
        ps.map(function (L) { return '<button data-k="' + L + '" data-no="' + q.no + '">' + L + '</button>'; }).join("") +
        '</div>';
    } else if (q.options && q.options.length === 4) {
      h += '<div class="opts" data-opts="' + q.no + '">' +
        "ABCD".split("").map(function (L, i) {
          return '<button class="opt" data-k="' + L + '" data-no="' + q.no + '"><span class="k">' + L +
            '</span><span class="t">' + esc(q.options[i]) + '</span></button>';
        }).join("") + '</div>';
    }
    h += '<div class="qresult" id="res-' + q.no + '"></div></div>';
    return h;
  }

  /* ---------------- 原文渲染 ---------------- */
  function passageHTML(t, key) {
    if (!t) return '<p class="panel-hint">本部分没有原文。</p>';
    var k = key || "";
    if (k === "cloze" || k === "RA") {
      return "<p>" + esc(t).replace(/\((\d{1,2})\)_{3,}\s*/g, '<span class="blank">($1) ______</span> ') + "</p>";
    }
    if (k === "matching" || k === "RB") {
      return t.split(/\n+(?=[A-P]\)\s)/).map(function (x) {
        return "<p>" + esc(x.trim()).replace(/^([A-P])\)/, "<b>$1)</b>") + "</p>";
      }).join("");
    }
    return t.split(/\n+(?=P\d+\s)/).map(function (x) {
      return "<p>" + esc(x.trim()).replace(/^(P\d+)\s/, "<b>$1</b> ") + "</p>";
    }).join("");
  }

  /* ---------------- 答题交互 ---------------- */
  function onQListClick(e) {
    var b = e.target.closest("button[data-k]");
    if (!b) return;
    var no = parseInt(b.dataset.no, 10);
    if (S.submitted) return;                       // 交卷后不再改答案
    pickAnswer(no, b.dataset.k);
  }

  function pickAnswer(no, k) {
    var p = paperOf(S.pid), q = findQ(p, no);
    if (!q) return;
    var ok = (k === q.answer);
    Store.answer(qidOf(S.pid, no), k, ok);
    paintQuestion(no);
    updateExamProgress();
    refreshBadges();
  }

  function paintQuestion(no) {
    var p = paperOf(S.pid), q = findQ(p, no);
    if (!q) return;
    var rec = Store.getAnswer(qidOf(S.pid, no));
    document.querySelectorAll('#q-' + no + ' button[data-k]').forEach(function (n) {
      n.classList.remove("right", "wrong", "picked");
      var k = n.dataset.k;
      if (S.submitted || S.revealed) {
        n.disabled = true;
        if (k === q.answer) n.classList.add("right");
        else if (rec && rec.c === k) n.classList.add("wrong");
      } else if (rec && rec.c === k) {
        n.classList.add("picked");
      }
    });
    var box = $("res-" + no);
    if (box) box.innerHTML = (S.submitted || S.revealed) ? resultHTML(q, rec) : "";
    var item = $("q-" + no);
    if (item) {
      item.classList.remove("right", "wrong");
      if (S.submitted && rec) item.classList.add(rec.ok ? "right" : "wrong");
    }
  }

  function resultHTML(q, rec) {
    var h = "";
    if (rec) {
      h += '<div class="verdict ' + (rec.ok ? "ok" : "bad") + '">' + (rec.ok ? "✓ 回答正确" : "✕ 回答错误") +
        '<span class="vv">你的答案：' + esc(rec.c) + '　正确答案：' + esc(q.answer) +
        (q.answerText && q.answerText !== q.answer ? "（" + esc(q.answerText) + "）" : "") + '</span></div>';
    } else {
      h += '<div class="verdict" style="background:#fff8fb;color:#c0245f;border:1px solid #f7d3e2">' +
        '正确答案：' + esc(q.answer) +
        (q.answerText && q.answerText !== q.answer ? "（" + esc(q.answerText) + "）" : "") +
        '<span class="vv">本题未作答</span></div>';
    }
    var ex = q.explain || {};
    var keys = EXPLAIN_ORDER.filter(function (k) { return ex[k]; });
    if (!keys.length) keys = Object.keys(ex).filter(function (k) { return ex[k]; });
    if (keys.length) {
      h += '<div class="explain"><h4>逐题解析</h4>';
      keys.forEach(function (k) {
        var body = esc(ex[k]).replace(/([A-Za-z][A-Za-z\s,'\-]{6,}?)\s*↔/g, "<em>$1</em> ↔");
        h += '<div class="ex-block"><div class="ex-h">' + (EXPLAIN_LABEL[k] || k) + '</div>' +
          '<div class="ex-b">' + body + '</div></div>';
      });
      h += '</div>';
    }
    return h;
  }

  function updateExamProgress() {
    var done = 0;
    S.queue.forEach(function (x) { if (Store.getAnswer(qidOf(x.pid, x.no))) done++; });
    var el = $("examProgress");
    if (el) el.innerHTML = '已答 <b>' + done + '</b> / ' + S.queue.length + ' 题';
    var bar = $("examBar");
    if (bar) bar.style.width = Math.round(done / S.queue.length * 100) + "%";
  }

  /* ---------------- 计时 ---------------- */
  var timerId = null;
  function startTimer() {
    if (timerId) clearInterval(timerId);
    var t0 = S.startAt;
    function tick() {
      var el = $("examTimer");
      if (!el) { clearInterval(timerId); timerId = null; return; }
      var s = Math.floor((Date.now() - t0) / 1000);
      el.textContent = ("0" + Math.floor(s / 60)).slice(-2) + ":" + ("0" + (s % 60)).slice(-2);
    }
    tick();
    timerId = setInterval(tick, 1000);
  }

  /* ---------------- 提交判分 ---------------- */
  function submitExam() {
    var unanswered = 0;
    S.queue.forEach(function (x) { if (!Store.getAnswer(qidOf(x.pid, x.no))) unanswered++; });
    if (unanswered && !confirm("还有 " + unanswered + " 题未作答，确定提交吗？")) return;
    S.submitted = true;
    if (timerId) { clearInterval(timerId); timerId = null; }

    var p = paperOf(S.pid), right = 0, wrong = 0, blank = 0;
    var byPart = {};
    p.questions.forEach(function (q) {
      if (!S.queue.some(function (x) { return x.no === q.no; })) return;
      var rec = Store.getAnswer(qidOf(S.pid, q.no));
      var key = q.part;
      byPart[key] = byPart[key] || { r: 0, w: 0, b: 0, n: 0 };
      byPart[key].n++;
      if (!rec) { blank++; byPart[key].b++; }
      else if (rec.ok) { right++; byPart[key].r++; }
      else { wrong++; byPart[key].w++; }
    });

    // 重绘整卷（带对错与解析）
    renderQFlow(S.struct, !!audioFor(S.pid) && S.queue.some(function (x) { return x.no === 1; }));
    bindPassageToggle();
    S.queue.forEach(function (x) { paintQuestion(x.no); });   // 每题重新着色并展开解析

    var total = S.queue.length;
    var rate = Math.round(right / total * 100);
    var objScore = Math.round(right / total * 497.5);
    var h = '<div class="score" id="scoreBoxInner">';
    h += '<h3>📊 成绩报告 · ' + esc(meta(S.pid).label + " " + meta(S.pid).set) + '</h3>';
    h += '<div class="score-grid">' +
      sg(right, "答对", "ok") + sg(wrong, "答错", "bad") + sg(blank, "未作答", "") +
      sg(rate + "%", "正确率", "") + sg(objScore + " 分", "客观题折算（满分 497.5）", "") +
      '</div>';
    h += '<div class="score-bar"><i class="r" style="width:' + (right / total * 100) + '%"></i>' +
      '<i class="w" style="width:' + (wrong / total * 100) + '%"></i>' +
      '<i class="n2" style="width:' + (blank / total * 100) + '%"></i></div>';
    h += '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">';
    Object.keys(byPart).forEach(function (k) {
      var v = byPart[k];
      h += '<span class="tag">' + PART_LABEL[k] + '：对 ' + v.r + ' / 错 ' + v.w + ' / 未答 ' + v.b + '</span>';
    });
    h += '</div>';
    h += '<div class="subj-note">答错的题已自动进入「错题本」，可以在顶部导航里随时重做。' +
      '每题下方已展开正确答案与逐题解析。</div>';
    h += '</div>';
    $("scoreBox").innerHTML = h;
    $("submitBtn").disabled = true;
    $("submitBtn").textContent = "已提交";
    $("scoreBoxInner").scrollIntoView({ behavior: "smooth", block: "start" });
    refreshBadges();
    toast("已提交：答对 " + right + " / " + total);
  }
  function sg(n, l, cls) {
    return '<div class="sg"><div class="n ' + (cls || "") + '">' + n + '</div><div class="l">' + l + '</div></div>';
  }

  /* ================================================================
     主观题页（写作 + 翻译，按试卷形式排列）
     ================================================================ */
  function renderSubjective() {
    var p = paperOf(S.pid), m = meta(S.pid), sub = p.subjective || {};
    var w = sub.writing, t = sub.translation;
    S.view = "subjective"; setNav(null);
    var shown = Store.getSubjShown(S.pid);

    var h = '<div class="exam">';
    h += '<div class="exam-head"><button class="back" id="backHome">←</button>' +
      '<div class="etitle">' + esc(m.label) + " " + esc(m.set) + '<small>主观题部分 · 写作 + 翻译</small></div>' +
      '<div class="egrow"></div><div class="eact">' +
      '<button class="btn sm primary" id="subjShow">' + (shown ? "已显示参考答案" : "提交并查看参考答案") + '</button>' +
      '</div></div>';

    /* Part I 写作 */
    if (w) {
      h += '<section class="subj"><div class="shead"><span class="sbadge">Part I</span>' +
        '<h3>Writing 写作</h3><span class="smeta">30 minutes · 120–180 words</span></div>';
      h += '<div class="directions">' + esc(w.directions) + '</div>';
      h += '<textarea id="writeBox" placeholder="在此作答（不会自动评分，可对照下方参考范文）">' +
        esc(Store.getSubjText(S.pid, "writing")) + '</textarea>';
      h += '<div class="wc"><span id="wcWrite"></span><span>建议 120–180 词</span></div>';
      h += '<div id="refWrite"></div></section>';
    }
    /* Part IV 翻译 */
    if (t) {
      h += '<section class="subj"><div class="shead"><span class="sbadge">Part IV</span>' +
        '<h3>Translation 汉译英</h3><span class="smeta">30 minutes · 段落翻译</span></div>';
      h += '<div class="directions">' + esc(t.directions) + '</div>';
      h += '<p class="src-cn">' + esc(t.source) + '</p>';
      h += '<textarea id="transBox" placeholder="在此作答（把上面这段中文译成英文）">' +
        esc(Store.getSubjText(S.pid, "translation")) + '</textarea>';
      h += '<div class="wc"><span id="wcTrans"></span><span>整段连排，无题号</span></div>';
      h += '<div id="refTrans"></div></section>';
    }
    h += '</div>';
    view.innerHTML = h;

    $("backHome").onclick = function () { renderHome(); };
    if ($("writeBox")) {
      countWords();
      $("writeBox").addEventListener("input", function () {
        Store.setSubjText(S.pid, "writing", this.value); countWords();
      });
    }
    if ($("transBox")) {
      countWords();
      $("transBox").addEventListener("input", function () {
        Store.setSubjText(S.pid, "translation", this.value); countWords();
      });
    }
    if (shown) showRefs();
    $("subjShow").onclick = function () {
      Store.setSubjShown(S.pid);
      showRefs();
      this.textContent = "已显示参考答案";
      toast("参考答案已展开");
    };
  }

  function countWords() {
    var wb = $("writeBox");
    if (wb) {
      var n = wb.value.trim() ? wb.value.trim().split(/\s+/).length : 0;
      $("wcWrite").textContent = "已写 " + n + " 词";
    }
    var tb = $("transBox");
    if (tb) {
      var m = tb.value.trim() ? tb.value.trim().split(/\s+/).length : 0;
      $("wcTrans").textContent = "已写 " + m + " 词";
    }
  }

  function showRefs() {
    var p = paperOf(S.pid), sub = p.subjective || {}, w = sub.writing, t = sub.translation;
    if (w && $("refWrite") && !$("refWrite").innerHTML) {
      var h = '<div class="ref"><h4>参考范文（' +
        (w.model ? w.model.trim().split(/\s+/).length : 0) + ' 词）</h4>';
      h += '<div class="model">' + esc(w.model) + '</div>';
      if (w.modelZh) h += '<h4>整篇中译</h4><div class="model-zh">' + esc(w.modelZh) + '</div>';
      if (w.outline && w.outline.length) {
        h += '<h4>逐段拆解</h4>';
        w.outline.forEach(function (o) {
          h += '<div class="sent"><div class="sn">第 ' + o.no + ' 段</div><div class="row">' + esc(o.text) + '</div></div>';
        });
      }
      h += '</div>';
      $("refWrite").innerHTML = h;
    }
    if (t && $("refTrans") && !$("refTrans").innerHTML) {
      var h2 = '<div class="ref"><h4>参考译文</h4>';
      h2 += '<div class="model">' + esc(t.reference) + '</div>';
      if (t.sentences && t.sentences.length) {
        h2 += '<h4>逐句解析（' + t.sentences.length + ' 句）</h4>';
        t.sentences.forEach(function (s, i) {
          h2 += '<div class="sent"><div class="sn">第 ' + (i + 1) + ' 句</div>';
          if (s.trunk) h2 += '<div class="row"><b>主干：</b>' + esc(s.trunk) + '</div>';
          if (s.downgrade) h2 += '<div class="row"><b>降级：</b>' + esc(s.downgrade) + '</div>';
          if (s.grammar) h2 += '<div class="row"><b>语法：</b>' + esc(s.grammar) + '</div>';
          if (s.target) h2 += '<div class="row"><b>译文：</b>' + esc(s.target) + '</div>';
          h2 += '</div>';
        });
      }
      h2 += '</div>';
      $("refTrans").innerHTML = h2;
    }
  }

  /* ================================================================
     刷题页（单栏，一次一题）
     ================================================================ */
  function buildQueue(mode, arg) {
    var q = [], i, j;
    if (mode === "sequence") {
      INDEX.forEach(function (p) { p.nos.forEach(function (n) { q.push({ pid: p.id, no: n }); }); });
    } else if (mode === "random") {
      INDEX.forEach(function (p) { p.nos.forEach(function (n) { q.push({ pid: p.id, no: n }); }); });
      for (i = q.length - 1; i > 0; i--) { j = Math.floor(Math.random() * (i + 1)); var t = q[i]; q[i] = q[j]; q[j] = t; }
      q = q.slice(0, 100);
    } else if (mode === "wrong" || mode === "fav") {
      var list = mode === "wrong" ? Store.wrongList() : Store.favList();
      list.sort();
      list.forEach(function (k) { var a = k.split("#"); q.push({ pid: a[0], no: parseInt(a[1], 10) }); });
    }
    return q;
  }

  function startPractice(mode, arg, at) {
    var q = buildQueue(mode, arg);
    if (!q.length) { toast(mode === "wrong" ? "错题本是空的，先去刷几题吧" : "收藏夹是空的"); return; }
    S.practice = { mode: mode, arg: arg };
    S.queue = q;
    S.submitted = false; S.revealed = false;
    setNav(mode === "wrong" ? "wrong" : mode === "fav" ? "fav" : "practice");
    goTo(at || 0);
  }

  function goTo(i) {
    if (i < 0) i = 0;
    if (i > S.queue.length - 1) i = S.queue.length - 1;
    S.qi = i; S.revealed = false; S.submitted = false;
    var it = S.queue[i];
    S.curPid = it.pid;
    view.innerHTML = '<div class="loading">正在载入…</div>';
    loadPaper(it.pid).then(function (p) {
      var q = null;
      for (var k = 0; k < p.questions.length; k++) if (p.questions[k].no === it.no) q = p.questions[k];
      if (!q) { toast("题目缺失"); return; }
      S.cur = q;
      renderPractice();
    });
  }

  function renderPractice() {
    var q = S.cur, pid = S.curPid, m = meta(pid);
    var idx = S.qi, total = S.queue.length;
    var qid = qidOf(pid, q.no);
    var rec = Store.getAnswer(qid);
    var p = paperOf(pid);
    var pass = q.passage || (p.passages && q.pref && p.passages[q.pref]) || "";
    var modeName = { sequence: "顺序刷题", random: "随机练习", wrong: "错题本", fav: "我的收藏" }[S.practice.mode];
    S.view = "practice";

    var h = '<div class="practice">';
    h += '<div class="p-head"><button class="back" id="backHome">←</button>' +
      '<div class="ptitle">' + esc(m.label) + " " + esc(m.set) + '<small>第 ' + q.no + ' 题 · ' + PART_LABEL[q.part] + '</small></div>' +
      '<div class="pgrow"><div class="pinfo"><span>' + modeName + '</span><span><b>' + (idx + 1) + '</b> / ' + total +
      '　正确率 ' + Store.stats().rate + '%</span></div>' +
      '<div class="pbar2"><i style="width:' + Math.round((idx + 1) / total * 100) + '%"></i></div></div>' +
      '<div class="eact"><button class="btn sm ghost" id="sheetBtn">答题卡</button></div></div>';

    h += '<section class="qcard">';
    h += '<div class="qmeta"><div class="qno">' + q.no + '</div>' +
      '<div class="qfrom">' + esc(m.label) + " " + esc(m.set) + " · " + PART_LABEL[q.part] +
      (q.type ? " · " + esc(q.type) : "") + '</div><div class="spacer"></div>' +
      '<button class="fav-btn' + (Store.isFav(qid) ? " on" : "") + '" id="favBtn">' +
      (Store.isFav(qid) ? "★ 已收藏" : "☆ 收藏") + '</button></div>';

    if (pass) {
      h += '<div class="passage-inline" id="pInline"><div class="pi-head" id="piHead">' +
        (q.part === "reading" ? "阅读原文" : q.part === "matching" ? "原文段落 A–P" : "选词填空原文") +
        '<span id="piToggle">点击展开 ▼</span></div><div class="pi-body">' +
        passageHTML(pass, q.part === "cloze" ? "cloze" : q.part === "matching" ? "matching" : "reading") +
        '</div></div>';
    }
    if (q.stem) h += '<p class="qstem">' + esc(q.stem) + '</p>';
    if (q.stemZh) h += '<p class="qstem-zh">' + esc(q.stemZh) + '</p>';

    if (q.part === "cloze" && q.wordBank) {
      h += '<div class="bank" data-bank="' + q.no + '">' +
        Object.keys(q.wordBank).map(function (k) {
          return '<button data-k="' + k + '" data-no="' + q.no + '"><span class="bk">' + k + '</span>' + esc(q.wordBank[k]) + '</button>';
        }).join("") + '</div>';
    } else if (q.part === "matching") {
      var ps = q.paraOptions || "ABCDEFGHIJKLMNOP".split("");
      h += '<div class="para-pick" data-bank="' + q.no + '">' +
        ps.map(function (L) { return '<button data-k="' + L + '" data-no="' + q.no + '">' + L + '</button>'; }).join("") + '</div>';
    } else if (q.options && q.options.length === 4) {
      h += '<div class="opts" data-opts="' + q.no + '">' +
        "ABCD".split("").map(function (L, i) {
          return '<button class="opt" data-k="' + L + '" data-no="' + q.no + '"><span class="k">' + L +
            '</span><span class="t">' + esc(q.options[i]) + '</span></button>';
        }).join("") + '</div>';
    }
    h += '<div class="qresult" id="res-' + q.no + '"></div></section>';

    h += '<div class="p-foot">' +
      '<button class="btn" id="prevBtn"' + (idx === 0 ? " disabled" : "") + '>← 上一题</button>' +
      '<button class="fav-inline' + (Store.isFav(qid) ? " on" : "") + '" id="favBtn2">' + (Store.isFav(qid) ? "★" : "☆") + '</button>' +
      '<span class="spacer"></span><span class="fbadge" id="fbadge"></span><span class="spacer"></span>' +
      '<button class="btn primary" id="nextBtn">' + (idx === total - 1 ? "完成 ✓" : "下一题 →") + '</button>' +
      '</div></div>';

    view.innerHTML = h;

    $("backHome").onclick = function () { renderHome(); };
    $("prevBtn").onclick = function () { if (S.qi > 0) goTo(S.qi - 1); };
    $("nextBtn").onclick = function () {
      if (S.qi >= S.queue.length - 1) { toast("已完成：" + total + " 题"); openSheet(); return; }
      goTo(S.qi + 1);
    };
    $("sheetBtn").onclick = openSheet;
    var favToggle = function () {
      var on = Store.toggleFav(qid);
      $("favBtn").className = "fav-btn" + (on ? " on" : "");
      $("favBtn").textContent = on ? "★ 已收藏" : "☆ 收藏";
      $("favBtn2").className = "fav-inline" + (on ? " on" : "");
      $("favBtn2").textContent = on ? "★" : "☆";
      refreshBadges();
    };
    $("favBtn").onclick = favToggle;
    $("favBtn2").onclick = favToggle;
    if ($("piHead")) $("piHead").onclick = function () {
      var b = $("pInline"); b.classList.toggle("collapsed");
      $("piToggle").textContent = b.classList.contains("collapsed") ? "点击展开 ▼" : "点击折叠 ▲";
    };
    var box = document.querySelector(".qcard");
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-k]");
      if (!b) return;
      var no = parseInt(b.dataset.no, 10);
      var qq = qidOf(pid, no);
      if (Store.getAnswer(qq)) return;
      var ok = (b.dataset.k === q.answer);
      Store.answer(qq, b.dataset.k, ok);
      paintPractice();
      refreshBadges();
      toast(ok ? "答对了 ✓" : "答错了，看解析 →");
    });
    if (rec) S.revealed = true;
    paintPractice();
    updateFoot();
  }

  function paintPractice() {
    var q = S.cur, pid = S.curPid, no = q.no;
    var rec = Store.getAnswer(qidOf(pid, no));
    document.querySelectorAll('.qcard button[data-k]').forEach(function (n) {
      n.classList.remove("right", "wrong", "picked");
      var k = n.dataset.k;
      if (S.revealed) {
        n.disabled = true;
        if (k === q.answer) n.classList.add("right");
        else if (rec && rec.c === k) n.classList.add("wrong");
      } else if (rec && rec.c === k) n.classList.add("picked");
    });
    var box = $("res-" + no);
    if (box) box.innerHTML = S.revealed ? resultHTML(q, rec) : "";
  }

  function updateFoot() {
    var el = $("fbadge");
    if (!el) return;
    var rec = Store.getAnswer(qidOf(S.curPid, S.cur.no));
    var st = Store.stats();
    el.textContent = (rec ? (rec.ok ? "本题已答对" : "本题已答错，已收入错题本") : "本题未作答") +
      "　|　累计 " + st.done + " 题，正确率 " + st.rate + "%";
  }

  /* ================================================================
     答题卡
     ================================================================ */
  function openSheet() {
    var isPractice = S.view === "practice";
    var groups = {};
    S.queue.forEach(function (x) {
      var part = partOf(x.no);
      groups[part] = groups[part] || [];
      groups[part].push(x.no);
    });
    var h = "";
    ["listening", "cloze", "matching", "reading"].forEach(function (part) {
      if (!groups[part]) return;
      var nos = groups[part];
      var done = 0, right = 0;
      nos.forEach(function (n) {
        var a = Store.getAnswer(qidOf(S.pid || S.curPid, n));
        if (a) { done++; if (a.ok) right++; }
      });
      h += '<div class="sheet-group"><div class="sg-h"><span>' + PART_LABEL[part] + '</span>' +
        '<span>' + done + "/" + nos.length + " · 对 " + right + '</span></div><div class="sheet-grid">';
      nos.forEach(function (n) {
        var a = Store.getAnswer(qidOf(S.pid || S.curPid, n));
        var cls = a ? (a.ok ? "ok" : "bad") : "";
        if (isPractice && S.cur && n === S.cur.no) cls += " cur";
        h += '<button class="' + cls + '" data-jump="' + n + '">' + n + "</button>";
      });
      h += "</div></div>";
    });
    $("sheetBody").innerHTML = h || '<p style="color:#8b7a83">当前没有题目</p>';
    $("sheetFoot").innerHTML = '<button class="btn" id="sheetClose2">关闭</button>' +
      (Store.wrongCount() ? '<button class="btn ghost" id="sheetWrong">去做错题（' + Store.wrongCount() + '）</button>' : '');
    $("sheetBody").onclick = function (e) {
      var b = e.target.closest("button[data-jump]");
      if (!b) return;
      var no = parseInt(b.dataset.jump, 10);
      closeSheet();
      if (isPractice) {
        for (var i = 0; i < S.queue.length; i++) if (S.queue[i].no === no && S.queue[i].pid === S.curPid) { goTo(i); return; }
      } else {
        var sc = sectionByNo(S.struct, no);
        if (sc) {
          var el2 = document.getElementById("sec-" + sc.key);
          if (el2) el2.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        var el = $("q-" + no);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    $("sheetClose2").onclick = closeSheet;
    if ($("sheetWrong")) $("sheetWrong").onclick = function () { closeSheet(); startPractice("wrong", null, 0); };
    $("sheetMask").hidden = false; $("sheet").hidden = false;
  }
  function closeSheet() { $("sheetMask").hidden = true; $("sheet").hidden = true; }

  /* ================================================================
     顶栏 / 导航
     ================================================================ */
  function setNav(key) {
    document.querySelectorAll("#tabs button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.nav === key);
    });
  }
  function refreshBadges() {
    var st = Store.stats();
    $("wrongBadge").textContent = Store.wrongCount();
    $("favBadge").textContent = Store.favCount();
    $("topstats").innerHTML =
      '<div class="ts"><span class="n">' + st.done + '</span><span class="l">已作答</span></div>' +
      '<div class="ts"><span class="n">' + st.rate + '%</span><span class="l">正确率</span></div>' +
      '<div class="ts"><span class="n">' + Store.wrongCount() + '</span><span class="l">错题</span></div>';
  }

  function bindNav() {
    document.querySelectorAll("#tabs button").forEach(function (b) {
      b.onclick = function () {
        var n = this.dataset.nav;
        if (n === "home") renderHome();
        else if (n === "practice") startPractice("sequence", null, 0);
        else startPractice(n, null, 0);
      };
    });
    $("brandHome").onclick = function () { renderHome(); };
    $("logoutBtn").onclick = logout;
    $("sheetMask").onclick = closeSheet;
    $("sheetClose").onclick = closeSheet;
  }

  /* ---------------- 快捷键 ---------------- */
  document.addEventListener("keydown", function (e) {
    if (window.Ink && Ink.isOn()) return;
    if ($("app").hidden) return;
    if (S.view !== "practice" || !S.cur) return;
    var t = e.target.tagName;
    if (t === "INPUT" || t === "TEXTAREA") return;
    if (e.key === "ArrowRight") { if (S.qi < S.queue.length - 1) goTo(S.qi + 1); }
    else if (e.key === "ArrowLeft") { if (S.qi > 0) goTo(S.qi - 1); }
    else if (/^[a-pA-P]$/.test(e.key)) {
      var L = e.key.toUpperCase();
      var btn = document.querySelector('.qcard button[data-k="' + L + '"]');
      if (btn && !Store.getAnswer(qidOf(S.curPid, S.cur.no))) btn.click();
    }
  });

  window.addEventListener("error", function (ev) {
    if (!ev || !ev.message) return;
    if (document.body.classList.contains("logged-out")) {
      var e = $("loginErr");
      if (e) { e.hidden = false; e.textContent = "脚本错误：" + ev.message; }
    }
  });

  /* ---------------- 启动 ---------------- */
  bindNav();
  initLogin();
  if (window.Ink) Ink.sync();
  window.App = { S: S, renderHome: renderHome, openPaper: openPaper, startPractice: startPractice };
})();
