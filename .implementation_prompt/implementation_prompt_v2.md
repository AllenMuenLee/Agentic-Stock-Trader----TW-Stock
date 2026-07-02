# 專案實作提示 V2 (Implementation Prompt V2)

這是一個用於引導 AI Agent 進行「AI 股票訊號通知系統」升級與重構的 V2 提示，請根據以下規格新增與修改系統功能：

## 1. WebSocket 通知 API (WebSocket Notification API)
- **需求描述**：將現有的 Notification 發送機制擴充為一個 WebSocket API，讓外部客戶端可以即時接收通知。
- **功能規格**：
  - 建立 WebSocket 伺服器端點供外部客戶端連線。
  - 客戶端在建立連線時，必須提供有效的身分驗證憑證（使用原平台帳號密碼），以驗證使用者身分。
  - 當系統觸發屬於該使用者帳戶的股票訊號時，系統需透過此 WebSocket 連線，將即時通知推播給該客戶端。

## 2. Line 機器人整合 (Line Bot Integration)
- **需求描述**：棄用原本要求使用者填寫 Line Notify Token 的方式，改為更直覺的 Line Bot 互動綁定。
- **功能規格**：
  - 實作 Line Messaging API (Line Bot)。
  - 在前端提供 Line Bot 的 QR Code，允許使用者直接掃描加入官方帳號。
  - 實作 Webhook 接收 Line 事件（例如 Follow 或包含綁定碼的對話訊息），並將該使用者的 Line UID 與系統中的帳戶自動綁定。
  - 後續的觸發訊號通知需透過 Line Bot 推送給該使用者。

## 3. Discord 機器人整合 (Discord Bot Integration)
- **需求描述**：與 Line 類似，提供無縫的 Discord Bot 綁定體驗。
- **功能規格**：
  - 實作專屬的 Discord Bot 應用程式。
  - 允許使用者透過系統提供的 Invite Link，將 Discord Bot 加入自己的伺服器，或直接與 Bot 進行私訊。
  - 建立認證綁定機制（例如 OAuth2 授權，或透過在 Discord 內輸入與系統配對的綁定指令），將使用者的 Discord 帳號（ID）與系統帳戶綁定。
  - 股票訊號觸發時，透過 Discord Bot 傳送訊息給使用者。

## 4. 移除伺服器設定說明 (Remove Server Configuration Instructions)
- **需求描述**：精簡 UI 介面與流程，移除舊有的手動設定區塊。
- **功能規格**：
  - 於前端的設定頁面（Settings Page）中，移除任何要求使用者手動輸入第三方 Token（如 Line Notify Token）的欄位。
  - 拿掉介面上關於伺服器端參數設定的複雜說明。
  - 將設定頁面全面改為以「掃描 QR Code 綁定 (Line)」與「邀請機器人授權綁定 (Discord)」為主的簡單引導介面。

## 實作步驟建議
1. **WebSocket API 開發**：新增 WebSocket 路由，實作連線管理與基於憑證的驗證邏輯，並串接現有的通知分發系統。
2. **Webhook 與 Bot 服務建置**：建立接收 Line 與 Discord 事件的 Webhook 路由，更新資料庫 Schema 以儲存使用者的 Line UID 與 Discord ID，並處理身分綁定邏輯。
3. **前端 UI 更新**：重構設定頁面，移除舊有的 Token 輸入框與伺服器設定說明，並整合 Line QR Code 顯示與 Discord 授權連結。
4. **通知邏輯替換**：全面停用 Line Notify，將通知發送核心調整為呼叫 Line Messaging API、Discord Bot API 以及 WebSocket 推播。
