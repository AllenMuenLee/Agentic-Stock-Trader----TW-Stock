# Dynamic Stock Pool & Dashboard Code Editor Implementation Prompt

這是一個用於升級「AI 股票訊號通知系統」功能的實作提示。目前的系統每個規則只能綁定固定的股票代號陣列 (Fixed Array)，而且使用者無法在介面上直接修改 AI 生成的程式碼。我們需要將系統升級以支援**動態選股池 (Dynamic Stock Pool)** 以及**儀表板手動編輯程式碼 (Manual Code Editing)**。

請開發者依照以下需求進行修改與實作：

## 1. 資料庫結構更新 (Database Schema Modifications)
- 修改 `Rule` 的資料庫結構（例如 Prisma Schema），以支援動態選股：
  - 新增 `poolType` 欄位（例如：`FIXED` 或 `DYNAMIC`）。
  - 若為 `FIXED`，維持原本的 `symbols` 陣列。
  - 若為 `DYNAMIC`，新增一個欄位 `poolFilterCode` (字串) 或是利用特定的條件定義 (例如：「全部科技股」、「成交量 > 1000」)，讓系統可以動態解析出該池子裡的股票。
- 確保 API 路由 (`/api/rules`) 在建立與更新規則時，能正確處理這些新欄位。

## 2. 儀表板 UI 升級 (Dashboard UI Enhancements)
- **手動程式碼編輯器 (Code Editor)**：
  - 在規則的詳細資料或編輯頁面中，加入一個程式碼編輯器（可使用 Monaco Editor 或具有語法高亮的文字區塊）。
  - 允許使用者直接檢視並修改由 AI 生成的 `config.code` JavaScript 邏輯。
- **選股池設定區塊 (Stock Pool Selector)**：
  - 加入切換按鈕，讓使用者選擇「固定股票清單 (Fixed)」或「動態選股池 (Dynamic)」。
  - 若選擇「動態選股池」，可讓使用者選擇預設的分類（如特定產業、特定 ETF 成分股），或是手動輸入選股池的篩選程式碼。
- **儲存功能**：允許使用者將修改後的程式碼與選股池設定直接存回資料庫，即時生效。

## 3. Rule Engine 與底層輔助函式 (Helper Functions & Sandbox)
為了讓系統能夠運作動態選股池，必須調整 Rule Engine 的執行機制：
- **動態訂閱 (Dynamic Subscription)**：
  - 如果規則是動態選股池，系統需要定期（例如每天開盤前，或每小時）評估該選股池涵蓋了哪些股票，並自動更新 Socket.io / Fugle API 的訂閱清單。
- **擴充 Helper Functions**：
  - 確保 `get_meta(stock, 'sector')` 等 metadata 函式能提供足夠的資訊供篩選。
  - 可以新增一個 `filter_market(condition)` 函式，或是在 Sandbox 內提供一個專門用於評估 `poolFilterCode` 的執行環境，回傳 boolean 來決定該股票是否符合動態池條件。

## 4. 系統提示詞更新 (System Prompt Update)
- 修改 `apps/api/src/services/gemini.service.ts` 中的 System Prompt。
- 教導 AI 在面對如「當任何科技股漲幅超過 5% 時通知我」這類請求時，不要詢問特定的股票代號，而是要生成包含動態選股條件的 JSON 設定。
- **JSON 回傳結構更新範例**：
  ```json
  {
    "action": "CREATE_RULE",
    "rule": {
      "name": "Tech Stocks 5% Gain",
      "description": "Notify when any technology stock gains >= 5%",
      "poolType": "DYNAMIC",
      "poolFilterCode": "return get_meta(stock, 'sector') === 'Semiconductors';",
      "symbols": [],
      "config": {
        "code": "const gain = get_detail(stock, 'changePercent');\nif (gain >= 5) return { signal: 'NOTIFY', message: '漲幅達 5%' };\nreturn null;",
        "signal": "NOTIFY",
        "actionType": "notify"
      }
    }
  }
  ```
- 明確指示 AI 必須把「篩選股票池的邏輯」放在 `poolFilterCode`，而「每一筆 tick 如何觸發通知的邏輯」放在 `config.code` 中。
