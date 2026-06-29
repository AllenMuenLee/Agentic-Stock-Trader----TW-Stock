# AI Agent 規則生成架構升級實作提示 (Agent Modification Prompt)

這是一個用於升級「AI 股票訊號通知系統 (Agentic Stock Notifier)」核心邏輯的實作提示。目前的系統只能依賴 JSON 設定檔來進行基礎的指標比較，我們需要將其改造為能夠**動態生成與執行實際 JavaScript 程式碼**的強大架構。

請開發者依照以下需求進行修改與實作：

## 1. 建立核心資料獲取函式庫 (Data Fetching Library)
必須為 AI Agent 提供一組穩定、直覺的內部函式庫，讓生成的規則程式碼能夠自由獲取各種股票資訊：
- **`get_data(stock, feature, start_time, end_time)`**: 
  獲取特定股票在時間區段內的陣列資料 (如 tick 價格、成交量等)。
  *例如：獲取過去一秒內的所有價格 `get_data(stock, 'price', curr_time - 1, curr_time)`*。
- **`get_detail(stock, feature)`**: 
  獲取特定股票的當下即時資訊或單一基本面細節。
- 實作：將這些函式包裝成一個上下文物件 (Context API)，在執行規則程式碼時動態注入 (inject) 到執行環境中。

## 2. 升級 AI Agent 生成輸出 (Code Generation over JSON)
全面修改 OpenRouter 系統提示 (System Prompt) 以及規則解析邏輯：
- AI Agent **不再回傳 JSON 陣列條件**。當使用者提出監控需求時，AI 必須生成**實際的 JavaScript 函式程式碼**。
- **範例場景**：
  使用者要求：「Notify me if the tick goes up strictly increasing within a second (若一秒內 tick 呈現嚴格遞增則通知我)」。
  生成的 JS 程式碼應類似於：
  ```javascript
  const prices = get_data(stock, 'price', curr_time - 1, curr_time);
  if (prices.length < 2) return null;

  let strictlyIncreasing = true;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] - prices[i - 1] <= 0) {
      strictlyIncreasing = false;
      break;
    }
  }

  if (strictlyIncreasing) {
    return { signal: 'NOTIFY', message: 'Price is strictly increasing within a second.' };
  }
  return null;
  ```
- 系統必須能夠將 AI 回傳的這段程式碼字串，儲存至資料庫的 rule config 中。

## 3. 統一規則回傳結構 (Standardized Return Structure)
雖然規則邏輯變成高自由度的 JavaScript 程式碼，但它最後的回傳結果仍須被後端 Rule Engine 嚴格解析：
- 每個生成的規則程式碼執行完畢後，必須回傳統一的格式。
- 合法的 `signal` 狀態僅限：`"BUY"`, `"SELL"`, 或 `"NOTIFY"`。若條件未觸發，則回傳 `null` 或 `undefined`。
- 回傳結構範例：
  ```javascript
  {
    signal: "BUY",   // 或 "SELL" / "NOTIFY"
    message: "Trigger reason / details"
  }
  ```

## 4. 動態執行安全沙盒 (Secure Execution Environment)
由於後端需要執行由 AI 產生的字串形式程式碼：
- 請在後端 Node.js 使用安全沙盒機制（例如原生的 `vm` 模組，或 `isolated-vm` 套件）。
- 在沙盒執行時，僅暴露安全的 API (`get_data`, `get_detail`) 與必要的上下文變數 (`stock`, `curr_time`)。禁止存取 `process`, `fs`, 或網路請求等底層功能，避免系統風險。
