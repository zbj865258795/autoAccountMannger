# 賬號管理與自動化任務控制系統 TODO

## 數據庫 & 後端
- [x] 設計並建立 accounts 表（email, password, token, membershipVersion, registeredAt, totalCredits, freeCredits, refreshCredits, inviteCode, inviteStatus, invitedBy）
- [x] 設計並建立 automation_tasks 表（任務狀態、配置、統計）
- [x] 設計並建立 task_logs 表（執行日誌、成功/失敗、耗時）
- [x] 執行數據庫遷移
- [x] tRPC 路由：賬號列表查詢（支持搜索/篩選/分頁）
- [x] tRPC 路由：賬號詳情查詢
- [x] tRPC 路由：手動新增賬號
- [x] tRPC 路由：批量導入賬號（JSON 格式）
- [x] tRPC 路由：更新邀請碼狀態
- [x] tRPC 路由：儀表板統計數據（含 avgCredits, maxCredits）
- [x] tRPC 路由：積分分佈查詢（membershipBreakdown, topAccounts）
- [x] tRPC 路由：邀請關係鏈查詢
- [x] tRPC 路由：自動化任務 CRUD（啟動/暫停/停止）
- [x] tRPC 路由：任務日誌查詢
- [x] REST API：Chrome 插件回調端點（POST /api/callback/register, /register-full）
- [x] REST API：獲取下一個可用邀請碼（GET /api/callback/next-invite-code）
- [x] REST API：通知邀請碼使用中（POST /api/callback/invite-used）
- [x] AdsPower 集成服務（創建指紋瀏覽器、打開窗口、連通性檢查）
- [x] 定時掃描任務（掃描 unused 邀請碼 → 觸發 AdsPower，支持並發控制）

## 前端頁面
- [x] 全局 DashboardLayout（側邊欄導航、用戶信息、登入/登出）
- [x] 儀表板總覽頁（統計卡片：總賬號數、總積分、邀請碼狀態分佈、最近賬號）
- [x] 賬號列表頁（表格、搜索、篩選、分頁）
- [x] 批量導入賬號頁（JSON 粘貼導入、手動添加）
- [x] 邀請關係可視化頁（邀請鏈條展示）
- [x] 積分統計頁（圓餅圖、Top10 柱狀圖、明細列表）
- [x] 自動化任務控制面板（並發數選擇、啟動/暫停/停止、AdsPower 配置）
- [x] 任務執行日誌頁（狀態篩選、分頁）
- [x] API 集成說明頁（Chrome 插件修改指南、完整代碼示例）

## 集成 & 測試
- [x] Chrome 插件回調接口文檔（含完整代碼示例）
- [x] AdsPower API 集成腳本
- [x] 單元測試（賬號 CRUD、邀請碼狀態流轉、批量導入、儀表板統計）
- [x] 保存 Checkpoint

## 更新任務（2026-03-29）
- [x] 閱讀 AdsPower API 文檔，確認創建/刪除瀏覽器接口參數
- [x] 數據庫新增 phone、clientId 字段並執行遷移
- [x] 重寫 AdsPower 服務：每次創建隨機指紋（UA、分辨率、語言、時區、WebGL 等）
- [x] 實現刪除 AdsPower 瀏覽器功能（v2 API，支持批量，每批最多 100 個）
- [x] 更新回調接口支持 phone、clientId 字段
- [x] 更新前端導入頁面支持新字段
- [x] 更新測試並複檢所有功能（15 個測試全部通過）
- [x] automation_tasks 表新增 adspowerApiKey 和 targetUrl 字段
- [x] 前端創建任務對話新增 API Key 和 targetUrl 輸入欄，並發數上限調整為 50
- [x] ApiDocs.tsx 插件修改指南更新包含 phone/clientId 字段
