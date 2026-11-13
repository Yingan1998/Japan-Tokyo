require("dotenv").config();
const crypto = require("node:crypto");
const { initSchema, query, closeDb } = require("./db");
const { normalizeEmail, hashPassword } = require("./auth");

async function main() {
  await initSchema();
  const existing = await query(`SELECT COUNT(*)::int AS count FROM users`);
  if (Number(existing.rows[0].count) > 0) throw new Error("已存在帳號，bootstrap-admin 不會覆蓋現有使用者。");
  const name = String(process.env.INITIAL_ADMIN_NAME || "旅程管理員").trim();
  const email = normalizeEmail(process.env.INITIAL_ADMIN_EMAIL);
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !email.includes("@") || !password) throw new Error("請先設定 INITIAL_ADMIN_NAME、INITIAL_ADMIN_EMAIL、INITIAL_ADMIN_PASSWORD。");
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await query(`INSERT INTO users (id, name, email, role, status, password_hash) VALUES ($1, $2, $3, 'admin', 'active', $4)`, [id, name, email, passwordHash]);
  if (process.env.TRIP_ID) {
    await query(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`, [process.env.TRIP_ID, id]);
  }
  console.log(`Created initial admin: ${email}`);
}

main()
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => closeDb());

