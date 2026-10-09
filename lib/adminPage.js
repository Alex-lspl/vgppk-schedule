'use strict';

// Страница админки. Специально лежит НЕ в /public — всё, что лежит в /public,
// Vercel отдаёт как статический файл напрямую, в обход проверки логина/пароля.
// api/admin.js сначала проверяет логин через requireAuth и только потом отдаёт этот HTML.
function adminPageHtml() {
  return '<!doctype html>\n' +
'<html lang="ru">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>Админка — расписание</title>\n' +
'<link rel="icon" href="/icon-32.png" type="image/png">\n' +
'<link rel="apple-touch-icon" href="/icon-180.png">\n' +
'<style>\n' +
':root{--bg:#151515;--surface:#201c18;--surface2:#2a241f;--line:#3a332b;--ink:#f2ede3;--muted:#a79c8e;--accent:#d97757;--danger:#c2704f;--ok:#7fae72}\n' +
'*{box-sizing:border-box}\n' +
'body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px 16px 64px}\n' +
'h1{font-size:20px;margin:0}\n' +
'.head-row{display:flex;align-items:center;gap:12px}\n' +
'.head-row .logo-img{width:36px;height:36px;border-radius:10px;flex-shrink:0}\n' +
'.head-row .title-col{flex:1;min-width:0}\n' +
'.muted{color:var(--muted)}\n' +
'.wrap{max-width:900px;margin:0 auto}\n' +
'.top{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin:14px 0}\n' +
'input,select,button{font:inherit;color:inherit}\n' +
'input[type=text],input[type=number],select{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:7px 9px;color:var(--ink)}\n' +
'button{cursor:pointer;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px 14px}\n' +
'button:hover{border-color:var(--accent)}\n' +
'button.primary{background:var(--accent);border-color:var(--accent);color:#1b1815;font-weight:600}\n' +
'button.danger{color:var(--danger);border-color:var(--danger)}\n' +
'button:disabled{opacity:.5;cursor:default}\n' +
'.banner{padding:10px 14px;border-radius:10px;background:#3a2a20;border:1px solid var(--danger);margin:10px 0;font-size:13px}\n' +
'.day{border:1px solid var(--line);border-radius:12px;margin:10px 0;overflow:hidden}\n' +
'.day-head{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface);flex-wrap:wrap}\n' +
'.day-head b{font-size:15px}\n' +
'.day-body{padding:10px 14px;display:none}\n' +
'.day.on .day-body{display:block}\n' +
'.day.on{border-color:var(--accent)}\n' +
'.row{display:grid;grid-template-columns:52px 1.4fr 1fr 70px 110px 1fr 34px;gap:6px;margin-bottom:6px;align-items:center}\n' +
'.row input,.row select{width:100%}\n' +
'.rowhead{display:grid;grid-template-columns:52px 1.4fr 1fr 70px 110px 1fr 34px;gap:6px;font-size:11px;color:var(--muted);margin-bottom:4px}\n' +
'.addrow{margin-top:4px}\n' +
'.footer-bar{position:sticky;bottom:0;display:flex;gap:10px;align-items:center;padding:12px 0;margin-top:18px;background:var(--bg);border-top:1px solid var(--line)}\n' +
'.msg{font-size:13px}\n' +
'.msg.ok{color:var(--ok)}\n' +
'.msg.err{color:var(--danger)}\n' +
'@media (max-width:640px){.row,.rowhead{grid-template-columns:44px 1fr 34px}.rowhead span:nth-child(3),.rowhead span:nth-child(4),.rowhead span:nth-child(5),.rowhead span:nth-child(6){display:none}.f-teacher,.f-room,.f-subgroup,.f-note{grid-column:1 / -1}}\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<div class="wrap">\n' +
'<div class="head-row">\n' +
'<img class="logo-img" src="/icon-128.png" alt="">\n' +
'<div class="title-col"><h1>Админка расписания</h1></div>\n' +
'<button id="logoutBtn" type="button">Выйти</button>\n' +
'</div>\n' +
'<p class="muted" id="weekInfo">Загрузка…</p>\n' +
'<div id="banner"></div>\n' +
'<div class="top">\n' +
'<label>Группа: <select id="groupSelect"></select></label>\n' +
'<button id="reloadBtn" type="button">Обновить с сайта</button>\n' +
'<button id="resetBtn" type="button" class="danger">Сбросить всю неделю</button>\n' +
'<span class="msg" id="topMsg"></span>\n' +
'</div>\n' +
'<div id="days"></div>\n' +
'<div class="footer-bar">\n' +
'<button id="saveBtn" type="button" class="primary">Сохранить</button>\n' +
'<span class="msg" id="saveMsg"></span>\n' +
'</div>\n' +
'<p class="muted">Правки действуют только до ближайшего понедельника — дальше расписание само вернётся к тому, что на сайте колледжа.</p>\n' +
'</div>\n' +
'<script>\n' +
'var DAY_NAMES=["Понедельник","Вторник","Среда","Четверг","Пятница","Суббота","Воскресенье"];\n' +
'var state=null;\n' +
'var overrideDays=null;\n' +
'function qs(id){return document.getElementById(id)}\n' +
'function esc(s){return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c]})}\n' +
'function setMsg(el,text,cls){el.textContent=text||"";el.className="msg"+(cls?" "+cls:"")}\n' +
'\n' +
'function rowHtml(l){\n' +
'  l=l||{};\n' +
'  var subOpts=["","1","2"].map(function(v){\n' +
'    var label=v===""?"—":(v+" подгр.");\n' +
'    var sel=String(l.subgroup||"")===v?" selected":"";\n' +
'    return "<option value=\\""+v+"\\""+sel+">"+label+"</option>";\n' +
'  }).join("");\n' +
'  return ""+\n' +
'    "<div class=\\"row\\">"+\n' +
'    "<input type=\\"number\\" min=\\"1\\" max=\\"9\\" class=\\"f-pair\\" value=\\""+esc(l.pair||"")+"\\" placeholder=\\"№\\">"+\n' +
'    "<input type=\\"text\\" class=\\"f-subject\\" value=\\""+esc(l.subject||"")+"\\" placeholder=\\"Предмет\\">"+\n' +
'    "<input type=\\"text\\" class=\\"f-teacher\\" value=\\""+esc(l.teacher||"")+"\\" placeholder=\\"Преподаватель\\">"+\n' +
'    "<input type=\\"text\\" class=\\"f-room\\" value=\\""+esc(l.room||"")+"\\" placeholder=\\"Каб.\\">"+\n' +
'    "<select class=\\"f-subgroup\\">"+subOpts+"</select>"+\n' +
'    "<input type=\\"text\\" class=\\"f-note\\" value=\\""+esc(l.note||"")+"\\" placeholder=\\"Заметка\\">"+\n' +
'    "<button type=\\"button\\" class=\\"f-del\\" title=\\"Удалить пару\\" onclick=\\"this.closest(\'.row\').remove()\\">✕</button>"+\n' +
'    "</div>";\n' +
'}\n' +
'\n' +
'function dayHtml(dayIdx, lessons, isOverridden){\n' +
'  var rows=(lessons||[]).map(rowHtml).join("");\n' +
'  return ""+\n' +
'    "<div class=\\"day"+(isOverridden?" on":"")+"\\" data-day=\\""+dayIdx+"\\">"+\n' +
'    "<div class=\\"day-head\\">"+\n' +
'    "<label><input type=\\"checkbox\\" class=\\"day-toggle\\""+(isOverridden?" checked":"")+"> <b>"+DAY_NAMES[dayIdx]+"</b></label>"+\n' +
'    "<span class=\\"muted\\">переопределить этот день</span>"+\n' +
'    "</div>"+\n' +
'    "<div class=\\"day-body\\">"+\n' +
'    "<div class=\\"rowhead\\"><span>№ пары</span><span>Предмет</span><span>Преподаватель</span><span>Каб.</span><span>Подгруппа</span><span>Заметка</span><span></span></div>"+\n' +
'    "<div class=\\"rows\\">"+rows+"</div>"+\n' +
'    "<button type=\\"button\\" class=\\"addrow\\">+ Добавить пару</button>"+\n' +
'    "</div>"+\n' +
'    "</div>";\n' +
'}\n' +
'\n' +
'function renderDays(){\n' +
'  var html="";\n' +
'  for (var i=0;i<7;i++){\n' +
'    var day=state.weeks.filter(function(w){return w.number===state.liveWeekNumber})[0].days[i];\n' +
'    var isOverridden=Object.prototype.hasOwnProperty.call(overrideDays, String(i));\n' +
'    var lessons=isOverridden?overrideDays[i]:day.lessons;\n' +
'    html+=dayHtml(i, lessons, isOverridden);\n' +
'  }\n' +
'  qs("days").innerHTML=html;\n' +
'  qs("days").querySelectorAll(".day").forEach(function(dayEl){\n' +
'    var toggle=dayEl.querySelector(".day-toggle");\n' +
'    toggle.addEventListener("change", function(){ dayEl.classList.toggle("on", toggle.checked); });\n' +
'    dayEl.querySelector(".addrow").addEventListener("click", function(){\n' +
'      dayEl.querySelector(".rows").insertAdjacentHTML("beforeend", rowHtml({}));\n' +
'      toggle.checked=true; dayEl.classList.add("on");\n' +
'    });\n' +
'  });\n' +
'}\n' +
'\n' +
'function collectPayload(){\n' +
'  var days={};\n' +
'  qs("days").querySelectorAll(".day").forEach(function(dayEl){\n' +
'    var idx=dayEl.getAttribute("data-day");\n' +
'    if (!dayEl.querySelector(".day-toggle").checked) return;\n' +
'    var lessons=[];\n' +
'    dayEl.querySelectorAll(".row").forEach(function(r){\n' +
'      var subject=r.querySelector(".f-subject").value.trim();\n' +
'      var pair=Number(r.querySelector(".f-pair").value);\n' +
'      if (!subject || !pair) return;\n' +
'      lessons.push({\n' +
'        pair: pair,\n' +
'        subject: subject,\n' +
'        teacher: r.querySelector(".f-teacher").value.trim() || null,\n' +
'        room: r.querySelector(".f-room").value.trim() || null,\n' +
'        subgroup: r.querySelector(".f-subgroup").value ? Number(r.querySelector(".f-subgroup").value) : null,\n' +
'        note: r.querySelector(".f-note").value.trim() || null\n' +
'      });\n' +
'    });\n' +
'    days[idx]=lessons;\n' +
'  });\n' +
'  return days;\n' +
'}\n' +
'\n' +
'function currentPage(){ return qs("groupSelect").value || "bg203"; }\n' +
'\n' +
'function parseJsonOrReload(r){\n' +
'  if (r.status === 401) { location.reload(); return new Promise(function(){}); }\n' +
'  return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||"Ошибка"); return j; });\n' +
'}\n' +
'\n' +
'function loadGroups(){\n' +
'  fetch("/api/groups").then(function(r){return r.json()}).then(function(j){\n' +
'    var sel=qs("groupSelect");\n' +
'    var saved=localStorage.getItem("admin:page");\n' +
'    sel.innerHTML=(j.groups||[]).map(function(g){return "<option value=\\""+esc(g.page)+"\\">"+esc(g.name)+"</option>"}).join("");\n' +
'    if (saved) sel.value=saved;\n' +
'    loadData();\n' +
'  }).catch(function(){ loadData(); });\n' +
'}\n' +
'\n' +
'function loadData(){\n' +
'  setMsg(qs("topMsg"),"Загрузка…");\n' +
'  fetch("/api/admin-data?page="+encodeURIComponent(currentPage())).then(parseJsonOrReload).then(function(data){\n' +
'    state=data; overrideDays=data.overrideDays||{};\n' +
'    localStorage.setItem("admin:page", currentPage());\n' +
'    qs("weekInfo").textContent="Сейчас неделя "+data.weekKey+" (Неделя "+data.liveWeekNumber+" по сайту колледжа), правки сбросятся в понедельник.";\n' +
'    qs("banner").innerHTML = data.storageConfigured ? "" :\n' +
'      "<div class=\\"banner\\">GitHub не настроен — изменения не сохранятся. См. README, раздел «Админка» (нужно добавить GITHUB_TOKEN и GITHUB_REPO в настройках Vercel).</div>";\n' +
'    qs("saveBtn").disabled = !data.storageConfigured;\n' +
'    qs("resetBtn").disabled = !data.storageConfigured;\n' +
'    renderDays();\n' +
'    setMsg(qs("topMsg"),"");\n' +
'  }).catch(function(e){ setMsg(qs("topMsg"), e.message, "err"); });\n' +
'}\n' +
'\n' +
'qs("groupSelect").addEventListener("change", loadData);\n' +
'qs("reloadBtn").addEventListener("click", loadData);\n' +
'\n' +
'qs("saveBtn").addEventListener("click", function(){\n' +
'  var days=collectPayload();\n' +
'  setMsg(qs("saveMsg"),"Сохраняю…");\n' +
'  fetch("/api/admin-save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({page:currentPage(),days:days})})\n' +
'    .then(parseJsonOrReload)\n' +
'    .then(function(){ setMsg(qs("saveMsg"),"Сохранено.","ok"); loadData(); })\n' +
'    .catch(function(e){ setMsg(qs("saveMsg"), e.message, "err"); });\n' +
'});\n' +
'\n' +
'qs("resetBtn").addEventListener("click", function(){\n' +
'  if (!confirm("Сбросить все правки на эту неделю для группы "+currentPage()+"?")) return;\n' +
'  setMsg(qs("topMsg"),"Сбрасываю…");\n' +
'  fetch("/api/admin-reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({page:currentPage()})})\n' +
'    .then(parseJsonOrReload)\n' +
'    .then(function(){ loadData(); })\n' +
'    .catch(function(e){ setMsg(qs("topMsg"), e.message, "err"); });\n' +
'});\n' +
'\n' +
'qs("logoutBtn").addEventListener("click", function(){\n' +
'  fetch("/api/admin-logout", {method:"POST"}).then(function(){ location.reload(); });\n' +
'});\n' +
'\n' +
'loadGroups();\n' +
'</script>\n' +
'</body>\n' +
'</html>\n';
}

module.exports = { adminPageHtml };
