/* ==========================================================================
   透明模块 —— 全屏透明手写层
   · 完全透明，不改变网站可视度
   · 按钮/工具坞所在区域被 clip-path 挖空，不被笼罩，且在该区域无法落笔
   · 再按一次关闭；笔迹按题保存
   ========================================================================== */
window.Ink = (function () {
  "use strict";

  var canvas = document.getElementById("inkCanvas");
  var ctx = canvas.getContext("2d");
  var frame = document.getElementById("inkFrame");
  var dock = document.getElementById("inkDock");
  var toggle = document.getElementById("inkToggle");
  var toolsBox = document.getElementById("inkTools");

  var KEY = "cet4quiz.ink.v1";
  var on = false;
  var passThrough = false;
  var color = "#e5487f";
  var size = 4;
  var eraser = false;
  var drawing = false;
  var last = null;

  var store = {};          // qid -> [stroke]
  var strokes = [];        // 当前题笔画
  var curKey = "";
  var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

  /* ---------------- 存取 ---------------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) store = JSON.parse(raw) || {};
    } catch (e) { store = {}; }
  }
  var saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        var s = JSON.stringify(store);
        if (s.length > 3.5 * 1024 * 1024) { console.warn("手写笔迹过多，已暂停保存"); return; }
        localStorage.setItem(KEY, s);
      } catch (e) { console.warn("手写笔迹保存失败", e); }
    }, 400);
  }

  /* ---------------- 尺寸 / 挖洞 ---------------- */
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
    updateHole();
  }

  /* 把工具坞所在的矩形从画布中挖掉 —— 那一块不被透明模块笼罩 */
  function updateHole() {
    var r = dock.getBoundingClientRect();
    var pad = 10;
    var top = Math.max(0, Math.round(r.top - pad));
    var left = Math.max(0, Math.round(r.left - pad));
    canvas.style.clipPath =
      "polygon(0 0, 100% 0, 100% " + top + "px, " + left + "px " + top + "px, " +
      left + "px 100%, 0 100%)";
  }

  function inDock(x, y) {
    var r = dock.getBoundingClientRect();
    return x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6;
  }

  /* ---------------- 绘制 ---------------- */
  function styleFor(st) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = st.s;
    if (st.e) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = st.c;
      ctx.globalAlpha = st.hl ? 0.42 : 1;
    }
  }

  function redraw() {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < strokes.length; i++) {
      var st = strokes[i];
      if (!st.pts || st.pts.length < 1) continue;
      styleFor(st);
      ctx.beginPath();
      if (st.pts.length === 1) {
        ctx.arc(st.pts[0][0], st.pts[0][1], st.s / 2, 0, Math.PI * 2);
        ctx.fillStyle = st.e ? "rgba(0,0,0,1)" : st.c;
        ctx.fill();
      } else {
        ctx.moveTo(st.pts[0][0], st.pts[0][1]);
        for (var j = 1; j < st.pts.length; j++) ctx.lineTo(st.pts[j][0], st.pts[j][1]);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  function segment(st, a, b) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    styleFor(st);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  /* ---------------- 指针事件 ---------------- */
  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  canvas.addEventListener("pointerdown", function (e) {
    if (!on || passThrough) return;
    var p = pos(e);
    if (inDock(e.clientX, e.clientY)) return;   // 按钮区域不落笔
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    last = p;
    var st = { c: color, s: eraser ? size * 4 : size, e: eraser, hl: color === "#ffe14d", pts: [p] };
    strokes.push(st);
    segment(st, p, [p[0] + 0.1, p[1] + 0.1]);
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!drawing || !on || passThrough) return;
    var p = pos(e);
    var st = strokes[strokes.length - 1];
    if (!st) return;
    st.pts.push(p);
    segment(st, last, p);
    last = p;
    e.preventDefault();
  });

  function endStroke() {
    if (!drawing) return;
    drawing = false;
    last = null;
    persist();
  }
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  canvas.addEventListener("pointerleave", endStroke);

  /* 滚轮：在书写模式下也能滚动页面 */
  canvas.addEventListener("wheel", function (e) {
    if (!on || passThrough) return;
    e.preventDefault();
    window.scrollBy({ top: e.deltaY, left: e.deltaX, behavior: "auto" });
  }, { passive: false });

  /* ---------------- 笔迹归属 ---------------- */
  function currentQid() {
    var S = window.App && window.App.S;
    if (!S || !S.cur) return "global";
    return S.curPid + "#" + S.cur.no;
  }

  function persist() {
    if (curKey) store[curKey] = strokes;
    save();
  }

  function setKey(qid) {
    if (qid === curKey) return;
    persist();
    curKey = qid;
    strokes = (store[curKey] || []).slice();
    if (on) redraw();
  }

  function sync() { setKey(currentQid()); }

  /* ---------------- 开关 ---------------- */
  function setOn(v) {
    on = v;
    canvas.hidden = !v;
    frame.hidden = !v;
    toolsBox.hidden = !v;
    toggle.classList.toggle("on", v);
    document.body.classList.toggle("ink-on", v);
    toggle.querySelector("span").textContent = v ? "关闭透明模块" : "透明模块";
    if (v) {
      sync();
      resize();
      canvas.style.pointerEvents = passThrough ? "none" : "auto";
    }
  }

  function setPassThrough(v) {
    passThrough = v;
    canvas.style.pointerEvents = v ? "none" : "auto";
    var b = document.getElementById("inkPass");
    if (b) { b.classList.toggle("on", v); b.textContent = v ? "穿透中" : "穿透"; }
  }

  /* ---------------- 工具栏 ---------------- */
  function bindTools() {
    toggle.onclick = function () { setOn(!on); };

    toolsBox.addEventListener("click", function (e) {
      var sw = e.target.closest(".sw");
      if (sw) {
        color = sw.dataset.color;
        eraser = false;
        var all = toolsBox.querySelectorAll(".sw");
        for (var i = 0; i < all.length; i++) all[i].classList.toggle("on", all[i] === sw);
        var er = document.getElementById("inkEraser");
        if (er) er.classList.remove("on");
        return;
      }
      var tl = e.target.closest("[data-size]");
      if (tl) {
        size = parseInt(tl.dataset.size, 10);
        var all2 = toolsBox.querySelectorAll("[data-size]");
        for (var j = 0; j < all2.length; j++) all2[j].classList.toggle("on", all2[j] === tl);
        return;
      }
      var id = e.target.closest("button") && e.target.closest("button").id;
      if (id === "inkEraser") {
        eraser = !eraser;
        e.target.closest("button").classList.toggle("on", eraser);
      } else if (id === "inkUndo") {
        if (strokes.length) { strokes.pop(); redraw(); persist(); }
        else toast("没有可撤销的笔迹");
      } else if (id === "inkClear") {
        if (!strokes.length) { toast("本题没有笔迹"); return; }
        strokes = []; redraw(); persist(); toast("已清空本题笔迹");
      } else if (id === "inkSave") {
        savePNG();
      } else if (id === "inkPass") {
        setPassThrough(!passThrough);
      }
    });
  }

  function toast(msg) {
    var t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1500);
  }

  function savePNG() {
    var a = document.createElement("a");
    a.download = "四级笔记-" + curKey.replace("#", "-") + ".png";
    a.href = canvas.toDataURL("image/png");
    a.click();
    toast("已保存为图片");
  }

  /* ---------------- 快捷键 ---------------- */
  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (e.key === "d" || e.key === "D") { setOn(!on); return; }
    if (!on) return;
    if (e.key === "Escape") { setOn(false); return; }
    if (e.key === "z" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (strokes.length) { strokes.pop(); redraw(); persist(); } }
  });

  /* ---------------- 初始化 ---------------- */
  load();
  bindTools();
  setPassThrough(false);
  var ro = null;
  window.addEventListener("resize", function () {
    if (!on) return;
    if (ro) cancelAnimationFrame(ro);
    ro = requestAnimationFrame(resize);
  });

  /* 切题时自动切换笔迹本 */
  var lastQid = "";
  setInterval(function () {
    if (!on) return;
    var q = currentQid();
    if (q !== lastQid) { lastQid = q; sync(); }
  }, 500);

  return {
    isOn: function () { return on; },
    setOn: setOn,
    sync: sync,
    setKey: setKey,
    clearCurrent: function () { strokes = []; redraw(); persist(); }
  };
})();
