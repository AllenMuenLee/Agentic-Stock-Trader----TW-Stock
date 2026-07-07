# Fubon Neo API Trading App & Subscription Plans Implementation Prompt

這是一個用於實作「富邦 Neo API 獨立交易應用程式」以及「訂閱方案頁面與限制」的實作提示。

請開發者依照以下需求進行修改與實作：

## 1. 解析現有交易訊號格式 (Understand Agent Signal Format)
- 開發前，請先閱讀現有的 Agent 訊號回傳格式。
- 目前系統的訊號格式回傳結構為包含 `signal` 與 `message` 的物件，其中 `signal` 狀態僅限 `"BUY"`, `"SELL"` 或 `"NOTIFY"`。
- Trading App 在收到這些訊號後，必須根據 `BUY` 與 `SELL` 執行實際的交易動作。

## 2. 獨立交易應用程式 (Individual Fubon Neo API Trading App)
建立一個可供付費用戶下載、並在本地端獨立運行的應用程式（建議實作為帶有簡易 UI 的 Electron/React 或 Python 桌面應用程式）。

- **登入介面與憑證獲取 (Login UI & Credentials)**：
  - 應用程式必須提供一個清晰的**圖形化登入介面 (Login UI)**，讓使用者輸入其富邦證券的帳號 (Account)、密碼 (Password) 以及憑證相關資訊。
  - 使用者填寫並送出後，程式需透過富邦 Neo API 自動登入，完成身分驗證並取得交易憑證 (Certification)。
  - 登入成功並取得憑證後，系統應自動建立並保持富邦 Neo API 的 WebSocket 連線，以訂閱即時行情並準備下單。
- **接收訊號與自動下單**：
  - 應用程式需能與我們的伺服器建立連線（或透過 WebSocket 監聽伺服器派發的事件），以接收 Agent 的交易訊號。
  - 當收到訊號為 `"BUY"` 時，透過本地的富邦 Neo API 送出買進委託；當訊號為 `"SELL"` 時，送出賣出委託。
- **同步真實交易數據至 Web App (Sync Real Trading Data)**：
  - Trading App 在本地端下單或接收到富邦 Neo API 的委託回報、成交回報以及庫存狀況後，需將這些**真實交易數據 (Real trading data)** 同步傳送回我們的主要 Web API 伺服器。
- **安全性注意事項**：
  - 用戶的富邦登入資訊與憑證**應只儲存於本地端**，絕對不可上傳至系統的 Web 伺服器。伺服器只負責接收同步上來的「交易紀錄與狀態」以供展示。

## 3. Web App 網站端實作：真實交易紀錄展示與訂閱方案限制
### A. 展示真實交易數據 (Show Real Trading Data)
- 在現有的 Web App (Dashboard 內) 新增一個「交易紀錄 (Trading History / Orders)」頁面或區塊。
- 該區塊需負責顯示由本地 Trading App 同步上來的真實富邦 Neo 交易數據（包含委託狀態、成交明細、當下部位等）。讓使用者在網站上就能掌握實際交易狀況。

### B. 訂閱方案頁面與權限限制 (Subscription Plans Page & Limits)
在 Web App 中建立一個「方案選擇 (Plan)」頁面。目前處於測試階段，**不需要實作真實金流 (Payment Method)**，只需在頁面上提供按鈕讓使用者直接點擊切換方案即可。

請實作以下三種方案：
- **Free Plan (免費方案)**
  - 額度限制：每天最多可建立 2 個 AI 規則 (AI rules)。
  - 額度限制：每天最多可送出 10 次對話輸入 (Conversational inputs)。
- **399 Plan (399 方案)**
  - 額度限制：每天最多可建立 7 個 AI 規則。
  - 額度限制：每天最多可送出 35 次對話輸入。
  - 專屬權限：允許下載上述的「獨立交易應用程式 (Trading App)」。
- **799 Plan (799 方案)**
  - 額度限制：無限制 (No limit)。
  - 專屬權限：允許下載「獨立交易應用程式 (Trading App)」。

#### 實作細節：
1. **資料庫擴充**：在使用者表 (User) 增加記錄當前方案 (Plan)、當日建立的 AI 規則數、當日對話次數等欄位，並實作每日重置邏輯；同時新增資料表以儲存由 Trading App 同步上來的訂單與交易紀錄。
2. **後端攔截**：在建立規則與送出對話的 API 中，加入權限與額度檢查。若超過當下方案額度，則阻擋請求並提示升級。
3. **前端 UI**：
   - 建立 `/plans` 路由與頁面，列出三個方案的卡片，以及「切換方案」的按鈕。
   - 若使用者的方案支援下載 (399 或 799)，在方案頁面或 Dashboard 顯示下載 Trading App 的按鈕。
