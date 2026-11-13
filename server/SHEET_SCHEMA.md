# Google 試算表欄位

API 會自動建立下列工作表。每個工作表都使用相同的六欄結構，避免前端畫面欄位變動時破壞歷史資料。

| 欄位 | 用途 |
| --- | --- |
| `id` | 固定資料 ID；新增後不因排序或畫面切換改變 |
| `version` | 單筆版本號；每次成功寫入遞增 |
| `updated_at` | 後端寫入時間（ISO 8601） |
| `updated_by` | 修改者的帳號 ID |
| `deleted_at` | 軟刪除時間；保留歷史資料 |
| `payload_json` | 該筆行程資料的 JSON 內容，不放密碼、Session 或重設 Token |

工作表與 App 資料的對應：

- `itineraries`：九天行程與景點
- `flights`：航班
- `accommodations`：住宿
- `tickets`：票券與預約
- `shopping`：購物清單
- `expenses`：旅途中實際支出
- `reserved_expenses`：預訂費用概況
- `members`：旅伴／分帳成員（不是登入帳號）
- `completed_items`：行程完成狀態
- `prep_checklist`：行前提醒清單
- `companion_notes`：旅伴備註
- `settlements`：分帳結算
- `daily_budgets`：每日預算

登入帳號、密碼雜湊、Session、一次性設定／重設 Token 與稽核資料都保留在 PostgreSQL，不會寫入 Google 試算表。

