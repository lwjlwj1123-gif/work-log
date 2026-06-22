import { createClient } from "@libsql/client";

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_TOKEN;

if (!url) {
  throw new Error("TURSO_URL 환경변수가 설정되지 않았습니다.");
}

export const db = createClient({ url, authToken });

// 테이블이 없으면 생성한다.
export async function initDb() {
  // 사용자 계정
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL,
      created_at    TEXT NOT NULL
    )
  `);
  // 로그인 세션 (httpOnly 쿠키 토큰)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      work_date  TEXT NOT NULL,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      tags       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_entries_work_date ON entries(work_date)`
  );
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schedules (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_date TEXT NOT NULL,
      schedule_time TEXT NOT NULL DEFAULT '',
      title         TEXT NOT NULL,
      project_id    INTEGER,
      created_at    TEXT NOT NULL
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(schedule_date)`
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS todos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      due_date     TEXT NOT NULL DEFAULT '',
      project_id   INTEGER,
      status       TEXT NOT NULL DEFAULT 'todo',
      done         INTEGER NOT NULL DEFAULT 0,
      entry_id     INTEGER,
      schedule_id  INTEGER,
      created_at   TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT ''
    )
  `);

  // 기존 entries 테이블에 컬럼이 없으면 추가 (마이그레이션)
  const cols = await db.execute(`PRAGMA table_info(entries)`);
  const names = cols.rows.map((c) => c.name);
  if (!names.includes("work_time")) {
    await db.execute(`ALTER TABLE entries ADD COLUMN work_time TEXT NOT NULL DEFAULT ''`);
  }
  if (!names.includes("project_id")) {
    await db.execute(`ALTER TABLE entries ADD COLUMN project_id INTEGER`);
  }
  if (!names.includes("duration_min")) {
    await db.execute(`ALTER TABLE entries ADD COLUMN duration_min INTEGER NOT NULL DEFAULT 0`);
  }
  if (!names.includes("start_time")) {
    await db.execute(`ALTER TABLE entries ADD COLUMN start_time TEXT NOT NULL DEFAULT ''`);
  }
  if (!names.includes("end_time")) {
    await db.execute(`ALTER TABLE entries ADD COLUMN end_time TEXT NOT NULL DEFAULT ''`);
  }
  if (!names.includes("user_id")) {
    await db.execute(`ALTER TABLE entries ADD COLUMN user_id INTEGER`);
  }

  // projects 테이블 마이그레이션: 사용자 소유
  const pcols = await db.execute(`PRAGMA table_info(projects)`);
  const pnames = pcols.rows.map((c) => c.name);
  if (!pnames.includes("user_id")) {
    await db.execute(`ALTER TABLE projects ADD COLUMN user_id INTEGER`);
  }
  if (!pnames.includes("start_date")) {
    await db.execute(`ALTER TABLE projects ADD COLUMN start_date TEXT NOT NULL DEFAULT ''`);
  }
  if (!pnames.includes("end_date")) {
    await db.execute(`ALTER TABLE projects ADD COLUMN end_date TEXT NOT NULL DEFAULT ''`);
  }
  if (!pnames.includes("tags")) {
    await db.execute(`ALTER TABLE projects ADD COLUMN tags TEXT NOT NULL DEFAULT ''`);
  }

  // todos 테이블 마이그레이션: 진행중 상태 + 일지/일정 연동 컬럼
  const tcols = await db.execute(`PRAGMA table_info(todos)`);
  const tnames = tcols.rows.map((c) => c.name);
  if (!tnames.includes("status")) {
    await db.execute(`ALTER TABLE todos ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'`);
    await db.execute(`UPDATE todos SET status = 'done' WHERE done = 1`);
  }
  if (!tnames.includes("entry_id")) {
    await db.execute(`ALTER TABLE todos ADD COLUMN entry_id INTEGER`);
  }
  if (!tnames.includes("schedule_id")) {
    await db.execute(`ALTER TABLE todos ADD COLUMN schedule_id INTEGER`);
  }
  if (!tnames.includes("user_id")) {
    await db.execute(`ALTER TABLE todos ADD COLUMN user_id INTEGER`);
  }

  // schedules 테이블 마이그레이션: 시간 컬럼
  const scols = await db.execute(`PRAGMA table_info(schedules)`);
  const snames = scols.rows.map((c) => c.name);
  if (!snames.includes("schedule_time")) {
    await db.execute(`ALTER TABLE schedules ADD COLUMN schedule_time TEXT NOT NULL DEFAULT ''`);
  }
  if (!snames.includes("project_id")) {
    await db.execute(`ALTER TABLE schedules ADD COLUMN project_id INTEGER`);
  }
  if (!snames.includes("user_id")) {
    await db.execute(`ALTER TABLE schedules ADD COLUMN user_id INTEGER`);
  }
  if (!snames.includes("tags")) {
    await db.execute(`ALTER TABLE schedules ADD COLUMN tags TEXT NOT NULL DEFAULT ''`);
  }
}
