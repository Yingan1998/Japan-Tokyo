# 多趟旅行 App 第一階段盤點與交付

## 既有架構盤點

- `index.html`：單頁 PWA，保留東京九天八夜的 A／B 行程、地圖、票券、航班、住宿、旅費、購物、備份與底部導覽。
- `firebase-config.js`：Firebase Web App 公開設定，專案為 `japan-tokyo-38679`；預設旅行 ID 仍是 `japan-tokyo-2026`。
- `firebase-adapter.js`：Firebase Authentication Email／密碼與 Firestore 六個既有 dataset。第一階段已改為可切換 `tripId`，並加入旅行列表、旅行設定與建立旅行 API。
- `firestore.rules`：既有成員資格與 dataset 權限保留；新增旅行設定、`users/{uid}/tripRefs/{tripId}` 索引與擁有者建立旅行的規則。
- `sw.js`：PWA cache 已升到 v8，加入 `firebase-adapter.js?v=4` 與既有 App assets。
- `assets/`：沿用 App icon 與富士山冬日背景，不新增外部私密資產。

## 第一階段已完成

1. 登入後先進入「我的旅行」，不再直接把固定東京旅程當作唯一入口。
2. 旅行列表依「即將出發／旅行中／已結束／已封存」分組，顯示名稱、目的地、日期、時區、幣別與角色。
3. 新增旅行表單：名稱、目的地、出發日、回程日、時區、旅行幣別、換算幣別與封面風格。
4. 新旅行會建立獨立 `tripId`、旅行設定、首位 admin 成員與使用者旅行索引；每日時間軸為空白，不會帶入東京資料。
5. 東京舊旅程仍使用 `trips/japan-tokyo-2026` 與既有六個 dataset；沒有旅行索引時會回退讀取既有 members 文件。
6. 切換旅行時，本機 localStorage、Firestore adapter、同步佇列與畫面資料都綁定目前 `tripId`；登出時沿用原有清除私人狀態流程。
7. 延長旅行日期會新增空白日；縮短日期時會列出目前時間軸、票券與住宿受影響資料，需先處理後才允許儲存。
8. 總覽、行程、票夾、旅費、更多等原有模組仍保留，東京既有 A／B 方案仍由原資料格式讀寫。

## 相容資料方式

- 既有六個 dataset 路徑不變：
  - `trips/{tripId}/datasets/itinerary`
  - `trips/{tripId}/datasets/tickets`
  - `trips/{tripId}/datasets/flights`
  - `trips/{tripId}/datasets/accommodations`
  - `trips/{tripId}/datasets/expenses`
  - `trips/{tripId}/datasets/reservedExpenses`
- 東京旅程的舊資料仍以 `trip-state` 包裝行程；新旅行會產生空白日期資料，避免東京景點、票券、住宿與費用外溢。
- 本機快取對東京保留既有 key；其他旅行使用 `tokyo-account:{uid}:trip:{tripId}:...` 隔離。
- 目前尚未把購物、行前清單、留言、分帳等非六個 Firestore dataset 改成逐筆雲端資料；它們會依目前旅行的本機 scope 保存，並在介面標示同步範圍。

## 驗收結果

- Edge headless 以 390px 寬度載入：旅行列表 markup、建立旅行表單、五項底部導覽均存在。
- DOM smoke test 未偵測 `SyntaxError`、`ReferenceError` 或未定義函式標記。
- Service Worker 快取版本已更新為 `japan-tokyo-pwa-v8`。
- 正式 Firebase 帳號登入與東京成員資格沿用既有成功流程；本機未保存任何密碼或私鑰。

## 正式環境待處理

- 需在 Firebase Console 或具權限的 Firebase CLI 部署新版 `firestore.rules`，否則既有規則會阻擋 `users/{uid}/tripRefs` 與新旅行批次建立。
- 需要用一個實際 Firebase 帳號驗證：建立第二趟旅行、切換後新增行程／票券／費用、重新開啟後資料隔離，以及檢視者／編輯者的實際 API 權限。
- 後續可再加入旅行範本、複製旅行、邀請管理、唯讀分享與逐筆資料遷移。

