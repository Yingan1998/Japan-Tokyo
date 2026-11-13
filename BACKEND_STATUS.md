# 2026 東京九天八夜 App：雲端登入與資料儲存盤點

## 已完成

- 現有架構已盤點：原本是 GitHub Pages 單一 `index.html` + PWA，資料只存瀏覽器 `localStorage`，沒有 Firebase、Google Apps Script 或既有 API。
- 新增 `server/`：Node.js 20 + Express API、PostgreSQL 帳號／Session／版本資料庫、Google Sheets 私有旅程資料同步。
- 新增登入、登出、首次設定密碼、一次性重設密碼、修改密碼與管理員旅伴管理 API。
- 密碼只存 Argon2id 雜湊；Session、重設 Token 與密碼雜湊不會寫入 Google 試算表。
- 角色權限：`admin` 可管理帳號與旅程、`editor` 可修改共用旅程、`viewer` 只能讀取；停用或重設密碼會撤銷既有 Session。
- Google Sheet 每筆資料有固定 `id`、`version`、`updated_at`、`updated_by`、`deleted_at`、`payload_json`；寫入時會檢查資料集 revision 與單筆版本，衝突回傳 HTTP 409。
- 匯入提供 `/import/preview` 預覽，必須再用 `confirmed: true` 才會寫入。
- 前端保留既有畫面與 `localStorage` 格式；設定 `api-config.js` 後可在資訊頁登入、上傳或拉回私人試算表資料。

## 待填設定／尚未實際驗證

- 尚未取得實際 Google Spreadsheet ID、Service Account JSON、PostgreSQL 連線與正式 API 主機，因此尚未執行真實登入及試算表寫入驗收。
- 請依 `server/DEPLOYMENT.md` 設定 `.env`，執行 migration 與首次管理員 bootstrap，再把正式 API 網址填入 `api-config.js`。
- GitHub Pages 只負責靜態前端；`server/` 需部署到具持久 PostgreSQL 的 Node.js 主機，不能只靠 GitHub Pages 執行。

## 驗收項目

- 管理員建立／查詢／更新／停用／恢復／刪除旅伴，並產生一次性設定或重設連結。
- 旅伴首次設定密碼、登入、登出與修改密碼。
- Viewer 直接呼叫資料寫入 API 應得到 403；停用帳號後原 Session 應得到 401。
- 行程、票券、航班住宿、清單、費用、分帳與每日預算可同步到指定工作表，匯入舊資料先預覽並能偵測版本衝突。

