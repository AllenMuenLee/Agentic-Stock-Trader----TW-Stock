# 專案實作提示 (Implementation Prompt)

這是一個用於初始化「AI 股票訊號通知系統 (Agentic Stock Notifier)」的提示，請根據以下規格與要求進行專案開發：

## 技術堆疊 (Tech Stack)
- **前端架構**: Next.js
- **後端架構**: Node.js
- **第三方 API**:
  - Fugle (富果): 用於獲取即時股價資訊
  - yfinance： 獲取股票基本盤資訊與歷史股市數據
  - OpenRouter: 用於串接大語言模型 (LLM) 以驅動 AI Agent
- **資料庫 (Database)**: SQL 資料庫 (用來儲存歷史股價與使用者資訊)

## 前端需求 (Frontend Requirements)
1. **AI 規則建構對話介面 (AI Agent Chat Tab)**:
   - 提供一個互動式對話介面，讓使用者可以與 AI Agent 聊天。
   - 目的：使用者透過自然語言描述選股邏輯，AI 協助將其轉換並建立為可執行的股票監控規則。
2. **規則管理儀表板 (Dashboard)**:
   - 顯示並管理所有已生成的監控規則。
   - 允許用歷史資料模擬
   - 針對每項規則，需顯示重要資訊：勝率 (Win Rate)、歷史觸發紀錄 (Past history of found signals) 以及目前運行狀態。
3. **設定頁面 (Settings Page)**:
   - 提供介面讓使用者連結與設定通知管道，包含：Email、LINE 帳號 (LINE Bot / Notify)、以及 Discord。

## 後端需求 (Backend Requirements)
1. **可插拔規則架構 (Pluggable Rule Structure)**:
   - 建立一個標準化的「可插拔 (Pluggable)」架構。
   - 系統會將股市資訊 (如 tick 數據) 餵入 (feed in) 使用者建立的各個規則模組中。
   - 每個規則模組執行後，必須回傳嚴格定義的資料格式 (strict format)，以指示是否觸發訊號。
2. **AI Agent 系統提示與 OpenRouter 整合**:
   - 撰寫強健的 System Prompt 協助 AI Agent。該 Prompt 必須引導 Agent 根據使用者的對話，產生出符合上述「可插拔架構」且格式嚴格的程式碼或規則設定檔。
   - 實作與 OpenRouter API 的串接，負責處理使用者的對話並回傳規則程式碼/資料。
3. **Fugle 即時數據串接 (Live WebSocket)**:
   - 實作與 Fugle API 的 WebSocket 連線。
   - 即時接收並記錄股票的 Tick 數據，持續提供資料給後端的規則系統進行運算。
4. **yfinance 歷史數據串接**:
   - 如果使用者有使用股票基本面資料寫股池篩選，或是想要用歷史資料回測它設定的規則，使用yfinance來獲取歷史資訊，並且用sql紀錄在後台，所以以後不用再不斷重複向 API 請求資料。
5. **多管道通知系統 (Notification System)**:
   - 當規則條件滿足並觸發時，系統能自動發送通知。
   - 實作透過 LINE Bot、Email 以及 Discord 傳送即時通知訊息的功能。

## 資料庫需求 (Database Requirements)
1. **資料庫選擇**: 使用 SQL 關聯式資料庫 (例如 PostgreSQL, MySQL 或 SQLite)。
2. **歷史股價資料 (Historical Price Data)**: 儲存過去 30 天的歷史價格與市場數據，供應回測系統與基本面篩選使用，降低即時抓取成本。
3. **使用者資訊 (User Information)**: 儲存使用者相關資料，包含通知管道憑證 (Email, LINE, Discord) 以及各使用者定義的選股規則與歷史觸發紀錄。

## 啟動步驟建議 (Suggested Initialization Steps)
1. 建立 Next.js 與 Node.js 的基礎專案結構 (Monorepo 或分離式架構)。
2. 設定環境變數管理 (包含 Fugle Token, OpenRouter API Key, 以及各項通知服務的 Keys)。
3. 實作後端 WebSocket 與 Fugle 的連線測試，確保能穩定接收即時 Tick 數據。
4. 實作後端規則引擎 (Rule Engine) 與「可插拔」介面，定義好統一的 Input/Output 格式。
5. 實作 OpenRouter API 端點與 System Prompt，確保 AI 產生的規則能夠完美接入規則引擎。
6. 開發前端 UI 組件 (對話框、儀表板、設定頁面)，並與後端 API 串接完成整體流暢的體驗。
