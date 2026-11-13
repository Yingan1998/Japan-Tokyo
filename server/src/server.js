require("dotenv").config();

const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { query, withTransaction, initSchema } = require("./db");
const {
  httpError, normalizeEmail, hashPassword, verifyPassword, issueSession, revokeUserSessions,
  revokeSession, requireAuth, requireRoles, createSetupToken, consumeSetupToken,
  assertNotLastAdmin, sanitizeUser
} = require("./auth");
const { DATASETS, configured: sheetsConfigured, readDataset, writeRows, readAllDatasets } = require("./sheets");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const TRIP_ID = process.env.TRIP_ID || "japan-tokyo-2026";
const DATASET_KEYS = Object.keys(DATASETS);

function allowedOrigins() {
  return String(process.env.CORS_ORIGIN || process.env.APP_ORIGIN || "http://localhost:8787")
    .split(",").map(value => value.trim()).filter(Boolean);
}

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins().includes(origin)) return callback(null, true);
    return callback(new Error("CORS origin not allowed"));
  },
  credentials: false
}));
app.use(express.json({ limit: process.env.JSON_LIMIT || "8mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "登入嘗試過於頻繁，請稍後再試。" }
});

function nowIso() { return new Date().toISOString(); }

function cleanRole(role, fallback = "viewer") {
  return ["admin", "editor", "viewer"].includes(role) ? role : fallback;
}

function cleanStatus(status, fallback = "active") {
  return ["active", "disabled"].includes(status) ? status : fallback;
}

function requestId(req) {
  return req.headers["x-request-id"] || crypto.randomUUID();
}

async function audit(action, actorUserId, details = {}, targetUserId = null, tripId = null) {
  await query(
    `INSERT INTO audit_log (actor_user_id, action, target_user_id, trip_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorUserId || null, action, targetUserId || null, tripId || null, JSON.stringify(details)]
  );
}

async function findTrip(tripId) {
  const result = await query(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  return result.rows[0] || null;
}

async function getTripAccess(userId, tripId) {
  const result = await query(
    `SELECT tm.role AS trip_role, t.* FROM trip_members tm JOIN trips t ON t.id = tm.trip_id
      WHERE tm.user_id = $1 AND tm.trip_id = $2`,
    [userId, tripId]
  );
  return result.rows[0] || null;
}

function requireTripRoles(...roles) {
  return async (req, res, next) => {
    try {
      const tripId = String(req.params.tripId || "");
      const trip = await getTripAccess(req.user.id, tripId);
      if (!trip) return res.status(403).json({ error: "TRIP_FORBIDDEN", message: "目前帳號沒有這趟旅程的存取權限。" });
      if (roles.length && !roles.includes(req.user.role) && !roles.includes(trip.trip_role)) {
        return res.status(403).json({ error: "TRIP_FORBIDDEN", message: "目前帳號只能查看，不能修改這趟旅程。" });
      }
      req.trip = trip;
      req.tripRole = req.user.role === "admin" ? "admin" : trip.trip_role;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function datasetOrThrow(dataset) {
  if (!DATASET_KEYS.includes(dataset)) throw httpError(400, `不支援的資料集：${dataset}`);
  return dataset;
}

async function getRevision(clientOrPool, tripId, dataset, forUpdate = false) {
  const db = clientOrPool || { query };
  await db.query(
    `INSERT INTO dataset_revisions (trip_id, dataset, revision) VALUES ($1, $2, 0)
     ON CONFLICT (trip_id, dataset) DO NOTHING`,
    [tripId, dataset]
  );
  const result = await db.query(
    `SELECT revision FROM dataset_revisions WHERE trip_id = $1 AND dataset = $2${forUpdate ? " FOR UPDATE" : ""}`,
    [tripId, dataset]
  );
  return Number(result.rows[0]?.revision || 0);
}

async function revisionsForTrip(tripId) {
  const result = await query(`SELECT dataset, revision, updated_at FROM dataset_revisions WHERE trip_id = $1`, [tripId]);
  return Object.fromEntries(DATASET_KEYS.map(dataset => {
    const row = result.rows.find(item => item.dataset === dataset);
    return [dataset, { revision: Number(row?.revision || 0), updatedAt: row?.updated_at || null }];
  }));
}

function payloadRecord(record) {
  return record && typeof record === "object" ? record : {};
}

async function syncDatasetInternal({ tripId, dataset, records, expectedRevision, actorUserId }) {
  datasetOrThrow(dataset);
  if (!Array.isArray(records)) throw httpError(400, "records 必須是陣列。");
  const incoming = records.filter(item => item && typeof item === "object" && String(item.id || "").trim());
  const duplicateIds = incoming.map(item => String(item.id)).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) throw httpError(400, "資料中有重複 ID。", { ids: [...new Set(duplicateIds)] });

  return withTransaction(async client => {
    const revision = await getRevision(client, tripId, dataset, true);
    if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== revision) {
      const error = httpError(409, "資料版本已更新，請先重新載入再儲存。", { dataset, expectedRevision: Number(expectedRevision), currentRevision: revision });
      error.code = "REVISION_CONFLICT";
      throw error;
    }

    const current = await readDataset(dataset);
    const currentById = new Map(current.map(item => [String(item.id), item]));
    const conflicts = [];
    const updatedAt = nowIso();
    const nextRows = [];
    for (const item of incoming) {
      const id = String(item.id);
      const existing = currentById.get(id);
      if (existing) {
        const expectedItemVersion = Number(item._cloudVersion || 0);
        if (expectedItemVersion !== Number(existing._cloudVersion || 0)) {
          conflicts.push({ id, expectedVersion: expectedItemVersion, currentVersion: Number(existing._cloudVersion || 0) });
          continue;
        }
      }
      nextRows.push({
        id,
        version: existing ? Number(existing._cloudVersion || 0) + 1 : 1,
        updatedAt,
        updatedBy: actorUserId,
        deletedAt: "",
        payload: payloadRecord(item)
      });
    }
    if (conflicts.length) {
      const error = httpError(409, "同一筆資料已被其他旅伴修改，請重新載入。", { dataset, conflicts });
      error.code = "RECORD_CONFLICT";
      throw error;
    }

    const incomingIds = new Set(incoming.map(item => String(item.id)));
    for (const existing of current) {
      if (incomingIds.has(String(existing.id))) continue;
      nextRows.push({
        id: String(existing.id),
        version: Number(existing._cloudVersion || 0) + 1,
        updatedAt,
        updatedBy: actorUserId,
        deletedAt: updatedAt,
        payload: existing
      });
    }
    await writeRows(dataset, nextRows);
    const nextRevision = revision + 1;
    await client.query(
      `UPDATE dataset_revisions SET revision = $1, updated_at = NOW(), updated_by = $2
        WHERE trip_id = $3 AND dataset = $4`,
      [nextRevision, actorUserId, tripId, dataset]
    );
    await audit("dataset.updated", actorUserId, { dataset, revision: nextRevision, count: incoming.length }, null, tripId);
    return { dataset, revision: nextRevision, records: nextRows.filter(row => !row.deletedAt).map(row => ({ ...row.payload, id: row.id, _cloudVersion: row.version, _cloudUpdatedAt: row.updatedAt, _cloudUpdatedBy: row.updatedBy })) };
  });
}

app.get("/api/health", async (req, res, next) => {
  try {
    await query("SELECT 1");
    res.json({ ok: true, service: "japan-tokyo-api", database: true, sheetsConfigured: sheetsConfigured(), requestId: requestId(req) });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", authLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const result = await query(`SELECT * FROM users WHERE email = $1`, [email]);
    const user = result.rows[0];
    if (!user || user.status !== "active" || !(await verifyPassword(user.password_hash, password))) {
      return res.status(401).json({ error: "INVALID_LOGIN", message: "Email 或密碼錯誤，或帳號已停用。" });
    }
    const session = await issueSession(user.id);
    await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
    await audit("auth.login", user.id, { requestId: requestId(req) });
    res.json({ token: session.token, expiresAt: session.expiresAt, user: sanitizeUser(user) });
  } catch (error) { next(error); }
});

app.post("/api/auth/logout", requireAuth, async (req, res, next) => {
  try {
    await revokeSession(req.authToken);
    await audit("auth.logout", req.user.id, { requestId: requestId(req) });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: sanitizeUser(req.user) }));

app.post("/api/auth/setup-password", authLimiter, async (req, res, next) => {
  try {
    const purpose = req.body?.purpose === "password_reset" ? "password_reset" : "first_setup";
    const userId = await consumeSetupToken(String(req.body?.token || ""), purpose, req.body?.password);
    const session = await issueSession(userId);
    const result = await query(`SELECT * FROM users WHERE id = $1`, [userId]);
    await audit("auth.password_set", userId, { purpose });
    res.json({ token: session.token, expiresAt: session.expiresAt, user: sanitizeUser(result.rows[0]) });
  } catch (error) { next(error); }
});

app.post("/api/auth/change-password", requireAuth, async (req, res, next) => {
  try {
    if (!(await verifyPassword(req.user.password_hash, req.body?.currentPassword))) throw httpError(400, "目前密碼不正確。");
    const passwordHash = await hashPassword(req.body?.newPassword);
    await query(`UPDATE users SET password_hash = $1, password_version = password_version + 1, updated_at = NOW() WHERE id = $2`, [passwordHash, req.user.id]);
    await revokeUserSessions(req.user.id);
    const session = await issueSession(req.user.id);
    await audit("auth.password_changed", req.user.id, {});
    res.json({ token: session.token, expiresAt: session.expiresAt, user: sanitizeUser({ ...req.user, password_hash: passwordHash }) });
  } catch (error) { next(error); }
});

app.get("/api/admin/users", requireAuth, requireRoles("admin"), async (req, res, next) => {
  try {
    const result = await query(`SELECT * FROM users ORDER BY created_at ASC`);
    res.json({ users: result.rows.map(sanitizeUser) });
  } catch (error) { next(error); }
});

app.post("/api/admin/users", requireAuth, requireRoles("admin"), async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const role = cleanRole(req.body?.role, "viewer");
    if (!name || !email || !email.includes("@")) throw httpError(400, "請提供姓名與有效 Email。");
    const id = crypto.randomUUID();
    await query(`INSERT INTO users (id, name, email, role, status) VALUES ($1, $2, $3, $4, 'active')`, [id, name, email, role]);
    await query(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [TRIP_ID, id, role]);
    const setup = await createSetupToken(id, "first_setup", req.user.id);
    await audit("admin.user_created", req.user.id, { email, role, setupExpiresAt: setup.expiresAt }, id, TRIP_ID);
    const user = (await query(`SELECT * FROM users WHERE id = $1`, [id])).rows[0];
    res.status(201).json({ user: sanitizeUser(user), setupUrl: setup.url, expiresAt: setup.expiresAt });
  } catch (error) {
    if (error.code === "23505") error = httpError(409, "這個 Email 已經存在。");
    next(error);
  }
});

app.patch("/api/admin/users/:userId", requireAuth, requireRoles("admin"), async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const currentResult = await query(`SELECT * FROM users WHERE id = $1`, [userId]);
    const current = currentResult.rows[0];
    if (!current) throw httpError(404, "找不到帳號。");
    const role = cleanRole(req.body?.role, current.role);
    const status = cleanStatus(req.body?.status, current.status);
    await assertNotLastAdmin(userId, role, status);
    const name = String(req.body?.name ?? current.name).trim();
    const email = normalizeEmail(req.body?.email ?? current.email);
    await query(`UPDATE users SET name = $1, email = $2, role = $3, status = $4, updated_at = NOW() WHERE id = $5`, [name, email, role, status, userId]);
    await query(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (trip_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`, [TRIP_ID, userId, role]);
    if (status === "disabled" || role !== current.role) await revokeUserSessions(userId);
    await audit("admin.user_updated", req.user.id, { before: { name: current.name, email: current.email, role: current.role, status: current.status }, after: { name, email, role, status } }, userId, TRIP_ID);
    const user = (await query(`SELECT * FROM users WHERE id = $1`, [userId])).rows[0];
    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    if (error.code === "23505") error = httpError(409, "這個 Email 已經存在。");
    next(error);
  }
});

app.delete("/api/admin/users/:userId", requireAuth, requireRoles("admin"), async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const result = await query(`SELECT * FROM users WHERE id = $1`, [userId]);
    const target = result.rows[0];
    if (!target) throw httpError(404, "找不到帳號。");
    await assertNotLastAdmin(userId, "deleted", "disabled");
    await audit("admin.user_deleted", req.user.id, { deletedEmail: target.email, deletedName: target.name }, null, TRIP_ID);
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post("/api/admin/users/:userId/reset-password", requireAuth, requireRoles("admin"), async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const result = await query(`SELECT * FROM users WHERE id = $1 AND status = 'active'`, [userId]);
    if (!result.rows[0]) throw httpError(404, "找不到啟用中的帳號。");
    await revokeUserSessions(userId);
    const setup = await createSetupToken(userId, "password_reset", req.user.id);
    await audit("admin.password_reset_requested", req.user.id, { expiresAt: setup.expiresAt }, userId, TRIP_ID);
    res.json({ resetUrl: setup.url, expiresAt: setup.expiresAt });
  } catch (error) { next(error); }
});

app.get("/api/trips/:tripId/snapshot", requireAuth, requireTripRoles("admin", "editor", "viewer"), async (req, res, next) => {
  try {
    const [datasets, revisions] = await Promise.all([readAllDatasets(), revisionsForTrip(req.params.tripId)]);
    res.json({ trip: { id: req.trip.id, title: req.trip.title }, datasets, revisions });
  } catch (error) { next(error); }
});

app.put("/api/trips/:tripId/datasets/:dataset", requireAuth, requireTripRoles("admin", "editor"), async (req, res, next) => {
  try {
    const result = await syncDatasetInternal({
      tripId: req.params.tripId,
      dataset: req.params.dataset,
      records: req.body?.records,
      expectedRevision: req.body?.expectedRevision,
      actorUserId: req.user.id
    });
    res.json(result);
  } catch (error) { next(error); }
});

function calculateImportPreview(current, incoming) {
  const currentMap = new Map((current || []).map(item => [String(item.id), item]));
  const incomingMap = new Map((incoming || []).filter(item => item && item.id).map(item => [String(item.id), item]));
  const added = [...incomingMap.keys()].filter(id => !currentMap.has(id)).length;
  const updated = [...incomingMap.keys()].filter(id => currentMap.has(id)).length;
  const removed = [...currentMap.keys()].filter(id => !incomingMap.has(id)).length;
  return { current: currentMap.size, incoming: incomingMap.size, added, updated, removed };
}

app.post("/api/trips/:tripId/import/preview", requireAuth, requireTripRoles("admin", "editor", "viewer"), async (req, res, next) => {
  try {
    const incoming = req.body?.snapshot?.datasets || req.body?.datasets || {};
    const preview = {};
    for (const dataset of DATASET_KEYS) preview[dataset] = calculateImportPreview(await readDataset(dataset), incoming[dataset]);
    res.json({ tripId: req.params.tripId, preview, requiresConfirmation: true });
  } catch (error) { next(error); }
});

app.post("/api/trips/:tripId/import", requireAuth, requireTripRoles("admin", "editor"), async (req, res, next) => {
  try {
    if (req.body?.confirmed !== true) throw httpError(400, "匯入前必須先完成預覽並帶入 confirmed: true。");
    const incoming = req.body?.snapshot?.datasets || req.body?.datasets || {};
    const revisions = req.body?.snapshot?.revisions || req.body?.revisions || {};
    const result = {};
    for (const dataset of DATASET_KEYS) {
      if (!Array.isArray(incoming[dataset])) continue;
      result[dataset] = await syncDatasetInternal({
        tripId: req.params.tripId,
        dataset,
        records: incoming[dataset],
        expectedRevision: revisions[dataset]?.revision,
        actorUserId: req.user.id
      });
    }
    await audit("trip.imported", req.user.id, { datasets: Object.keys(result) }, null, req.params.tripId);
    res.json({ ok: true, result });
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number(error.status || 500);
  if (status >= 500) console.error(`[${requestId(req)}]`, error);
  res.status(status).json({
    error: error.code || "INTERNAL_ERROR",
    message: status >= 500 && process.env.NODE_ENV === "production" ? "伺服器暫時無法完成操作。" : error.message,
    details: error.details
  });
});

initSchema()
  .then(() => app.listen(PORT, () => console.log(`Japan Tokyo API listening on :${PORT}`)))
  .catch(error => {
    console.error("API 啟動失敗：", error.message);
    process.exitCode = 1;
  });

module.exports = app;

