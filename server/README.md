# Japan Tokyo API

這是目前 GitHub Pages 靜態前端所缺少的最小後端：

- Node.js 20 + Express
- PostgreSQL 儲存旅伴帳號、密碼雜湊、登入 session、重設 token、旅程權限與稽核紀錄
- Google Sheets API 儲存私人旅程資料
- 不使用 Firebase；密碼、session token、重設 token 絕不寫入試算表

## 啟動

```powershell
cd server
Copy-Item .env.example .env
# 編輯 .env：DATABASE_URL、GOOGLE_SHEET_ID、GOOGLE_SERVICE_ACCOUNT_JSON
npm install
npm run migrate
npm run bootstrap-admin
npm start
```

把 Google 試算表分享給 `GOOGLE_SERVICE_ACCOUNT_JSON` 中的 `client_email`，權限給「編輯者」。後端會自動建立這些工作表：

`itineraries`、`flights`、`accommodations`、`tickets`、`shopping`、`expenses`、`reserved_expenses`、`members`、`completed_items`、`prep_checklist`、`companion_notes`、`settlements`、`daily_budgets`。

每列固定使用 `id`，並包含 `version`、`updated_at`、`updated_by`、`deleted_at`、`payload_json`。更新時帶入上一個版本；版本不一致會回傳 HTTP 409，前端應提示重新載入。

## 部署

建議使用 Render、Railway、Fly.io 或自有 VM，並使用 PostgreSQL（Neon、Supabase Database、Render PostgreSQL 等皆可；此專案不使用 Firebase）。GitHub Pages 只服務靜態前端，不能放服務帳號私鑰或處理密碼。

必填環境變數與驗收步驟請見 `DEPLOYMENT.md`。

