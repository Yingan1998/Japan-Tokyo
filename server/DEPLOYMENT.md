# 部署與驗收清單

## Google 試算表

1. 建立一份私人 Google 試算表，取得 Spreadsheet ID。
2. 在 Google Cloud 建立 Service Account，啟用 Google Sheets API。
3. 將試算表分享給 Service Account 的 `client_email`，權限設為「編輯者」。
4. 將完整 Service Account JSON 放進 `GOOGLE_SERVICE_ACCOUNT_JSON` 環境變數，不要提交到 GitHub。

## PostgreSQL

建立一個有持久儲存的 PostgreSQL database，填入 `DATABASE_URL`。不要使用 ephemeral filesystem 儲存帳號資料。

## 初次啟動

```powershell
npm install
npm run migrate
npm run bootstrap-admin
npm start
```

`bootstrap-admin` 只在沒有帳號時建立第一位管理員。完成後請移除 `INITIAL_ADMIN_PASSWORD`，再重新部署。

## Frontend

若前端與 API 同網域，使用 `/api`。若前端維持 GitHub Pages，將 `window.__TRAVEL_API_BASE_URL__` 設為 API 的 HTTPS 網址；不能把 Google service account 或 PostgreSQL 連線字串放在前端。設定 `.env` 的 `PUBLIC_APP_ORIGIN` 為 GitHub Pages 前端網址，讓一次性設定／密碼重設連結直接回到 App；`PUBLIC_API_ORIGIN` 僅作為 API 網址備註。

Google Sheet 工作表由 API 自動建立，包含：`itineraries`、`flights`、`accommodations`、`tickets`、`shopping`、`expenses`、`reserved_expenses`、`members`、`completed_items`、`prep_checklist`、`companion_notes`、`settlements`、`daily_budgets`。

## 驗收

- 管理員：登入、建立旅伴、查詢清單、調整姓名／Email／角色／狀態、產生一次性設定／重設連結、停用／恢復／永久刪除。
- 安全限制：最後一位啟用管理員不可停用、刪除或降級；停用或重設後所有既有 session 失效。
- 旅伴：一次性連結設定密碼、登入、登出、修改密碼；檢視者不能呼叫任何寫入 API。
- 資料：行程、航班住宿、票券、購物、費用等資料在 Google Sheets 以固定 ID 保存；同一資料集版本衝突回傳 409。
- 匯入：先呼叫 `/api/trips/{tripId}/import/preview`，確認預覽後再帶 `confirmed: true` 寫入。

