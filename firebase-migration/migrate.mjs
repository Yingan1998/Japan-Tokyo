import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "japan-tokyo-38679";
const TRIP_ID = "japan-tokyo-2026";
const DATASETS = ["itinerary", "tickets", "flights", "accommodations", "expenses", "reservedExpenses"];
const applyMode = process.argv.includes("--apply");
const inputPath = process.argv.slice(2).find(arg => !arg.startsWith("--"));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stable(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function idFor(dataset, item, index) {
  if (item && typeof item === "object" && item.id) return String(item.id);
  const key = item && typeof item === "object" ? JSON.stringify(stable(item)) : String(item);
  return `${dataset}-${index + 1}-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 10)}`;
}

function recordsFor(dataset, value) {
  if (dataset === "itinerary") {
    const data = value && typeof value === "object" ? value : {};
    return [{ id: "trip-state", data, _cloudVersion: 1 }];
  }
  const list = Array.isArray(value) ? value : [];
  return list.map((item, index) => ({
    ...(item && typeof item === "object" ? item : { value: item }),
    id: idFor(dataset, item, index),
    _cloudVersion: 1
  }));
}

function readDatasetSource(payload, dataset) {
  const source = payload?.datasets || payload || {};
  if (dataset === "itinerary") return source.itinerary || source.data || {};
  if (dataset === "reservedExpenses") return source.reservedExpenses || source.reserved_expenses || [];
  return source[dataset] || [];
}

function normalizePayload(payload) {
  const datasets = Object.fromEntries(DATASETS.map(dataset => [dataset, recordsFor(dataset, readDatasetSource(payload, dataset))]));
  return {
    format: payload?.format || "unknown",
    exportedAt: payload?.exportedAt || null,
    tripId: TRIP_ID,
    datasets
  };
}

function preview(normalized, sourcePath) {
  const itinerary = normalized.datasets.itinerary[0]?.data || {};
  const versions = itinerary.versions || {};
  const daysA = Array.isArray(versions.A?.days) ? versions.A.days.length : Array.isArray(itinerary.days) ? itinerary.days.length : 0;
  const daysB = Array.isArray(versions.B?.days) ? versions.B.days.length : 0;
  const counts = Object.fromEntries(DATASETS.map(dataset => [dataset, normalized.datasets[dataset].length]));
  const expected = {
    daysA: 9,
    daysB: 9,
    tickets: 3,
    flights: 2,
    accommodations: 2,
    expenses: 0,
    reservedExpenses: 3
  };
  const warnings = [];
  if (daysA !== expected.daysA || daysB !== expected.daysB) warnings.push(`A/B 行程天數為 ${daysA}/${daysB}，預期 9/9。`);
  for (const dataset of DATASETS) {
    if (dataset === "itinerary") continue;
    if (counts[dataset] !== expected[dataset]) warnings.push(`${dataset} 筆數為 ${counts[dataset]}，預期 ${expected[dataset]}。`);
  }
  return {
    sourcePath: path.resolve(sourcePath),
    projectId: PROJECT_ID,
    tripId: TRIP_ID,
    format: normalized.format,
    exportedAt: normalized.exportedAt,
    itinerary: { records: counts.itinerary, daysA, daysB },
    counts,
    expected,
    warnings,
    datasetDigests: Object.fromEntries(DATASETS.map(dataset => [dataset, digest(normalized.datasets[dataset])]))
  };
}

async function loadAdmin() {
  try {
    return await import("firebase-admin");
  } catch (error) {
    throw new Error(`找不到 firebase-admin。請先在 firebase-migration 執行 npm install。${error.message}`);
  }
}

async function applyMigration(normalized, summary) {
  const admin = await loadAdmin();
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID, credential: admin.credential.applicationDefault() });
  const db = admin.firestore();
  const results = {};
  const conflicts = [];

  for (const dataset of DATASETS) {
    const ref = db.doc(`trips/${TRIP_ID}/datasets/${dataset}`);
    const snapshot = await ref.get();
    if (snapshot.exists) {
      const existing = snapshot.data() || {};
      const existingDigest = digest(existing.records || []);
      const incomingDigest = digest(normalized.datasets[dataset]);
      if (existingDigest !== incomingDigest) {
        conflicts.push({ dataset, path: ref.path, existingDigest, incomingDigest, action: "preserved_cloud_version" });
        results[dataset] = { path: ref.path, status: "conflict-preserved", existingRecords: Array.isArray(existing.records) ? existing.records.length : 0 };
        continue;
      }
      results[dataset] = { path: ref.path, status: "already-identical", records: Array.isArray(existing.records) ? existing.records.length : 0 };
      continue;
    }
    await ref.set({
      tripId: TRIP_ID,
      dataset,
      revision: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: "migration",
      records: normalized.datasets[dataset]
    });
    results[dataset] = { path: ref.path, status: "written", records: normalized.datasets[dataset].length };
  }

  const readback = {};
  for (const dataset of DATASETS) {
    const ref = db.doc(`trips/${TRIP_ID}/datasets/${dataset}`);
    const snapshot = await ref.get();
    const records = snapshot.exists && Array.isArray(snapshot.data()?.records) ? snapshot.data().records : [];
    readback[dataset] = {
      path: ref.path,
      exists: snapshot.exists,
      records: records.length,
      matchesInput: digest(records) === digest(normalized.datasets[dataset])
    };
  }
  return { summary, results, conflicts, readback };
}

if (!inputPath) {
  console.error("用法：node migrate.mjs <備份檔路徑> [--apply]");
  process.exitCode = 2;
} else {
  try {
    const raw = await fs.readFile(inputPath, "utf8");
    const payload = JSON.parse(raw);
    const normalized = normalizePayload(payload);
    const summary = preview(normalized, inputPath);
    console.log(JSON.stringify({ mode: applyMode ? "apply" : "preview", ...summary }, null, 2));
    if (summary.warnings.length) console.warn("預覽警告：\n- " + summary.warnings.join("\n- "));
    if (applyMode) {
      const result = await applyMigration(normalized, summary);
      console.log(JSON.stringify({ apply: result }, null, 2));
      if (result.conflicts.length) console.warn("偵測到衝突，已保留 Firestore 原有文件，未覆蓋。\n" + JSON.stringify(result.conflicts, null, 2));
    }
  } catch (error) {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}

