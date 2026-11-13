const { google } = require("googleapis");

const DATASETS = Object.freeze({
  itinerary: "itineraries",
  flights: "flights",
  accommodations: "accommodations",
  tickets: "tickets",
  shopping: "shopping",
  expenses: "expenses",
  reserved_expenses: "reserved_expenses",
  members: "members",
  completed_items: "completed_items",
  prep_checklist: "prep_checklist",
  companion_notes: "companion_notes",
  settlements: "settlements",
  daily_budgets: "daily_budgets"
});

const HEADERS = ["id", "version", "updated_at", "updated_by", "deleted_at", "payload_json"];
let sheetsClientPromise = null;
let sheetTitles = null;

function configured() {
  return Boolean(process.env.GOOGLE_SHEET_ID && !String(process.env.GOOGLE_SHEET_ID).includes("填入") && process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

function requireConfigured() {
  if (!configured()) {
    const error = new Error("Google Sheets 尚未設定。請填入 GOOGLE_SHEET_ID 與 GOOGLE_SERVICE_ACCOUNT_JSON。");
    error.status = 503;
    error.code = "SHEETS_NOT_CONFIGURED";
    throw error;
  }
}

function parseCredentials() {
  try {
    const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
    const decoded = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const credentials = JSON.parse(decoded);
    if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    return credentials;
  } catch (error) {
    const wrapped = new Error("GOOGLE_SERVICE_ACCOUNT_JSON 不是有效的 JSON 或 base64 JSON。");
    wrapped.status = 500;
    wrapped.code = "SHEETS_CREDENTIALS_INVALID";
    wrapped.cause = error;
    throw wrapped;
  }
}

async function getSheetsClient() {
  requireConfigured();
  if (!sheetsClientPromise) {
    const auth = new google.auth.GoogleAuth({
      credentials: parseCredentials(),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    sheetsClientPromise = auth.getClient().then(authClient => google.sheets({ version: "v4", auth: authClient }));
  }
  return sheetsClientPromise;
}

function titleFor(dataset) {
  const title = DATASETS[dataset] || dataset;
  if (!Object.values(DATASETS).includes(title)) {
    const error = new Error(`不支援的資料集：${dataset}`);
    error.status = 400;
    error.code = "DATASET_NOT_ALLOWED";
    throw error;
  }
  return title;
}

async function ensureSheets() {
  const sheets = await getSheetsClient();
  if (sheetTitles) return sheetTitles;
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    fields: "sheets.properties(sheetId,title)"
  });
  const existing = new Map((meta.data.sheets || []).map(item => [item.properties.title, item.properties.sheetId]));
  const missing = Object.values(DATASETS).filter(title => !existing.has(title));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      requestBody: { requests: missing.map(title => ({ addSheet: { properties: { title } } })) }
    });
    const refreshed = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      fields: "sheets.properties(sheetId,title)"
    });
    sheetTitles = new Map((refreshed.data.sheets || []).map(item => [item.properties.title, item.properties.sheetId]));
  } else {
    sheetTitles = existing;
  }
  for (const title of Object.values(DATASETS)) {
    const range = `'${title.replace(/'/g, "''")}'!A1:F1`;
    const values = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range });
    if (!values.data.values?.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range,
        valueInputOption: "RAW",
        requestBody: { values: [HEADERS] }
      });
    }
  }
  return sheetTitles;
}

function payloadWithoutMeta(record) {
  const source = record && typeof record === "object" ? { ...record } : {};
  delete source._cloudVersion;
  delete source._cloudUpdatedAt;
  delete source._cloudUpdatedBy;
  delete source._deleted;
  return source;
}

async function readDataset(dataset) {
  const title = titleFor(dataset);
  await ensureSheets();
  const sheets = await getSheetsClient();
  const range = `'${title.replace(/'/g, "''")}'!A2:F`;
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range });
  const records = [];
  for (const row of response.data.values || []) {
    if (!row[0]) continue;
    let payload = {};
    try { payload = row[5] ? JSON.parse(row[5]) : {}; } catch { payload = {}; }
    records.push({
      ...payload,
      id: String(row[0]),
      _cloudVersion: Math.max(1, Number(row[1]) || 1),
      _cloudUpdatedAt: row[2] || "",
      _cloudUpdatedBy: row[3] || "",
      _deleted: Boolean(row[4])
    });
  }
  return records.filter(record => !record._deleted);
}

async function writeRows(dataset, rows) {
  const title = titleFor(dataset);
  await ensureSheets();
  const sheets = await getSheetsClient();
  const range = `'${title.replace(/'/g, "''")}'!A:F`;
  const values = [HEADERS, ...rows.map(row => [
    row.id,
    String(row.version),
    row.updatedAt,
    row.updatedBy,
    row.deletedAt || "",
    JSON.stringify(payloadWithoutMeta(row.payload))
  ])];
  await sheets.spreadsheets.values.clear({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range });
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range,
    valueInputOption: "RAW",
    requestBody: { values }
  });
}

async function readAllDatasets() {
  const entries = await Promise.all(Object.keys(DATASETS).map(async dataset => [dataset, await readDataset(dataset)]));
  return Object.fromEntries(entries);
}

module.exports = { DATASETS, configured, ensureSheets, readDataset, writeRows, readAllDatasets, payloadWithoutMeta };

