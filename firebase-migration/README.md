# Firestore 移轉工具

這個工具將旅行備份 JSON 寫入：

`trips/japan-tokyo-2026/datasets/{dataset}`

目前支援六個資料集：

- `itinerary`
- `tickets`
- `flights`
- `accommodations`
- `expenses`
- `reservedExpenses`

## 預覽

```powershell
npm install
node migrate.mjs C:\path\to\tokyo_trip_html_backup.json
```

預覽不會連線寫入 Firestore，只會列出資料集筆數、A／B 天數與預期內容。

## 實際寫入

需要先完成 Google Cloud Application Default Credentials。不要把服務帳號 JSON 提交到 GitHub。

```powershell
$env:GOOGLE_CLOUD_PROJECT="japan-tokyo-38679"
gcloud auth application-default login
node migrate.mjs C:\path\to\tokyo_trip_html_backup.json --apply
```

也可以設定 `GOOGLE_APPLICATION_CREDENTIALS` 指向本機私有服務帳號 JSON。工具只會在 `--apply` 時載入 Firebase Admin SDK，並在目標文件已有不同內容時保留雲端版本、回報衝突，不會覆蓋。

## 備份格式

優先使用 App 匯出的 `japan-tokyo-travel-backup` JSON。若尚未有最新備份，請取得移轉工具附帶的 `tokyo_trip_html_backup.json`；本專案目前沒有該壓縮包或備份檔，因此尚未執行實際寫入。

