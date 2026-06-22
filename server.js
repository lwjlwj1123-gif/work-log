import "dotenv/config";
import express from "express";
import crypto from "crypto";
import { fileURLToPath } from "url";
import path from "path";
import { db, initDb } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const now = () => new Date().toISOString();

// 시작·종료 시각(HH:MM)으로 소요 시간(분) 자동 계산. 종료가 시작보다 이르면 자정 넘김 처리.
function calcDuration(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some(Number.isNaN)) return 0;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins;
}

// ===== 인증 =====
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.execute({ sql: "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", args: [token, userId, now()] });
  return token;
}
async function getSessionUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const r = await db.execute({
    sql: "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
    args: [sid],
  });
  return r.rows[0] || null;
}

// /api/auth/* 외의 모든 /api 요청은 로그인 필요. req.userId 주입.
app.use("/api", async (req, res, next) => {
  if (req.path.startsWith("/auth/")) return next();
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: "로그인이 필요합니다." });
    req.userId = user.id;
    req.username = user.username;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 회원가입 (누구나). 첫 가입 계정은 기존 데이터를 이어받는다.
app.post("/api/auth/signup", async (req, res) => {
  try {
    const username = (req.body.username || "").trim();
    const password = req.body.password || "";
    if (!username || !password) return res.status(400).json({ error: "아이디와 비밀번호를 입력하세요." });
    if (password.length < 4) return res.status(400).json({ error: "비밀번호는 4자 이상이어야 합니다." });
    const exists = await db.execute({ sql: "SELECT id FROM users WHERE username = ?", args: [username] });
    if (exists.rows.length) return res.status(409).json({ error: "이미 존재하는 아이디입니다." });

    const { salt, hash } = hashPassword(password);
    const result = await db.execute({
      sql: "INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)",
      args: [username, hash, salt, now()],
    });
    const userId = Number(result.lastInsertRowid);

    // 첫 사용자면 주인 없는 기존 데이터를 모두 이전
    const cnt = await db.execute("SELECT COUNT(*) AS c FROM users");
    if (Number(cnt.rows[0].c) === 1) {
      for (const tbl of ["entries", "projects", "todos", "schedules"]) {
        await db.execute({ sql: `UPDATE ${tbl} SET user_id = ? WHERE user_id IS NULL`, args: [userId] });
      }
    }

    const token = await createSession(userId);
    setSessionCookie(res, token);
    res.status(201).json({ id: userId, username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = (req.body.username || "").trim();
    const password = req.body.password || "";
    if (!username || !password) return res.status(400).json({ error: "아이디와 비밀번호를 입력하세요." });
    const r = await db.execute({ sql: "SELECT * FROM users WHERE username = ?", args: [username] });
    const u = r.rows[0];
    if (!u || !verifyPassword(password, u.salt, u.password_hash)) {
      return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    const token = await createSession(u.id);
    setSessionCookie(res, token);
    res.json({ id: u.id, username: u.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const sid = parseCookies(req).sid;
    if (sid) await db.execute({ sql: "DELETE FROM sessions WHERE token = ?", args: [sid] });
    clearSessionCookie(res);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/me", async (req, res) => {
  const u = await getSessionUser(req);
  if (!u) return res.status(401).json({ error: "unauthenticated" });
  res.json({ id: u.id, username: u.username });
});

// ===== 일지 ===== (모두 본인 데이터로 한정)
// 기간 내 일지 목록 (from/to 는 YYYY-MM-DD, 선택값)
app.get("/api/entries", async (req, res) => {
  try {
    const { from, to, project_id } = req.query;
    let sql = "SELECT * FROM entries";
    const args = [];
    const where = ["user_id = ?"];
    args.push(req.userId);
    if (from) { where.push("work_date >= ?"); args.push(from); }
    if (to) { where.push("work_date <= ?"); args.push(to); }
    if (project_id) { where.push("project_id = ?"); args.push(project_id); }
    sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY work_date DESC, id DESC";
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 일지 작성
app.post("/api/entries", async (req, res) => {
  try {
    const { work_date, start_time = "", end_time = "", title, content = "", tags = "", project_id = null } = req.body;
    if (!work_date || !title) {
      return res.status(400).json({ error: "날짜와 제목은 필수입니다." });
    }
    const ts = now();
    const duration_min = calcDuration(start_time, end_time);
    const result = await db.execute({
      sql: `INSERT INTO entries (work_date, start_time, end_time, title, content, tags, project_id, duration_min, user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [work_date, start_time, end_time, title, content, tags, project_id || null, duration_min, req.userId, ts, ts],
    });
    const created = await db.execute({
      sql: "SELECT * FROM entries WHERE id = ?",
      args: [Number(result.lastInsertRowid)],
    });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 일지 수정
app.put("/api/entries/:id", async (req, res) => {
  try {
    const { work_date, start_time = "", end_time = "", title, content = "", tags = "", project_id = null } = req.body;
    if (!work_date || !title) {
      return res.status(400).json({ error: "날짜와 제목은 필수입니다." });
    }
    const duration_min = calcDuration(start_time, end_time);
    await db.execute({
      sql: `UPDATE entries SET work_date = ?, start_time = ?, end_time = ?, title = ?, content = ?, tags = ?, project_id = ?, duration_min = ?, updated_at = ?
            WHERE id = ? AND user_id = ?`,
      args: [work_date, start_time, end_time, title, content, tags, project_id || null, duration_min, now(), req.params.id, req.userId],
    });
    const updated = await db.execute({
      sql: "SELECT * FROM entries WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId],
    });
    if (!updated.rows.length) return res.status(404).json({ error: "없는 일지입니다." });
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 일지 삭제
app.delete("/api/entries/:id", async (req, res) => {
  try {
    await db.execute({
      sql: "DELETE FROM entries WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId],
    });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 지금까지 사용한 태그 목록 (사용 횟수 내림차순) — 자동완성용
app.get("/api/tags", async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT tags FROM entries WHERE tags <> '' AND user_id = ?",
      args: [req.userId],
    });
    const counts = {};
    result.rows.forEach((r) =>
      (r.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .forEach((t) => (counts[t] = (counts[t] || 0) + 1))
    );
    const tags = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 프로젝트 =====
app.get("/api/projects", async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT * FROM projects WHERE user_id = ? ORDER BY (status = 'done'), created_at DESC",
      args: [req.userId],
    });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const { name, start_date = "", end_date = "" } = req.body;
    if (!name) return res.status(400).json({ error: "프로젝트 이름은 필수입니다." });
    const result = await db.execute({
      sql: "INSERT INTO projects (name, status, start_date, end_date, user_id, created_at) VALUES (?, 'active', ?, ?, ?, ?)",
      args: [name, start_date, end_date, req.userId, now()],
    });
    const created = await db.execute({
      sql: "SELECT * FROM projects WHERE id = ?",
      args: [Number(result.lastInsertRowid)],
    });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/projects/:id", async (req, res) => {
  try {
    const cur = await db.execute({ sql: "SELECT * FROM projects WHERE id = ? AND user_id = ?", args: [req.params.id, req.userId] });
    if (!cur.rows.length) return res.status(404).json({ error: "없는 프로젝트입니다." });
    const { name, status } = req.body;
    if (!name || !status) return res.status(400).json({ error: "이름과 상태는 필수입니다." });
    // 보낸 필드만 갱신: 진행 기간은 미전달 시 기존 값 유지
    const start_date = req.body.start_date !== undefined ? req.body.start_date : cur.rows[0].start_date;
    const end_date = req.body.end_date !== undefined ? req.body.end_date : cur.rows[0].end_date;
    await db.execute({
      sql: "UPDATE projects SET name = ?, status = ?, start_date = ?, end_date = ? WHERE id = ? AND user_id = ?",
      args: [name, status, start_date, end_date, req.params.id, req.userId],
    });
    const updated = await db.execute({
      sql: "SELECT * FROM projects WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId],
    });
    if (!updated.rows.length) return res.status(404).json({ error: "없는 프로젝트입니다." });
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    // 연결된 일지·할 일은 프로젝트만 해제 (데이터는 보존)
    await db.execute({ sql: "UPDATE entries SET project_id = NULL WHERE project_id = ? AND user_id = ?", args: [req.params.id, req.userId] });
    await db.execute({ sql: "UPDATE todos SET project_id = NULL WHERE project_id = ? AND user_id = ?", args: [req.params.id, req.userId] });
    await db.execute({ sql: "DELETE FROM projects WHERE id = ? AND user_id = ?", args: [req.params.id, req.userId] });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 할 일 =====
app.get("/api/todos", async (req, res) => {
  try {
    const { status, entry_id } = req.query;
    let sql = "SELECT * FROM todos";
    const args = [];
    const where = ["user_id = ?"];
    args.push(req.userId);
    if (status) { where.push("status = ?"); args.push(status); }
    if (entry_id) { where.push("entry_id = ?"); args.push(entry_id); }
    sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY (status = 'done') ASC, (due_date = '') ASC, due_date ASC, created_at DESC";
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/todos", async (req, res) => {
  try {
    const { title, due_date = "", project_id = null, status = "todo", entry_id = null, schedule_id = null } = req.body;
    if (!title) return res.status(400).json({ error: "할 일 내용은 필수입니다." });
    const done = status === "done" ? 1 : 0;
    const result = await db.execute({
      sql: `INSERT INTO todos (title, due_date, project_id, status, done, entry_id, schedule_id, user_id, created_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [title, due_date, project_id || null, status, done, entry_id || null, schedule_id || null, req.userId, now(), done ? now() : ""],
    });
    const created = await db.execute({
      sql: "SELECT * FROM todos WHERE id = ?",
      args: [Number(result.lastInsertRowid)],
    });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 할 일 수정: 보낸 필드만 갱신 (상태 변경, 일지 연결/해제 등)
app.put("/api/todos/:id", async (req, res) => {
  try {
    const cur = await db.execute({ sql: "SELECT * FROM todos WHERE id = ? AND user_id = ?", args: [req.params.id, req.userId] });
    if (!cur.rows.length) return res.status(404).json({ error: "없는 할 일입니다." });
    const t = cur.rows[0];
    const b = req.body;
    const status = b.status ?? t.status;
    const title = b.title ?? t.title;
    const due_date = b.due_date ?? t.due_date;
    const project_id = b.project_id !== undefined ? b.project_id : t.project_id;
    const entry_id = b.entry_id !== undefined ? b.entry_id : t.entry_id;
    const done = status === "done" ? 1 : 0;
    const completed_at = done ? (t.completed_at || now()) : "";
    await db.execute({
      sql: `UPDATE todos SET title = ?, due_date = ?, project_id = ?, status = ?, done = ?, entry_id = ?, completed_at = ?
            WHERE id = ? AND user_id = ?`,
      args: [title, due_date, project_id || null, status, done, entry_id || null, completed_at, req.params.id, req.userId],
    });
    const updated = await db.execute({
      sql: "SELECT * FROM todos WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId],
    });
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/todos/:id", async (req, res) => {
  try {
    await db.execute({ sql: "DELETE FROM todos WHERE id = ? AND user_id = ?", args: [req.params.id, req.userId] });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 일정 (캘린더) =====
// 기간 내 일정 목록
app.get("/api/schedules", async (req, res) => {
  try {
    const { from, to } = req.query;
    let sql = "SELECT s.*, (SELECT COUNT(*) FROM todos t WHERE t.schedule_id = s.id) AS todo_count FROM schedules s";
    const args = [];
    const where = ["s.user_id = ?"];
    args.push(req.userId);
    if (from) { where.push("s.schedule_date >= ?"); args.push(from); }
    if (to) { where.push("s.schedule_date <= ?"); args.push(to); }
    sql += " WHERE " + where.join(" AND ");
    // 날짜 → 시간 있는 일정 먼저(시간순) → 시간 없는 일정 → 등록순
    sql += " ORDER BY s.schedule_date ASC, (s.schedule_time = '') ASC, s.schedule_time ASC, s.id ASC";
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 일정 추가 (+ 연동 할일 자동 생성)
app.post("/api/schedules", async (req, res) => {
  try {
    const { schedule_date, title, schedule_time = "", project_id = null } = req.body;
    if (!schedule_date || !title) {
      return res.status(400).json({ error: "날짜와 일정 내용은 필수입니다." });
    }
    const ts = now();
    const result = await db.execute({
      sql: `INSERT INTO schedules (schedule_date, schedule_time, title, project_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [schedule_date, schedule_time, title, project_id || null, req.userId, ts],
    });
    const scheduleId = Number(result.lastInsertRowid);
    // 일정 입력과 동시에 연동 할일 생성 (마감일 = 일정 날짜, 프로젝트 연동)
    await db.execute({
      sql: `INSERT INTO todos (title, due_date, project_id, status, done, entry_id, schedule_id, user_id, created_at, completed_at)
            VALUES (?, ?, ?, 'todo', 0, NULL, ?, ?, ?, '')`,
      args: [title, schedule_date, project_id || null, scheduleId, req.userId, ts],
    });
    const created = await db.execute({
      sql: "SELECT s.*, (SELECT COUNT(*) FROM todos t WHERE t.schedule_id = s.id) AS todo_count FROM schedules s WHERE s.id = ?",
      args: [scheduleId],
    });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 일정 수정 (내용)
app.put("/api/schedules/:id", async (req, res) => {
  try {
    const cur = await db.execute({ sql: "SELECT * FROM schedules WHERE id = ? AND user_id = ?", args: [req.params.id, req.userId] });
    if (!cur.rows.length) return res.status(404).json({ error: "없는 일정입니다." });
    const title = req.body.title ?? cur.rows[0].title;
    if (!title) return res.status(400).json({ error: "일정 내용은 필수입니다." });
    const schedule_time = req.body.schedule_time !== undefined ? req.body.schedule_time : cur.rows[0].schedule_time;
    await db.execute({
      sql: "UPDATE schedules SET title = ?, schedule_time = ? WHERE id = ? AND user_id = ?",
      args: [title, schedule_time, req.params.id, req.userId],
    });
    const updated = await db.execute({
      sql: "SELECT * FROM schedules WHERE id = ? AND user_id = ?",
      args: [req.params.id, req.userId],
    });
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 일정 삭제 (cascade=1 이면 연동 할일도 함께 삭제, 아니면 연결만 해제)
app.delete("/api/schedules/:id", async (req, res) => {
  try {
    if (req.query.cascade === "1") {
      await db.execute({ sql: "DELETE FROM todos WHERE schedule_id = ? AND user_id = ?", args: [req.params.id, req.userId] });
    } else {
      await db.execute({ sql: "UPDATE todos SET schedule_id = NULL WHERE schedule_id = ? AND user_id = ?", args: [req.params.id, req.userId] });
    }
    await db.execute({ sql: "DELETE FROM schedules WHERE id = ? AND user_id = ?", args: [req.params.id, req.userId] });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`업무일지 서버 실행 중: http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("DB 초기화 실패:", err);
    process.exit(1);
  });
