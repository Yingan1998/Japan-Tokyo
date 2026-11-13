# Firestore 移轉狀態

盤點日期：2026-11-13

## 已完成

- 已保留 `index(20261113-004507).html`：這是本工作區在加入 Firestore 前的原版快照；使用者指定的同名原始附件未出現在目前可讀取的工作區，因此未假稱已取得外部版本。
- 新版 `index.html` 已加入 Firebase Web App 設定入口與 Firestore adapter。
- 已填入 `japan-tokyo-38679` 的 Firebase Web App 公開設定（不含私鑰）。
- 新版仍保留原有 UI、A／B 行程、地圖、票券、住宿、記帳、分帳與本機備份。
- Firestore adapter 預設使用六個資料集：
  - `itinerary`
  - `tickets`
  - `flights`
  - `accommodations`
  - `expenses`
  - `reservedExpenses`
- Firestore 文件路徑：
  - `trips/japan-tokyo-2026/datasets/itinerary`
  - `trips/japan-tokyo-2026/datasets/tickets`
  - `trips/japan-tokyo-2026/datasets/flights`
  - `trips/japan-tokyo-2026/datasets/accommodations`
  - `trips/japan-tokyo-2026/datasets/expenses`
  - `trips/japan-tokyo-2026/datasets/reservedExpenses`
- 已新增 `firestore.rules`：未登入、非成員不能讀寫；檢視者不能寫入；成員文件不能由前端自行修改。
- 已新增 `firebase-migration/`，支援預覽、`--apply` 寫入、既有文件衝突保留與寫入後讀回比對。

## 尚未執行的實際步驟

目前工作區找不到使用者指定的：

- `tokyo_firestore_migration.zip`
- `tokyo_trip_html_backup.json`
- `index(20261113-004507).html` 原始附件

本機也沒有可用的 `node`、`npm`、`firebase`、`gcloud` CLI、Google Application Default Credentials 或 Firebase Admin 憑證。因此本次沒有偽造「已寫入 Firestore」或「已驗證登入」結果。

## 需要手動完成

1. 在 Firebase Console 的 `japan-tokyo-38679` 專案啟用 Authentication > Email/Password。
2. Web App 公開設定已填入 `firebase-config.js`；若日後更換 Web App，才需要更新此檔，不要填服務帳號私鑰。
3. 建立首位管理員 Firebase Auth 帳號，並由可信任的 Console／Admin SDK 建立：
   `trips/japan-tokyo-2026/members/{uid}`，欄位至少包含 `name`、`email`、`role: "admin"`、`status: "active"`。
4. 安裝 Node.js 20+，在 `firebase-migration` 執行 `npm install`。
5. 放入最新 App JSON 備份，先執行預覽：

   ```powershell
   node migrate.mjs C:\path\to\backup.json
   ```

6. 使用已授權的 Google Cloud 身分登入 Application Default Credentials：

   ```powershell
   gcloud auth application-default login
   $env:GOOGLE_CLOUD_PROJECT="japan-tokyo-38679"
   ```

7. 預覽確認無誤後執行：

   ```powershell
   node migrate.mjs C:\path\to\backup.json --apply
   ```

8. Firebase Console Rules 頁面部署 `firestore.rules`，再以測試帳號驗證檢視者／編輯者權限。

## 驗收結果

| 項目 | 結果 |
| --- | --- |
| 已保留原版 App | 已完成 |
| 新版 Firebase／Firestore 接線 | 已完成，已填 Web App config；待啟用登入與建立管理員 |
| 移轉工具預覽 | 已完成程式，尚缺備份檔與 Node 執行環境 |
| 實際寫入 Firestore | 尚未執行，缺少備份檔與 Google Cloud 授權 |
| 真實 Firebase 登入 | 尚未執行，缺少 Web App config 與首位管理員 |
| 讀取已匯入行程 | 尚未執行，需先完成移轉 |
| 受權限控制的寫入 | 規則與 adapter 已完成，需用真實帳號驗證 |

