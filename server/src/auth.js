const crypto = require("node:crypto");
const argon2 = require("argon2");
const { query, withTransaction } = require("./db");

const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 30));

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 10) throw httpError(400, "密碼至少需要 10 碼。");
  if (value.length > 200) throw httpError(400, "密碼長度不可超過 200 碼。");
  return value;
}

function httpError(status, message, details = undefined) {
  const error = new Error(message);
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastLoginAt: user.last_login_at || null
  };
}

async function hashPassword(password) {
  return argon2.hash(validatePassword(password), { type: argon2.argon2id });
}

async function verifyPassword(hash, password) {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, String(password || ""));
  } catch {
    return false;
  }
}

async function issueSession(userId) {
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
    [tokenHash, userId, expiresAt]
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

async function revokeUserSessions(userId) {
  await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

async function revokeSession(token) {
  if (token) await query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
}

async function authenticateToken(token) {
  if (!token) return null;
  const result = await query(
    `SELECT u.*, s.token_hash, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [hashToken(token)]
  );
  const row = result.rows[0];
  if (!row || new Date(row.expires_at).getTime() <= Date.now() || row.status !== "active") {
    if (row?.token_hash) await query(`DELETE FROM sessions WHERE token_hash = $1`, [row.token_hash]);
    return null;
  }
  await query(`UPDATE sessions SET last_seen_at = NOW() WHERE token_hash = $1`, [row.token_hash]);
  return row;
}

async function requireAuth(req, res, next) {
  try {
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const user = await authenticateToken(token);
    if (!user) return res.status(401).json({ error: "UNAUTHORIZED", message: "請先登入。" });
    req.authToken = token;
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "目前帳號沒有此操作權限。" });
    }
    next();
  };
}

async function createSetupToken(userId, purpose, createdBy = null) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await withTransaction(async client => {
    await client.query(
      `UPDATE auth_tokens SET used_at = NOW()
        WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
      [userId, purpose]
    );
    await client.query(
      `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [hashToken(token), userId, purpose, expiresAt, createdBy]
    );
  });
  const origin = String(process.env.PUBLIC_APP_ORIGIN || process.env.PUBLIC_API_ORIGIN || process.env.APP_ORIGIN || "").replace(/\/$/, "");
  const path = purpose === "first_setup" ? "/?setup_token=" : "/?reset_token=";
  return { token, expiresAt: expiresAt.toISOString(), url: `${origin}${path}${encodeURIComponent(token)}` };
}

async function consumeSetupToken(token, purpose, newPassword) {
  const tokenHash = hashToken(token);
  const passwordHash = await hashPassword(newPassword);
  return withTransaction(async client => {
    const result = await client.query(
      `SELECT t.*, u.status FROM auth_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.purpose = $2 AND t.used_at IS NULL
          AND t.expires_at > NOW() FOR UPDATE`,
      [tokenHash, purpose]
    );
    const row = result.rows[0];
    if (!row || row.status !== "active") throw httpError(400, "設定連結無效、已使用或已過期。");
    await client.query(
      `UPDATE users SET password_hash = $1, password_version = password_version + 1, updated_at = NOW()
        WHERE id = $2`,
      [passwordHash, row.user_id]
    );
    await client.query(`UPDATE auth_tokens SET used_at = NOW() WHERE token_hash = $1`, [tokenHash]);
    await client.query(`DELETE FROM sessions WHERE user_id = $1`, [row.user_id]);
    return row.user_id;
  });
}

async function assertNotLastAdmin(userId, nextRole, nextStatus) {
  const current = await query(`SELECT role, status FROM users WHERE id = $1`, [userId]);
  const row = current.rows[0];
  if (!row) throw httpError(404, "找不到帳號。");
  const isRemovingAdmin = row.role === "admin" && row.status === "active" && (nextRole !== "admin" || nextStatus !== "active");
  if (!isRemovingAdmin) return;
  const count = await query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND status = 'active'`);
  if (Number(count.rows[0].count) <= 1) throw httpError(400, "不能停用、刪除或降級最後一位啟用中的管理員。");
}

module.exports = {
  SESSION_DAYS,
  httpError,
  normalizeEmail,
  validatePassword,
  hashPassword,
  verifyPassword,
  issueSession,
  revokeUserSessions,
  revokeSession,
  authenticateToken,
  requireAuth,
  requireRoles,
  createSetupToken,
  consumeSetupToken,
  assertNotLastAdmin,
  sanitizeUser
};

