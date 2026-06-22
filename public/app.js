// ===== 상태 =====
let state = {
  period: "week",   // week | month | quarter | year
  ref: new Date(),  // 현재 보고 있는 기준 날짜
};

// ===== 날짜 유틸 =====
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// 타이핑한 시간을 "HH:MM"으로 보정. 빈 값은 "", 형식이 틀리면 null 반환.
// 예) "1430"→"14:30", "930"→"09:30", "9:5"→"09:05", "14"→"14:00"
function normalizeTime(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  let h, m;
  if (s.includes(":")) {
    const [hp, mp] = s.split(":");
    h = parseInt(hp, 10);
    m = mp === undefined || mp === "" ? 0 : parseInt(mp, 10);
  } else {
    const digits = s.replace(/\D/g, "");
    if (!digits) return null;
    if (digits.length <= 2) { h = parseInt(digits, 10); m = 0; }
    else { m = parseInt(digits.slice(-2), 10); h = parseInt(digits.slice(0, -2), 10); }
  }
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

// 월요일 시작 주의 시작일
function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // 월=0 ... 일=6
  return addDays(x, -day);
}

// 기준 날짜와 기간으로 {from, to, label} 계산
function range(period, ref) {
  const y = ref.getFullYear();
  if (period === "week") {
    const s = weekStart(ref);
    const e = addDays(s, 6);
    return { from: fmt(s), to: fmt(e), label: `${fmt(s)} ~ ${fmt(e)}` };
  }
  if (period === "month") {
    const s = new Date(y, ref.getMonth(), 1);
    const e = new Date(y, ref.getMonth() + 1, 0);
    return { from: fmt(s), to: fmt(e), label: `${y}년 ${ref.getMonth() + 1}월` };
  }
  if (period === "quarter") {
    const q = Math.floor(ref.getMonth() / 3); // 0..3
    const s = new Date(y, q * 3, 1);
    const e = new Date(y, q * 3 + 3, 0);
    return { from: fmt(s), to: fmt(e), label: `${y}년 ${q + 1}분기` };
  }
  // year
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}년` };
}

// 이전/다음 기간으로 기준 날짜 이동
function shift(period, ref, dir) {
  const x = new Date(ref);
  if (period === "week") x.setDate(x.getDate() + dir * 7);
  else if (period === "month") x.setMonth(x.getMonth() + dir);
  else if (period === "quarter") x.setMonth(x.getMonth() + dir * 3);
  else x.setFullYear(x.getFullYear() + dir);
  return x;
}

// ===== API =====
async function fetchEntries(from, to) {
  const res = await fetch(`/api/entries?from=${from}&to=${to}`);
  if (!res.ok) throw new Error("불러오기 실패");
  return res.json();
}
async function saveEntry(data) {
  const url = data.id ? `/api/entries/${data.id}` : "/api/entries";
  const res = await fetch(url, {
    method: data.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error || "저장 실패");
  return res.json();
}
async function deleteEntry(id) {
  const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("삭제 실패");
}

// ===== 렌더링 =====
const $ = (sel) => document.querySelector(sel);

let projects = [];  // 전체 프로젝트 목록 (이름 조회·셀렉트용)
const projectName = (id) => {
  const p = projects.find((x) => String(x.id) === String(id));
  return p ? p.name : null;
};
// 시작·종료 시각으로 소요 분 계산 (서버와 동일 규칙)
function calcDuration(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some(Number.isNaN)) return 0;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins;
}
// 분 -> "N시간 M분"
function fmtDuration(min) {
  min = Number(min) || 0;
  if (min <= 0) return "0분";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

function renderSummary(entries) {
  const days = new Set(entries.map((e) => e.work_date)).size;
  const tagCount = {};
  entries.forEach((e) =>
    (e.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => (tagCount[t] = (tagCount[t] || 0) + 1))
  );
  const topTag = Object.entries(tagCount).sort((a, b) => b[1] - a[1])[0];
  const totalMin = entries.reduce((s, e) => s + (Number(e.duration_min) || 0), 0);
  const cards = [
    { num: entries.length, lbl: "총 일지" },
    { num: days, lbl: "활동한 날" },
    { num: fmtDuration(totalMin), lbl: "총 소요시간" },
    { num: topTag ? topTag[0] : "—", lbl: "최다 태그" },
  ];
  $("#summary").innerHTML = cards
    .map((c) => `<div class="stat-card"><div class="num">${c.num}</div><div class="lbl">${c.lbl}</div></div>`)
    .join("");
}

function esc(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderEntries(entries) {
  const box = $("#entries");
  if (!entries.length) {
    box.innerHTML = `<div class="empty">이 기간에 작성된 일지가 없습니다.<br/>＋ 새 일지로 기록을 남겨보세요.</div>`;
    return;
  }
  // 날짜별 그룹 (내림차순)
  const groups = {};
  entries.forEach((e) => (groups[e.work_date] = groups[e.work_date] || []).push(e));
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  const weekday = ["일", "월", "화", "수", "목", "금", "토"];
  box.innerHTML = dates
    .map((date) => {
      const d = parse(date);
      const head = `${date} (${weekday[d.getDay()]})`;
      const items = groups[date]
        .map((e) => {
          const tags = (e.tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => `<span class="tag">${esc(t)}</span>`)
            .join("");
          const time = e.start_time
            ? `<span class="entry-time">${esc(e.start_time)}${e.end_time ? "~" + esc(e.end_time) : ""}</span> `
            : "";
          const dur = e.duration_min > 0 ? `<span class="entry-dur">⏱ ${fmtDuration(e.duration_min)}</span>` : "";
          const pname = projectName(e.project_id);
          const proj = pname ? `<span class="entry-proj">📁 ${esc(pname)}</span>` : "";
          const meta = dur || proj ? `<div class="entry-meta">${dur}${proj}</div>` : "";
          return `<div class="entry" data-id="${e.id}">
              <div class="body">
                <div class="title">${time}${esc(e.title)}</div>
                ${e.content ? `<div class="content">${esc(e.content)}</div>` : ""}
                ${meta}
                ${tags ? `<div class="tags">${tags}</div>` : ""}
              </div>
            </div>`;
        })
        .join("");
      return `<div class="day-group"><div class="day-header">${head}</div>${items}</div>`;
    })
    .join("");
}

let currentEntries = [];

async function refresh() {
  const { from, to, label } = range(state.period, state.ref);
  $("#period-label").textContent = label;
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.period === state.period)
  );
  try {
    currentEntries = await fetchEntries(from, to);
    renderSummary(currentEntries);
    renderEntries(currentEntries);
  } catch (err) {
    $("#entries").innerHTML = `<div class="empty">오류: ${esc(err.message)}</div>`;
  }
}

// ===== 모달 =====
function openModal(entry) {
  $("#modal-title").textContent = entry ? "일지 수정" : "새 일지";
  $("#entry-id").value = entry ? entry.id : "";
  $("#f-date").value = entry ? entry.work_date : fmt(new Date());
  $("#f-start").value = entry ? entry.start_time || "" : "";
  $("#f-end").value = entry ? entry.end_time || "" : "";
  updateDurDisplay();
  $("#f-title").value = entry ? entry.title : "";
  $("#f-project").value = entry && entry.project_id ? String(entry.project_id) : "";
  $("#f-content").value = entry ? entry.content : "";
  $("#f-tags").value = entry ? entry.tags : "";
  $("#tag-suggest").hidden = true;
  $("#delete-btn").hidden = !entry;
  $("#et-new").value = "";
  loadEntryTodos(entry ? entry.id : null);   // 관련 할일 불러오기
  $("#modal").hidden = false;
  $("#f-title").focus();
}
function closeModal() { $("#modal").hidden = true; }

// 시작·종료 입력에 따라 소요 시간 자동 표시
function updateDurDisplay() {
  const min = calcDuration($("#f-start").value, $("#f-end").value);
  $("#dur-display").textContent = `소요 시간: ${min > 0 ? fmtDuration(min) : "—"}`;
}
$("#f-start").addEventListener("input", updateDurDisplay);
$("#f-end").addEventListener("input", updateDurDisplay);

// 현재 시각을 "HH:MM"으로
function nowHM() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// 타이머: 버튼으로 시작/종료 시각을 현재 시각으로 찍는다. 입력칸은 그대로 수정 가능.
$("#start-now").addEventListener("click", () => { $("#f-start").value = nowHM(); updateDurDisplay(); });
$("#end-now").addEventListener("click", () => { $("#f-end").value = nowHM(); updateDurDisplay(); });

// ===== 태그 자동완성 =====
let allTags = [];   // 지금까지 사용한 태그 (사용 횟수 내림차순)
async function loadTags() {
  try {
    const res = await fetch("/api/tags");
    allTags = (await res.json()).map((t) => t.name);
  } catch { allTags = []; }
}
// 입력칸에 이미 들어간 태그들
function tagsInField() {
  return $("#f-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
}
// 커서가 위치한, 마지막 쉼표 뒤의 현재 입력 토큰
function currentTagToken() {
  const v = $("#f-tags").value;
  return v.slice(v.lastIndexOf(",") + 1).trim();
}
function renderTagSuggest() {
  const box = $("#tag-suggest");
  const token = currentTagToken().toLowerCase();
  const used = new Set(tagsInField().map((t) => t.toLowerCase()));
  let list = allTags.filter((t) => !used.has(t.toLowerCase()));
  if (token) list = list.filter((t) => t.toLowerCase().includes(token));
  list = list.slice(0, 8);
  if (!list.length) { box.hidden = true; return; }
  box.innerHTML = list
    .map((t) => `<button type="button" class="tag-opt">${esc(t)}</button>`)
    .join("");
  box.hidden = false;
}
// 추천 태그를 현재 토큰 자리에 채워 넣는다
function applyTagSuggestion(tag) {
  const input = $("#f-tags");
  const v = input.value;
  const ci = v.lastIndexOf(",");
  const head = ci >= 0 ? v.slice(0, ci + 1) + " " : "";
  input.value = head + tag + ", ";
  input.focus();
}
$("#f-tags").addEventListener("input", renderTagSuggest);
$("#f-tags").addEventListener("focus", renderTagSuggest);
$("#f-tags").addEventListener("blur", () => setTimeout(() => { $("#tag-suggest").hidden = true; }, 150));
// mousedown + preventDefault: 클릭으로 blur가 먼저 일어나 목록이 닫히는 것 방지
$("#tag-suggest").addEventListener("mousedown", (e) => {
  const btn = e.target.closest(".tag-opt");
  if (!btn) return;
  e.preventDefault();
  applyTagSuggestion(btn.textContent);
  renderTagSuggest();
});

// ===== 일지 ↔ 할일 연동 (모달) =====
let modalNewTodos = [];          // 저장 시 새로 만들 할일 제목들
let modalLinkedIds = new Set();  // 이 일지에 연결할 기존 할일 id
let modalCandidateTodos = [];    // 연결 후보 (미연결이거나 이 일지에 이미 연결된 할일)

async function loadEntryTodos(entryId) {
  modalNewTodos = [];
  modalLinkedIds = new Set();
  modalCandidateTodos = [];
  try {
    const res = await fetch("/api/todos");
    const all = await res.json();
    // 후보: 완료 아님 + (미연결 또는 이 일지에 연결됨)
    modalCandidateTodos = all.filter((t) =>
      todoStatus(t) !== "done" &&
      (!t.entry_id || (entryId && String(t.entry_id) === String(entryId)))
    );
    if (entryId) all.forEach((t) => {
      if (String(t.entry_id) === String(entryId)) modalLinkedIds.add(t.id);
    });
  } catch { /* 무시 */ }
  renderEtList();
}

function renderEtList() {
  const box = $("#et-list");
  const newItems = modalNewTodos
    .map((title, i) => `<div class="et-item et-new-item"><span class="et-new-mark">＋</span><span class="et-txt">${esc(title)}</span><button type="button" class="et-rm" data-i="${i}">×</button></div>`)
    .join("");
  const existing = modalCandidateTodos
    .map((t) => {
      const checked = modalLinkedIds.has(t.id) ? "checked" : "";
      const badge = todoStatus(t) === "doing" ? `<span class="et-badge">진행중</span>` : "";
      return `<label class="et-item"><input type="checkbox" class="et-check" data-id="${t.id}" ${checked} /><span class="et-txt">${esc(t.title)}</span>${badge}</label>`;
    })
    .join("");
  box.innerHTML = (newItems + existing) || `<div class="et-empty">연결할 할일이 없습니다. 위에서 새로 추가해 보세요.</div>`;
}

function addQueuedTodo() {
  const inp = $("#et-new");
  const v = inp.value.trim();
  if (!v) return;
  modalNewTodos.push(v);
  inp.value = "";
  renderEtList();
  inp.focus();
}
$("#et-add-btn").addEventListener("click", addQueuedTodo);
$("#et-new").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); addQueuedTodo(); }
});
$("#et-list").addEventListener("click", (e) => {
  if (e.target.classList.contains("et-rm")) {
    modalNewTodos.splice(Number(e.target.dataset.i), 1);
    renderEtList();
  }
});
$("#et-list").addEventListener("change", (e) => {
  if (!e.target.classList.contains("et-check")) return;
  const id = Number(e.target.dataset.id);
  if (e.target.checked) modalLinkedIds.add(id);
  else modalLinkedIds.delete(id);
});

// 일지 저장 후: 새 할일 생성 + 기존 할일 연결/해제 반영
async function applyEntryTodos(entryId, entryDate, projectId) {
  for (const title of modalNewTodos) {
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, due_date: entryDate || "", project_id: projectId || null, entry_id: entryId, status: "todo" }),
    });
  }
  for (const t of modalCandidateTodos) {
    const want = modalLinkedIds.has(t.id);
    const wasLinked = String(t.entry_id) === String(entryId);
    if (want && !wasLinked) {
      await fetch(`/api/todos/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry_id: entryId }) });
    } else if (!want && wasLinked) {
      await fetch(`/api/todos/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry_id: null }) });
    }
  }
}

// ===== 이벤트 =====
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => { state.period = t.dataset.period; refresh(); })
);
$("#prev").addEventListener("click", () => { state.ref = shift(state.period, state.ref, -1); refresh(); });
$("#next").addEventListener("click", () => { state.ref = shift(state.period, state.ref, 1); refresh(); });
$("#today-btn").addEventListener("click", () => { state.ref = new Date(); refresh(); });

$("#new-btn").addEventListener("click", () => openModal(null));
$("#cancel-btn").addEventListener("click", closeModal);
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

$("#entries").addEventListener("click", (e) => {
  const el = e.target.closest(".entry");
  if (!el) return;
  const entry = currentEntries.find((x) => String(x.id) === el.dataset.id);
  if (entry) openModal(entry);
});

$("#entry-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    id: $("#entry-id").value || null,
    work_date: $("#f-date").value,
    start_time: $("#f-start").value,
    end_time: $("#f-end").value,
    title: $("#f-title").value.trim(),
    content: $("#f-content").value.trim(),
    tags: $("#f-tags").value.trim(),
    project_id: $("#f-project").value || null,
  };
  try {
    const saved = await saveEntry(data);
    await applyEntryTodos(saved.id, data.work_date, data.project_id);
    closeModal();
    refresh();
    loadTags();   // 새로 쓴 태그를 자동완성 목록에 반영
    loadTodos();  // 연결/생성된 할일 반영
  } catch (err) {
    alert(err.message);
  }
});

$("#delete-btn").addEventListener("click", async () => {
  const id = $("#entry-id").value;
  if (!id || !confirm("이 일지를 삭제할까요?")) return;
  try {
    await deleteEntry(id);
    closeModal();
    refresh();
  } catch (err) {
    alert(err.message);
  }
});

// ===== 캘린더 / 일정 =====
let calRef = new Date();           // 달력에 표시 중인 월
let calSchedules = {};             // { 'YYYY-MM-DD': [ {id,title}, ... ] }

async function fetchSchedules(from, to) {
  const res = await fetch(`/api/schedules?from=${from}&to=${to}`);
  if (!res.ok) throw new Error("일정 불러오기 실패");
  return res.json();
}
async function addSchedule(schedule_date, title, schedule_time = "", project_id = null) {
  const res = await fetch("/api/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schedule_date, title, schedule_time, project_id }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "일정 추가 실패");
  return res.json();
}
async function updateSchedule(id, title, schedule_time = "") {
  const res = await fetch(`/api/schedules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, schedule_time }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "일정 수정 실패");
  return res.json();
}
async function removeSchedule(id, cascade = false) {
  const url = `/api/schedules/${id}` + (cascade ? "?cascade=1" : "");
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error("일정 삭제 실패");
}
// 일정을 할일로 추가 (마감일 = 일정 날짜, schedule_id 로 연동)
async function scheduleToTodo(schedule_id, title, due_date) {
  const res = await fetch("/api/todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, due_date, schedule_id, status: "todo" }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "할일 추가 실패");
  return res.json();
}

async function calRefresh() {
  const y = calRef.getFullYear();
  const m = calRef.getMonth();
  $("#cal-label").textContent = `${y}년 ${m + 1}월`;
  const from = fmt(new Date(y, m, 1));
  const to = fmt(new Date(y, m + 1, 0));

  calSchedules = {};
  try {
    const list = await fetchSchedules(from, to);
    list.forEach((s) => (calSchedules[s.schedule_date] = calSchedules[s.schedule_date] || []).push(s));
  } catch (err) {
    console.error(err);
  }

  const firstDow = new Date(y, m, 1).getDay(); // 0=일
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = fmt(new Date());
  let cells = "";
  for (let i = 0; i < firstDow; i++) cells += `<div class="cal-cell blank"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = fmt(new Date(y, m, d));
    const dow = new Date(y, m, d).getDay();
    const scheds = calSchedules[date] || [];
    const shown = scheds.slice(0, 2)
      .map((s) => {
        const tm = s.schedule_time ? `<b>${esc(s.schedule_time)}</b> ` : "";
        return `<div class="cal-sched" title="${esc((s.schedule_time ? s.schedule_time + " " : "") + s.title)}">${tm}${esc(s.title)}</div>`;
      })
      .join("");
    const more = scheds.length > 2 ? `<div class="cal-more">+${scheds.length - 2}</div>` : "";
    const cls = ["cal-cell"];
    if (date === todayStr) cls.push("today");
    if (dow === 0) cls.push("sun");
    cells += `<div class="${cls.join(" ")}" data-date="${date}">
        <div class="daynum">${d}</div>${shown}${more}
      </div>`;
  }
  $("#cal-grid").innerHTML = cells;
}

// 버튼 여러 개짜리 확인 팝업. buttons: [{label, value, cls}] → 선택한 value 반환
function showChoice(title, msg, buttons) {
  return new Promise((resolve) => {
    $("#confirm-title").textContent = title;
    $("#confirm-msg").textContent = msg;
    const box = $("#confirm-actions");
    box.innerHTML = `<span class="spacer"></span>` +
      buttons.map((b, i) => `<button type="button" data-i="${i}" class="${b.cls || ""}">${esc(b.label)}</button>`).join("");
    const modal = $("#confirm-modal");
    modal.hidden = false;
    const done = (value) => {
      box.removeEventListener("click", onBtn);
      modal.removeEventListener("click", onBackdrop);
      modal.hidden = true;
      resolve(value);
    };
    const onBtn = (e) => {
      const btn = e.target.closest("button[data-i]");
      if (btn) done(buttons[Number(btn.dataset.i)].value);
    };
    const onBackdrop = (e) => { if (e.target.id === "confirm-modal") done(null); };
    box.addEventListener("click", onBtn);
    modal.addEventListener("click", onBackdrop);
  });
}

// 일정 모달
function openSched(date) {
  $("#s-date").value = date;
  const d = parse(date);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  $("#sched-modal-title").textContent = `${date} (${weekday}) 일정`;
  renderSchedList(date);
  $("#sched-modal").hidden = false;
  $("#s-title").value = "";
  $("#s-time").value = "";
  $("#s-project").value = "";
  $("#s-title").focus();
}
function closeSched() { $("#sched-modal").hidden = true; }

function renderSchedList(date) {
  const scheds = calSchedules[date] || [];
  const ul = $("#sched-list");
  if (!scheds.length) {
    ul.innerHTML = `<li class="none">등록된 일정이 없습니다.</li>`;
    return;
  }
  ul.innerHTML = scheds
    .map((s) => {
      const todoBtn = s.todo_count > 0
        ? `<button class="sched-totodo linked" disabled>✓ 할일 있음</button>`
        : `<button class="sched-totodo">할일로 추가</button>`;
      const tm = s.schedule_time ? `<span class="sched-time">${esc(s.schedule_time)}</span>` : "";
      const pname = projectName(s.project_id);
      const proj = pname ? `<span class="sched-proj">📁 ${esc(pname)}</span>` : "";
      return `<li data-id="${s.id}">${tm}<span class="txt">${esc(s.title)}</span>${proj}${todoBtn}<button class="sched-edit">수정</button><button class="danger del-sched">삭제</button></li>`;
    })
    .join("");
}

$("#cal-prev").addEventListener("click", () => { calRef = new Date(calRef.getFullYear(), calRef.getMonth() - 1, 1); calRefresh(); });
$("#cal-next").addEventListener("click", () => { calRef = new Date(calRef.getFullYear(), calRef.getMonth() + 1, 1); calRefresh(); });
$("#cal-today").addEventListener("click", () => { calRef = new Date(); calRefresh(); });

$("#cal-grid").addEventListener("click", (e) => {
  const cell = e.target.closest(".cal-cell");
  if (!cell || cell.classList.contains("blank")) return;
  openSched(cell.dataset.date);
});

$("#sched-close").addEventListener("click", closeSched);
$("#sched-modal").addEventListener("click", (e) => { if (e.target.id === "sched-modal") closeSched(); });

$("#sched-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = $("#s-date").value;
  const title = $("#s-title").value.trim();
  const time = normalizeTime($("#s-time").value);
  const project_id = $("#s-project").value || null;
  if (!title) return;
  if (time === null) { alert("시간 형식이 올바르지 않습니다. 예: 14:30"); $("#s-time").focus(); return; }
  try {
    await addSchedule(date, title, time, project_id);
    $("#s-title").value = "";
    $("#s-time").value = "";
    $("#s-project").value = "";
    await calRefresh();      // 서버에서 todo_count 포함해 다시 로드
    renderSchedList(date);   // 모달 목록도 갱신(연동 할일 반영)
    loadTodos();             // 자동 생성된 할일 반영
    $("#s-title").focus();
  } catch (err) {
    alert(err.message);
  }
});

$("#sched-list").addEventListener("click", async (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  const id = Number(li.dataset.id);
  const date = $("#s-date").value;

  // 삭제 (연동 할일 있으면 함께 삭제할지 확인)
  if (e.target.classList.contains("del-sched")) {
    const sched = (calSchedules[date] || []).find((s) => s.id === id);
    let cascade = false;
    if (sched && sched.todo_count > 0) {
      const choice = await showChoice(
        "일정 삭제",
        "이 일정에 연결된 할일이 있습니다. 할일도 함께 삭제할까요?",
        [
          { label: "취소", value: "cancel" },
          { label: "일정만 삭제", value: "schedule" },
          { label: "할일도 함께 삭제", value: "both", cls: "danger" },
        ]
      );
      if (choice === "cancel" || choice === null) return;
      cascade = choice === "both";
    } else {
      if (!confirm("이 일정을 삭제할까요?")) return;
    }
    try {
      await removeSchedule(id, cascade);
      await calRefresh();
      renderSchedList(date);
      loadTodos();   // 할일 변경 반영
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  // 할일로 추가
  if (e.target.classList.contains("sched-totodo")) {
    const sched = (calSchedules[date] || []).find((s) => s.id === id);
    if (!sched) return;
    try {
      await scheduleToTodo(id, sched.title, date);
      sched.todo_count = (sched.todo_count || 0) + 1;
      renderSchedList(date);
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  // 수정 시작 → 인라인 입력으로 전환
  if (e.target.classList.contains("sched-edit")) {
    const sched = (calSchedules[date] || []).find((s) => s.id === id);
    if (!sched) return;
    li.classList.add("editing");
    li.innerHTML =
      `<input type="text" class="sched-edit-time s-time-input" placeholder="예: 14:30" autocomplete="off" inputmode="numeric" value="${esc(sched.schedule_time || "")}" />` +
      `<input type="text" class="sched-edit-input" value="${esc(sched.title)}" />` +
      `<button type="button" class="primary sched-save">저장</button>` +
      `<button type="button" class="sched-cancel">취소</button>`;
    const inp = li.querySelector(".sched-edit-input");
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    return;
  }

  // 수정 취소
  if (e.target.classList.contains("sched-cancel")) {
    renderSchedList(date);
    return;
  }

  // 수정 저장
  if (e.target.classList.contains("sched-save")) {
    const inp = li.querySelector(".sched-edit-input");
    const time = normalizeTime(li.querySelector(".sched-edit-time").value);
    const title = inp.value.trim();
    if (!title) { inp.focus(); return; }
    if (time === null) { alert("시간 형식이 올바르지 않습니다. 예: 14:30"); return; }
    try {
      const updated = await updateSchedule(id, title, time);
      const arr = calSchedules[date] || [];
      const idx = arr.findIndex((s) => s.id === id);
      if (idx >= 0) arr[idx] = updated;
      renderSchedList(date);
      calRefresh();
    } catch (err) {
      alert(err.message);
    }
    return;
  }
});

// 수정 입력칸에서 Enter → 저장
$("#sched-list").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("sched-edit-input")) {
    e.preventDefault();
    e.target.closest("li").querySelector(".sched-save").click();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeModal(); closeSched(); }
});

// ===== 프로젝트 =====
async function loadProjects() {
  try {
    const res = await fetch("/api/projects");
    projects = await res.json();
  } catch (err) {
    projects = [];
  }
  populateProjectSelects();
  renderProjects();
}

// 일지·할 일 폼의 프로젝트 셀렉트 채우기 (선택값 유지)
function populateProjectSelects() {
  const opts = `<option value="">프로젝트 없음</option>` +
    projects.filter((p) => p.status === "active")
      .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
      .join("");
  ["#f-project", "#t-project", "#s-project"].forEach((sel) => {
    const el = $(sel);
    const cur = el.value;
    el.innerHTML = opts;
    el.value = cur;
  });
}

function renderProjects() {
  const box = $("#projects-list");
  if (!projects.length) {
    box.innerHTML = `<div class="empty">아직 프로젝트가 없습니다. 위에서 추가해 보세요.</div>`;
    return;
  }
  box.innerHTML = projects
    .map((p) => {
      const done = p.status === "done";
      const period = (p.start_date || p.end_date)
        ? `<span class="project-period">📅 ${esc(p.start_date || "?")} ~ ${esc(p.end_date || "?")}</span>`
        : "";
      return `<div class="project ${done ? "done" : ""}" data-id="${p.id}">
          <div class="project-head">
            <span class="project-name">${esc(p.name)}</span>
            ${period}
            <span class="project-status ${done ? "s-done" : "s-active"}">${done ? "완료" : "진행중"}</span>
            <span class="spacer"></span>
            <button class="proj-toggle">${done ? "진행중으로" : "완료"}</button>
            <button class="proj-del danger">삭제</button>
          </div>
          <div class="project-entries" hidden></div>
        </div>`;
    })
    .join("");
}

async function loadProjectEntries(id, container) {
  const res = await fetch(`/api/entries?project_id=${id}`);
  const list = await res.json();
  const totalMin = list.reduce((s, e) => s + (Number(e.duration_min) || 0), 0);
  if (!list.length) {
    container.innerHTML = `<div class="pe-empty">연결된 업무가 없습니다. 일지 작성 시 이 프로젝트를 선택하세요.</div>`;
    return;
  }
  container.innerHTML =
    `<div class="pe-total">연결된 업무 ${list.length}건 · 총 ${fmtDuration(totalMin)}</div>` +
    list
      .map((e) => {
        const dur = e.duration_min > 0 ? ` <span class="entry-dur">⏱ ${fmtDuration(e.duration_min)}</span>` : "";
        return `<div class="pe-item"><span class="pe-date">${e.work_date}</span> ${esc(e.title)}${dur}</div>`;
      })
      .join("");
}

$("#project-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#p-name").value.trim();
  if (!name) return;
  const start_date = $("#p-start").value || "";
  const end_date = $("#p-end").value || "";
  if (start_date && end_date && end_date < start_date) {
    alert("종료일이 시작일보다 빠를 수 없습니다.");
    return;
  }
  try {
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, start_date, end_date }),
    });
    $("#p-name").value = "";
    $("#p-start").value = "";
    $("#p-end").value = "";
    await loadProjects();
  } catch (err) {
    alert("프로젝트 추가 실패");
  }
});

$("#projects-list").addEventListener("click", async (e) => {
  const card = e.target.closest(".project");
  if (!card) return;
  const id = card.dataset.id;
  const proj = projects.find((p) => String(p.id) === id);

  if (e.target.classList.contains("proj-del")) {
    if (!confirm("이 프로젝트를 삭제할까요? (연결된 일지·할 일은 유지되고 연결만 해제됩니다)")) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    await loadProjects();
    refresh();
    return;
  }
  if (e.target.classList.contains("proj-toggle")) {
    const newStatus = proj.status === "done" ? "active" : "done";
    await fetch(`/api/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: proj.name, status: newStatus }),
    });
    await loadProjects();
    return;
  }
  // 카드 클릭 → 연결된 업무 펼치기/접기
  const pe = card.querySelector(".project-entries");
  if (pe.hidden) {
    pe.hidden = false;
    pe.innerHTML = `<div class="pe-empty">불러오는 중...</div>`;
    await loadProjectEntries(id, pe);
  } else {
    pe.hidden = true;
  }
});

// ===== 할 일 =====
async function loadTodos() {
  try {
    const res = await fetch("/api/todos");
    const list = await res.json();
    renderTodos(list);
  } catch (err) {
    $("#todos-todo").innerHTML = `<div class="empty">오류: ${esc(err.message)}</div>`;
  }
}

// 상태값 정규화 (구버전 done만 있던 데이터 대비)
function todoStatus(t) {
  return t.status || (t.done ? "done" : "todo");
}

function renderTodos(list) {
  const byStatus = { todo: [], doing: [], done: [] };
  list.forEach((t) => byStatus[todoStatus(t)].push(t));

  const row = (t) => {
    const st = todoStatus(t);
    const pname = projectName(t.project_id);
    const proj = pname ? `<span class="todo-proj">📁 ${esc(pname)}</span>` : "";
    const due = t.due_date ? `<span class="todo-due">📅 ${t.due_date}</span>` : "";
    const link = t.entry_id ? `<span class="todo-link" title="일지와 연결됨">🔗</span>` : "";
    const doneAt = st === "done" && t.completed_at
      ? `<span class="todo-doneat">${t.completed_at.slice(0, 10)} 완료</span>` : "";
    // 상태 변경 버튼 (data-to = 바꿀 상태)
    let actions = "";
    if (st === "todo") actions = `<button class="st-btn" data-to="doing">시작</button><button class="st-btn" data-to="done">완료</button>`;
    else if (st === "doing") actions = `<button class="st-btn" data-to="done">완료</button><button class="st-btn" data-to="todo">되돌리기</button>`;
    else actions = `<button class="st-btn" data-to="doing">되돌리기</button>`;
    return `<div class="todo st-${st}" data-id="${t.id}">
        <span class="todo-title">${esc(t.title)}</span>
        ${due}${proj}${link}${doneAt}
        <span class="spacer"></span>
        ${actions}
        <button class="todo-del danger">삭제</button>
      </div>`;
  };

  $("#todos-todo").innerHTML = byStatus.todo.length
    ? byStatus.todo.map(row).join("")
    : `<div class="empty">할 일이 없습니다. 위에서 추가해 보세요.</div>`;
  $("#todos-doing").innerHTML = byStatus.doing.length
    ? byStatus.doing.map(row).join("")
    : `<div class="empty">진행중인 항목이 없습니다.</div>`;
  $("#todos-done").innerHTML = byStatus.done.length
    ? byStatus.done.map(row).join("")
    : `<div class="empty">아직 완료한 항목이 없습니다.</div>`;
}

$("#todo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("#t-title").value.trim();
  if (!title) return;
  try {
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        due_date: $("#t-due").value || "",
        project_id: $("#t-project").value || null,
      }),
    });
    $("#t-title").value = "";
    $("#t-due").value = fmt(new Date());   // 날짜는 다시 당일로 고정
    $("#t-project").value = "";
    loadTodos();
  } catch (err) {
    alert("할 일 추가 실패");
  }
});

$("#view-todos").addEventListener("click", async (e) => {
  const todo = e.target.closest(".todo");
  if (!todo) return;
  const id = todo.dataset.id;
  if (e.target.classList.contains("st-btn")) {
    const to = e.target.dataset.to;
    await fetch(`/api/todos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: to }),
    });
    loadTodos();
  } else if (e.target.classList.contains("todo-del")) {
    if (!confirm("이 할 일을 삭제할까요?")) return;
    await fetch(`/api/todos/${id}`, { method: "DELETE" });
    loadTodos();
  }
});

// ===== 대시보드 =====
let dashState = { period: "month", ref: new Date() };

// 추이 차트용 버킷 키 생성 (주/월: 일별, 분기/년: 월별)
function timelineBuckets(period, ref) {
  const { from, to } = range(period, ref);
  const keys = [];
  if (period === "week" || period === "month") {
    let d = parse(from);
    const end = parse(to);
    while (d <= end) {
      keys.push({ key: fmt(d), label: String(d.getDate()) });
      d = addDays(d, 1);
    }
  } else {
    let d = parse(from);
    const end = parse(to);
    while (d <= end) {
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      keys.push({ key, label: `${d.getMonth() + 1}월` });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  }
  return keys;
}

// 가로 막대 차트
function renderBars(el, rows, fmtVal) {
  rows = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 10);
  if (!rows.length) {
    el.innerHTML = `<div class="chart-empty">데이터가 없습니다.</div>`;
    return;
  }
  const max = Math.max(...rows.map((r) => r.value));
  el.innerHTML = rows
    .map(
      (r) => `<div class="bar-row">
        <div class="bar-label" title="${esc(r.label)}">${esc(r.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${((r.value / max) * 100).toFixed(1)}%"></div></div>
        <div class="bar-val">${fmtVal(r.value)}</div>
      </div>`
    )
    .join("");
}

// 세로 막대(추이) 차트
function renderColumns(el, buckets) {
  const max = Math.max(1, ...buckets.map((b) => b.value));
  if (!buckets.some((b) => b.value > 0)) {
    el.innerHTML = `<div class="chart-empty">데이터가 없습니다.</div>`;
    return;
  }
  el.innerHTML = buckets
    .map(
      (b) => `<div class="col" title="${b.label}: ${fmtDuration(b.value)}">
        <div class="col-track"><div class="col-fill" style="height:${((b.value / max) * 100).toFixed(1)}%"></div></div>
        <div class="col-label">${esc(b.label)}</div>
      </div>`
    )
    .join("");
}

async function renderDashboard() {
  const { from, to, label } = range(dashState.period, dashState.ref);
  $("#d-label").textContent = label;
  document.querySelectorAll(".dtab").forEach((t) =>
    t.classList.toggle("active", t.dataset.period === dashState.period)
  );

  let entries = [];
  try {
    entries = await fetchEntries(from, to);
  } catch (err) {
    $("#chart-tag-count").innerHTML = `<div class="chart-empty">오류: ${esc(err.message)}</div>`;
    return;
  }

  // 집계
  const tagCount = {};
  const tagTime = {};
  const projTime = {};
  const dayTime = {};
  let totalMin = 0;
  entries.forEach((e) => {
    const dur = Number(e.duration_min) || 0;
    totalMin += dur;
    dayTime[e.work_date] = (dayTime[e.work_date] || 0) + dur;
    const tags = (e.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
    tags.forEach((t) => {
      tagCount[t] = (tagCount[t] || 0) + 1;
      tagTime[t] = (tagTime[t] || 0) + dur;
    });
    const pname = projectName(e.project_id) || "미지정";
    projTime[pname] = (projTime[pname] || 0) + dur;
  });

  // 요약 카드
  const days = new Set(entries.map((e) => e.work_date)).size;
  const cards = [
    { num: entries.length, lbl: "총 일지" },
    { num: fmtDuration(totalMin), lbl: "총 투입시간" },
    { num: days, lbl: "활동한 날" },
    { num: Object.keys(tagCount).length, lbl: "태그 종류" },
  ];
  $("#dash-stats").innerHTML = cards
    .map((c) => `<div class="stat-card"><div class="num">${c.num}</div><div class="lbl">${c.lbl}</div></div>`)
    .join("");

  const toRows = (obj) => Object.entries(obj).map(([label, value]) => ({ label, value }));
  renderBars($("#chart-tag-count"), toRows(tagCount), (v) => `${v}회`);
  renderBars($("#chart-tag-time"), toRows(tagTime), fmtDuration);
  renderBars($("#chart-proj-time"), toRows(projTime), fmtDuration);

  const buckets = timelineBuckets(dashState.period, dashState.ref).map((b) => {
    const value = b.key.length === 7
      ? Object.entries(dayTime).reduce((s, [d, v]) => (d.startsWith(b.key) ? s + v : s), 0)
      : dayTime[b.key] || 0;
    return { label: b.label, value };
  });
  renderColumns($("#chart-trend"), buckets);
}

document.querySelectorAll(".dtab").forEach((t) =>
  t.addEventListener("click", () => { dashState.period = t.dataset.period; renderDashboard(); })
);
$("#d-prev").addEventListener("click", () => { dashState.ref = shift(dashState.period, dashState.ref, -1); renderDashboard(); });
$("#d-next").addEventListener("click", () => { dashState.ref = shift(dashState.period, dashState.ref, 1); renderDashboard(); });
$("#d-today").addEventListener("click", () => { dashState.ref = new Date(); renderDashboard(); });

// ===== 뷰 전환 =====
function switchView(view) {
  document.querySelectorAll(".view-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.view === view)
  );
  $("#view-log").hidden = view !== "log";
  $("#view-projects").hidden = view !== "projects";
  $("#view-todos").hidden = view !== "todos";
  $("#view-dash").hidden = view !== "dash";
  $("#new-btn").hidden = view !== "log";
  if (view === "projects") renderProjects();
  if (view === "todos") loadTodos();
  if (view === "dash") renderDashboard();
}
document.querySelectorAll(".view-tab").forEach((t) =>
  t.addEventListener("click", () => switchView(t.dataset.view))
);

// ===== 인증 / 시작 =====
let authMode = "login";   // login | signup

function showAuth() {
  $(".app").hidden = true;
  $("#auth-screen").hidden = false;
  $("#auth-error").hidden = true;
  $("#auth-username").focus();
}

function startApp(me) {
  $("#auth-screen").hidden = true;
  $(".app").hidden = false;
  $("#current-user").textContent = me.username;
  $("#t-due").value = fmt(new Date());   // 할일 마감일 기본값: 당일
  loadProjects().then(() => {
    refresh();           // 일지 뷰 데이터 미리 로드
    switchView("dash");  // 대시보드를 기본 화면으로 바로 표시
  });
  calRefresh();
  loadTags();
}

$("#auth-toggle-btn").addEventListener("click", () => {
  authMode = authMode === "login" ? "signup" : "login";
  const isLogin = authMode === "login";
  $("#auth-sub").textContent = isLogin ? "로그인" : "회원가입";
  $("#auth-submit").textContent = isLogin ? "로그인" : "가입하기";
  $("#auth-toggle-text").textContent = isLogin ? "계정이 없으신가요?" : "이미 계정이 있으신가요?";
  $("#auth-toggle-btn").textContent = isLogin ? "회원가입" : "로그인";
  $("#auth-password").setAttribute("autocomplete", isLogin ? "current-password" : "new-password");
  $("#auth-error").hidden = true;
});

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#auth-username").value.trim();
  const password = $("#auth-password").value;
  const url = authMode === "login" ? "/api/auth/login" : "/api/auth/signup";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "실패했습니다.");
    const me = await res.json();
    $("#auth-password").value = "";
    startApp(me);
  } catch (err) {
    const box = $("#auth-error");
    box.textContent = err.message;
    box.hidden = false;
  }
});

$("#logout-btn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.reload();
});

async function init() {
  try {
    const res = await fetch("/api/auth/me");
    if (res.ok) startApp(await res.json());
    else showAuth();
  } catch {
    showAuth();
  }
}
init();
