// 비밀번호 재설정 도구 (로컬 전용)
// 비밀번호를 잊었을 때 데이터는 그대로 두고 비밀번호만 새로 바꾼다.
// 사용법: node --use-system-ca reset-password.mjs <아이디> <새-비밀번호>
// 예)     node --use-system-ca reset-password.mjs lwjlwj1123 mynewpw
import "dotenv/config";
import crypto from "crypto";
import { db } from "./db.js";

async function main() {
  const [, , username, newPassword] = process.argv;

  if (!username || !newPassword) {
    console.error("사용법: node --use-system-ca reset-password.mjs <아이디> <새-비밀번호>");
    return 1;
  }
  if (newPassword.length < 4) {
    console.error("비밀번호는 4자 이상이어야 합니다.");
    return 1;
  }

  const found = await db.execute({ sql: "SELECT id FROM users WHERE username = ?", args: [username] });
  if (!found.rows.length) {
    console.error(`'${username}' 계정을 찾을 수 없습니다.`);
    const all = await db.execute("SELECT username FROM users");
    console.error("등록된 아이디:", all.rows.map((r) => r.username).join(", ") || "(없음)");
    return 1;
  }

  // 서버(server.js)의 hashPassword와 동일한 방식
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(newPassword, salt, 64).toString("hex");
  await db.execute({
    sql: "UPDATE users SET password_hash = ?, salt = ? WHERE username = ?",
    args: [hash, salt, username],
  });

  console.log(`✅ '${username}' 비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.`);
  return 0;
}

process.exitCode = await main();
db.close();
