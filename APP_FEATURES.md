# 2026 東京九天八夜旅行 App 功能彙整

最後盤點日期：2026-11-13

這份文件以目前專案中的 `index.html`、`manifest.webmanifest`、`sw.js` 與 `server/` 實際程式為準，區分已可使用、需要部署設定，以及目前尚未完成實機驗證的功能。

## 1. 系統架構與運作模式

### 1.1 前端 App

- 單一 `index.html` 搭配 CSS、JavaScript 與 PWA 設定。
- 可直接部署在 GitHub Pages。
- 支援手機主畫面安裝，使用 `manifest.webmanifest` 與專屬 App icon。
- Service Worker 會快取主要畫面、圖示、背景與已載入資源；離線時仍可查看已快取的行程資料。
- 未設定後端 API 時，App 仍可用本機模式，資料儲存在瀏覽器 `localStorage`。

### 1.2 雲端模式（Firebase 優先）

- `firebase-config.js` + `firebase-adapter.js` 提供 Firebase Authentication（Email／密碼）與 Cloud Firestore 連線。
- Firestore 以 `trips/japan-tokyo-2026/datasets/{dataset}` 儲存六個核心資料集；瀏覽器不接觸服務帳號私鑰。
- `firestore.rules` 限制未登入、非旅程成員與檢視者的寫入；成員角色只能由管理端建立或調整。
- `server/` 保留為舊版 Node.js／PostgreSQL／Google Sheets 回退方案，方便逐步移轉與回滾；Firebase 模式不會把六個核心資料集寫回 Google Sheets。
- 尚未填入 Firebase Web App 公開設定時，App 仍可使用本機 `localStorage`；若設定 `api-config.js` 且未啟用 Firebase，才使用舊版 API。

## 2. 主要導覽

底部導覽列目前有六個入口：

1. 行程
2. 地圖
3. 記帳
4. 票券
5. 購物
6. 更多／資訊

資訊頁另外提供航班與住宿管理、備份、PWA 安裝、行前清單、旅伴留言、SOS 與雲端帳號功能。

## 3. 行程首頁（Itinerary）

### 3.1 日期與版本

- 2026 東京九天八夜的 Day 1～Day 9 日期選單。
- 點擊日期後，首頁、地圖、景點時間軸、票券日期範圍與主要行程會同步切換。
- 手機版日期列可左右滑動；桌面版保留完整日期選單。
- 「今天」按鈕會跳到目前日期，旅行前或旅行後會依狀態選擇合適日期。
- 行程支援 A／B 版本切換，目前使用充實版與輕量版資料結構。
- 點擊品牌標題會回到行程首頁並回到頁面頂端。

### 3.2 今日旅程儀表板

- 顯示今日地點、日期、Day 編號與旅行倒數／旅行期間狀態。
- 顯示今日實際支出、每日預算、剩餘預算與行程完成進度。
- 顯示下一個行程、開始時間與導航按鈕。
- 顯示本日詳細行程摘要與行前提醒。
- 顯示今日航班、今日住宿與今日票券／預約摘要。
- 「附近吃」、「附近逛」會開啟 Google Maps 搜尋。
- 「當地提醒」會跳至日本安全與 SOS 資訊。
- 「離線檢查」可查看目前是否在線及快取狀態。

### 3.3 行程項目管理

每個景點卡片可：

- 新增行程。
- 編輯行程名稱、時間、地點、交通、預算、類別、備案與備註。
- 刪除行程。
- 複製行程。
- 將行程移動到其他日期。
- 使用拖曳方式調整同一天的順序。
- 開啟 Google Maps 導航。
- 查看時間、地點、分類、交通方式、預估預算與雨天備案。
- 顯示時間重疊警告。
- 將行程標記為未開始、進行中、已完成或已取消。
- 已完成項目可再次取消完成，不會單純依照日期自動誤判為完成。
- 顯示該景點已建立的實際支出。
- 對應 Notion 行程看板中的景點內文頁，提供「查看行程重點」連結與快速摘要。

### 3.4 行程搜尋、提醒與備份

- 可搜尋景點、交通或餐廳。
- 可清除搜尋條件。
- 行程安排標題旁提供「提醒」、「快速記帳」與「新增」操作。
- 提醒可設定提前 10／20／30 分鐘。
- 只有在 App 頁面開啟時檢查提醒，不宣稱支援背景推播。
- 可選擇啟用瀏覽器通知權限。
- 可匯出完整 JSON 備份。

## 4. 分區天氣（Weather）

- 點擊首頁上方天氣卡可進入分區天氣頁。
- 依每日行程地點整理各區目前天氣。
- 顯示目前溫度、體感／最高／最低溫、風速與降雨機率。
- 使用 Open-Meteo，不需要在前端暴露 API Key。
- 提供手動更新。
- 依天氣結果顯示雨天行程提醒與室內備案。
- 天氣資料會短時間快取在本機，避免每次切頁重複請求。

## 5. 地圖（Map）

- 只顯示目前選擇日期的行程路線，不一次載入九天所有景點。
- 使用 Leaflet + OpenStreetMap，無需 Google Maps API Key。
- 地圖景點使用固定座標與原生 Leaflet marker。
- Marker 會跟著地圖座標移動，拖曳或縮放地圖時不會固定在畫面上。
- Marker 會依景點類型使用圖示，例如飯店、寺社、車站、購物、遊樂園、富士山與橋樑。
- 點擊 Marker 可開啟該地點的 Google Maps 導航。
- 地圖會依當日景點自動計算中心與縮放比例。
- 地圖容器會在切頁、調整視窗與地圖載入完成後重新計算尺寸，避免空白區域。
- 未收錄座標的地點仍保留在下方時間軸，可使用 MAP 按鈕導航。
- 地圖下方顯示當日景點時間軸，包含時間、順序、景點與交通方式。
- 地圖與時間軸會隨日期選擇同步更新。

## 6. 記帳（Expense）

### 6.1 實際支出

- 新增、編輯、刪除一般旅途支出。
- 支援 JPY 與 TWD。
- 記錄日期、分類、付款方式、實際付款者、備註與關聯行程。
- 支援平均分攤、個人支出、指定金額與指定比例。
- 可選擇分攤成員。
- 可標記已結清／未結清。
- 從行程卡或首頁快速記帳時，可預先帶入日期、景點與分類。
- 顯示旅途支出總計、JPY 原幣與 TWD 換算結果。

### 6.2 匯率

- 顯示目前匯率與更新時間。
- 支援自動匯率資料。
- 記帳時可輸入手動匯率覆蓋自動值。
- 匯率資料會保存在本機備份中。

### 6.3 旅行費用概況

- 預訂費用與實際記帳分開顯示，避免重複計算。
- 可新增、編輯與刪除旅行費用概況。
- 顯示住宿、門票或其他預訂費用的原幣、台幣參考、人數與付款狀態。
- 支援待確認、已付款、部分付款與未付款狀態。

### 6.4 旅伴與分帳

- 新增與移除旅伴／分帳成員。
- 顯示每位成員應收／應付金額。
- 依已記帳資料計算目前是否有待互相還款的差額。
- 保留分帳結算狀態。

### 6.5 分類分析

- 依台幣換算後金額整理餐飲、交通、購物、門票、住宿與其他分類。
- 顯示分類比例與圓餅圖。
- 沒有支出時顯示空狀態，不產生誤導性的圖表。

## 7. 購物清單（Shopping）

- 已匯入東京旅程採購資料。
- 可新增、編輯與刪除商品。
- 商品可記錄分類、地區、預計店家、預估價格、實際價格、數量、購買者、代購人與重量。
- 支援商品圖片本機附件。
- 可使用關鍵字搜尋商品或店家。
- 可依採購狀態、分類與地區篩選。
- 「全部」、「尚未確認」、「已確認買到」狀態清楚分開。
- 購買確認按鈕使用「確認已買到」語意，不以容易誤會的綠色完成標籤代替。
- 已確認的商品可以撤銷回待確認。
- 顯示採購進度、預算、實際金額與估算重量。
- 商品有價格時，可直接建立一筆記帳資料。
- 提供「只看尚未確認」快速操作。
- 採購資料會納入 JSON 備份；Firebase 核心同步範圍不包含購物清單，仍可使用本機備份或舊版 API。

## 8. 票券（Tickets）

- 新增、編輯與刪除票券／預約。
- 記錄活動名稱、類型、日期、入場時間、平台、訂單編號、價格、幣別、取票期限與關聯行程。
- 支援待確認、待購買、已購買、待取票、已取票、已使用與已取消。
- 可上傳本機 QR Code 圖片或 PDF，單一附件限制 2 MB。
- 可開啟購票網址或雲端檔案。
- 初始可顯示全部票券。
- 選擇日期後可只顯示當日票券。
- 提供「顯示全部票券」按鈕返回完整清單。
- 可依狀態與關鍵字篩選。
- 首頁會顯示目前日期的今日票券與預約摘要。

## 9. 航班與住宿

### 9.1 航班

- 新增、編輯與刪除航班。
- 記錄去程／回程、日期、航班號碼、出發／抵達機場、時區、航廈、起降時間、機型與費用。
- 顯示航班 Check-in 入口。
- 可從首頁摘要或資訊頁開啟航班管理。
- 可用 Google Maps 導航至出發或抵達機場。
- 私密訂位代號、PIN 與電子機票號碼不寫入公開程式碼或一般 JSON 備份。

### 9.2 住宿

- 新增、編輯與刪除住宿。
- 記錄飯店名稱、中文名稱、入住／退房日期與時間、晚數、地址、電話、房型、成員、金額、幣別、付款狀態與取消期限。
- 可使用 Google Maps 導航至住宿。
- 首頁顯示今日住宿摘要。
- 私密訂單資料只在目前頁面記憶體暫存，重新整理或登出後清除。

## 10. 資訊、行前與安全

### 10.1 雲端帳號與同步

前端已提供下列操作；需先填入 Firebase Web App 設定並建立旅程成員文件：

- Email／密碼登入。
- 登出。
- 首次設定密碼。
- 修改密碼。
- 一次性密碼設定與重設連結。
- 上傳目前本機資料到私人 Cloud Firestore。
- 從雲端重新載入旅程資料。
- 匯入 JSON 備份前先顯示新增／更新／移除預覽。
- 匯入確認後才寫入雲端。
- 管理員帳號及旅伴邀請需由 Firebase Console 或尚未部署的 Admin SDK／後端管理；前端不自行修改成員角色。
- Firebase Web App 目前提供登入、登出、改密碼、讀寫六個資料集與權限錯誤提示。
- 初始管理員需先在 Firebase Authentication 建立帳號，再建立對應 `members/{uid}` 文件。
- 一次性設定／重設連結需要郵件服務或 Admin SDK；目前可由管理員私下產生與交付。

角色權限：

- `admin`：管理帳號、旅程與同步資料。
- `editor`：修改共用旅程資料。
- `viewer`：只能查看，不可呼叫旅程寫入 API。

### 10.2 行前清單

- 內建行前準備清單。
- 可逐項勾選。
- 顯示完成數量與進度條。
- 可一鍵重設。
- 本機模式下只保存在本機；雲端模式可同步至 `prep_checklist`。

### 10.3 旅伴留言板

- 可輸入暱稱與留言。
- 支援集合提醒、想吃的店與臨時變更等內容。
- 單則留言最多 240 字。
- 可刪除留言。
- 本機模式下保存在本機；登入雲端模式後可同步到 `companion_notes`。

### 10.4 日本安全與 SOS

- 日本警察：110。
- 消防／救護：119。
- 駐日代表處急難電話。
- 提供交通、防災與就醫提示。
- 可開啟外交部公告頁面。

### 10.5 PWA 安裝與備份

- 可在支援的手機瀏覽器安裝到主畫面。
- 使用 Japan Tokyo 專屬 icon。
- JSON 匯出包含行程、A／B 版本、記帳、預算、票券、購物、航班、住宿、預訂費用、成員、完成狀態、行前清單、留言、分帳與匯率。
- 可從 JSON 備份還原本機資料。
- 備份可能包含票券 QR／PDF 與商品圖片，不能公開分享。

## 11. 本機資料儲存項目

主要 `localStorage` 資料鍵：

| Key | 內容 |
| --- | --- |
| `emenuTokyo` | 行程、九天資料與 A／B 版本 |
| `tokyoExpenses` | 實際支出 |
| `tokyoTickets` | 票券與預約 |
| `tokyoShoppingItems` | 購物清單 |
| `tokyoShoppingState` | 購物清單 UI 狀態 |
| `tokyoFlights` | 航班 |
| `tokyoAccommodations` | 住宿 |
| `tokyoReservedExpenses` | 預訂費用 |
| `tokyoMembers` | 旅伴／分帳成員 |
| `tokyoSettlements` | 分帳結算狀態 |
| `tokyoCompletedItems` | 行程完成狀態 |
| `tokyoPrepChecklist` | 行前清單勾選狀態 |
| `tokyoCompanionNotes` | 旅伴留言 |
| `tokyoDailyBudgets` | 每日預算 |
| `tokyoReminderMinutes` | 提醒提前分鐘數 |
| `tokyoRate` | 匯率與更新時間 |
| `tokyoRegionalWeather` | 分區天氣快取 |

訂位代號、PIN 與電子機票號碼使用頁面記憶體暫存，不寫入上述本機資料鍵與 JSON 備份。

## 12. Firestore 雲端資料集

核心資料集固定放在以下文件：

- `trips/japan-tokyo-2026/datasets/itinerary`
- `trips/japan-tokyo-2026/datasets/tickets`
- `trips/japan-tokyo-2026/datasets/flights`
- `trips/japan-tokyo-2026/datasets/accommodations`
- `trips/japan-tokyo-2026/datasets/expenses`
- `trips/japan-tokyo-2026/datasets/reservedExpenses`

每個文件包含 `tripId`、`dataset`、`revision`、`updatedAt`、`updatedBy` 與 `records`；每筆記錄保留穩定 `id`、`_cloudVersion`，寫入時以 Firestore transaction 偵測版本衝突。

成員文件位於 `trips/japan-tokyo-2026/members/{uid}`，欄位包含 `name`、`email`、`role`（`admin`／`editor`／`viewer`）與 `status`（`active`／`disabled`）。密碼、Token 與私鑰絕不寫入 Firestore 或前端。

移轉工具位於 `firebase-migration/`，可先預覽舊 JSON，再用 `--apply` 寫入；發現雲端既有不同版本時保留雲端資料並列出衝突。

## 13. 舊版 Google Sheets 雲端資料集（回退方案）

`server/` 仍保留原本的 Google Sheets／PostgreSQL schema，供既有部署回滾使用。Firebase 模式啟用後，六個核心資料集不再同步寫入試算表；購物、行前清單與留言等非核心資料仍可留在本機或沿用舊版 API。

## 14. 目前狀態與限制

### 已完成並可使用

- GitHub Pages 前端與 PWA。
- 本機行程、地圖、天氣、記帳、購物、票券、航班、住宿、行前、SOS、留言與 JSON 備份。
- Leaflet／OpenStreetMap 互動地圖與座標 marker。
- Notion 景點重點連結。
- Firebase 前端 adapter、Firestore rules、六資料集同步、匯入預覽與版本衝突處理。
- 舊版 Node.js API、PostgreSQL schema、Google Sheets schema 與版本衝突邏輯仍保留。
- Node.js API、PostgreSQL schema、Google Sheets schema 與版本衝突邏輯。

### 需要正式設定後才能使用

- `firebase-config.js` 的 `apiKey`、`messagingSenderId` 與 `appId`。
- Firebase Authentication 的 Email／密碼登入啟用。
- 第一位管理員 Auth 帳號與 `members/{uid}` 文件。
- `firestore.rules` 部署至目標專案。
- `firebase-migration/` 的 Node.js 依賴與 Google Application Default Credentials。
- 舊版回退模式才需要 PostgreSQL、Google Spreadsheet ID、Service Account、API URL。

### 尚未完成實際整合驗證

- 目前環境找不到使用者指定的 `tokyo_firestore_migration.zip`、旅行備份 JSON、Node.js／npm 與 Google ADC，因此尚未聲稱已實際寫入 Firestore。
- 已完成可執行的 Firebase adapter、rules 與移轉工具；填入設定並完成授權後即可執行預覽／寫入。
- 尚未在正式專案完成真實登入、讀取與受權限控制寫入驗收。
- 尚未啟用郵件寄送服務；目前重設／首次設定連結由管理員產生後私下交付。

