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

## 更新任务（2026-03-29 第二轮）
- [x] 深度强化 AdsPower 随机指纹：UA 版本号随机、字体列表随机、平台随机、屏幕色深随机、像素比随机、端口随机、WebGL 厂商/渲染器随机
- [x] 所有前端页面文字改为简体中文
- [x] 后端日志/错误信息改为简体中文
- [x] 运行测试并保存 Checkpoint（15 个测试全部通过，TypeScript 无错误）

## 更新任务（2026-03-29 第三轮）
- [x] AdsPower API Key 写入配置文件（server/config.ts），不在界面暴露
- [x] adspower.ts 自动从配置读取 API Key，所有请求自动携带 Authorization 头
- [x] 自动化任务界面移除 API Key 输入框（已写死，无需用户填写）
- [x] 确认回调接口字段完全匹配插件输出 JSON（email/password/phone/token/clientId/membershipVersion/totalCredits/freeCredits/inviteCode）
- [x] 更新测试并保存 Checkpoint

## 更新任务（2026-03-29 第四轮）
- [x] 修复测试失败（adspowerApiKey 字段移除后测试未同步更新）
- [x] 新增 phone_numbers 数据库表（phone, smsUrl, status: unused/in_use/used, usedByEmail）
- [x] 后端 API：批量导入手机号（支持「手机号|接码URL」格式）
- [x] 后端 API：获取下一个可用手机号（供插件调用）
- [x] 后端 API：标记手机号为使用中/已使用
- [x] REST 回调接口：插件获取手机号 POST /api/callback/get-phone
- [x] REST 回调接口：插件标记手机号已使用 POST /api/callback/mark-phone-used
- [x] 前端：手机号管理页面（批量导入、列表、状态筛选）
- [x] DashboardLayout 新增「手机号管理」导航项
- [x] 更新测试并保存 Checkpoint

## 本地化改造（2026-03-29 第五轮）
- [x] 移除 Manus OAuth 登录依赖，改为无需登录直接访问
- [x] 将所有 protectedProcedure 改为 publicProcedure（无需认证）
- [x] 前端移除登录逻辑，直接渲染仪表板
- [x] 创建 .env.example 模板文件
- [x] 创建 Docker Compose 配置（MySQL + 应用）
- [x] 编写本地部署 README
- [x] 推送到 GitHub

## 修复任务（2026-03-29 第六轮）
- [x] 数据库新增 referrerCode 字段（邀请人邀请码）并执行迁移
- [x] 手机号三状态：获取时标记「使用中」，插件确认后标记「已使用」
- [x] 后端新增 POST /api/callback/mark-phone-used 接口（标记手机号已使用）
- [x] 账号表格展示全字段（含 referrerCode），移除详情跳转
- [x] 导入格式只支持新格式（含 referrerCode 字段）
- [x] 仪表板移除「总积分」卡片，只保留账号数量统计
- [x] 移除积分统计页面（Credits.tsx）和导航入口
- [x] API 集成页面将所有 Manus 地址改为本地运行地址
- [x] 全面复检并运行测试（17 个测试全部通过， TypeScript 无错误）
- [x] 推送到 GitHub

## 账号列表改进（2026-03-29 第七轮）
- [x] 后端：新增 accounts.delete 接口（支持单条删除）
- [x] 后端：导入账号时检查 email 是否已存在，重复则跳过并返回跳过数量
- [x] 前端：账号列表表格最右侧固定「删除」按钮列
- [x] 前端：完善分页（显示总条数、每页条数、首页/上一页/页码按钮/下一页/末页）
- [x] 前端：隐藏 clientId 列
- [x] 前端：展示 token 列并添加复制按钮（截断显示，点击复制完整值）
- [x] 运行测试并保存 Checkpoint（17 个测试全部通过）

## UI 修复（2026-03-29 第八轮）
- [x] 修复手机号管理页面顶部留白过大（与其他页面不统一）
- [x] 移除手机号管理页面底部的「插件调用接口」流程描述文字

## 清理认证相关代码（2026-03-29 第九轮）
- [ ] 后端：移除 JWT 签名/Cookie 写入逻辑（server/_core/context.ts、auth 路由）
- [ ] 后端：移除 OAuth 回调路由（/api/oauth/callback）
- [ ] 后端：移除 auth.me、auth.logout 等 tRPC procedure
- [ ] 后端：移除 JWT_SECRET 依赖，简化 env.ts
- [ ] 前端：移除 useAuth hook 和登录 URL 逻辑
- [ ] 前端：移除 LoginPage 或登录相关组件
- [ ] 更新 env.example，只保留 DATABASE_URL、APP_PORT 两个必要变量
- [ ] 运行测试并保存 Checkpoint

## 账号列表批量操作（2026-03-29 第十轮）
- [x] 恢复 env.ts 完整字段，修复 TS 错误
- [x] 修复 db.ts 重复导出 getAccountByEmail
- [x] 账号列表：表头全选/反选复选框，每行复选框
- [x] 账号列表：批量删除按钮（选中后出现）
- [x] 账号列表：批量复制按钮，格式为「账号----密码」每行一个
- [x] 运行测试并保存 Checkpoint（17 个测试全部通过）

## 移除跨域限制（2026-03-29 第十一轮）
- [ ] 移除服务器端 CORS 限制，允许所有来源访问

## 接口修复（2026-03-29 第十二轮）
- [x] get-phone 接口返回値加上 id 字段
- [x] mark-phone-used 改为只传 id（不需要 phone 和 usedByEmail）
- [x] register 接口修复 invitedByCode/referrerCode 字段重复写入导致 SQL 报错

## API 文档更新（2026-03-29 第十三轮）
- [x] 更新 get-phone 返回値说明（加入 id 字段）
- [x] 更新 mark-phone-used 示例代码（只传 id，不传 phone/usedByEmail）
- [x] 更新 API 端点列表中 mark-phone-used 的说明

## 接口修复 + 文档完善（2026-03-29 第十四轮）
- [x] 修复 register 接口：邮箱重复时前置检查返回 409 + 友好错误（EMAIL_EXISTS）
- [x] 修复 register 接口：inviteCode/email unique 冲突时捕获并返回友好错误码
- [x] 完善 ApiDocs 页面：每个接口补充完整参数表格（字段名、类型、是否必填、说明）
- [x] 完善 ApiDocs 页面：每个接口补充完整返回值表格（字段名、类型、说明）
- [ ] 保存 Checkpoint 并推送 GitHub

## 邀请码接口重设计（2026-03-29 第十五轮）
- [x] get-next-invite-code：获取邀请码时直接标记为「邀请中」，同时返回 id 和 inviteCode
- [x] 新增 reset-invite-code 接口：注册失败时通过 id 将邀请码重置为「未使用」
- [x] register 接口：新增 inviterAccountId 参数，通过 id 直接将邀请人邀请码标记为「已使用」
- [x] 删除多余的 invite-used 接口（功能已合并到 get-next-invite-code）
- [x] 更新 ApiDocs 文档，反映新的接口设计
- [ ] 保存 Checkpoint 并推送 GitHub
