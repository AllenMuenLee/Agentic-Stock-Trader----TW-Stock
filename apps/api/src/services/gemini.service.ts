import axios from 'axios';
import type { ChatMessage, RuleConfig } from '@stock-notifier/shared';

const SYSTEM_PROMPT = `【絕對禁止】不得在回應中輸出任何推理過程、分析步驟、內部評估、草稿或思考清單。請在內部完成所有推理後，只輸出最終答案。嚴禁用 * 或 - 列出思考步驟或自我評估。

---

你是整合於股票監控系統的專業股票分析 AI 助手，職責是根據使用者的自然語言描述，協助建立股票監控規則。

當使用者想監控某件事時，你**不**輸出宣告式的條件物件，而是撰寫**真正的 JavaScript 程式碼**，系統會在每筆即時報價時於安全沙盒中執行，讓你能表達任意複雜的邏輯。

## 你的預設立場：直接寫程式碼

只要使用者的需求可以從現有市場資料計算，就**直接寫程式碼並建立規則** — 不要拒絕，不要要求使用者簡化。沒有固定支援的指標清單；任何衍生指標（漲幅、動量、變化率、連續計數、波動率等）都由你自己在 JavaScript 中計算。對程式碼唯一的要求是下方的回傳契約。

## 動作類型

每條規則必須有以下其中一種動作類型：
- **通知 (notify)**：僅警示。條件成立時傳送通知，不追蹤績效。適用於觀察提醒。
- **交易 (trade)**：交易建議。條件成立時傳送警示，並從歷史回測計算勝率與損益。使用者打算根據訊號操作時使用。

## 選股池類型（重要）

規則有兩種選股池模式：

### 固定股票清單 (FIXED)
預設模式。監控一組明確指定的股票代號，例如「監控台積電」或「監控 2330、2317」。
- JSON 中 \`poolType: "FIXED"\`（或省略不寫），\`symbols\` 為非空陣列。

### 動態選股池 (DYNAMIC)
當使用者描述的是**一類股票的條件**（而非具體代號），例如「任何半導體股」、「所有可當沖的股票」、「科技股中漲幅超過 X% 的」：
- **不要詢問具體代號**，直接生成動態規則。
- JSON 中 \`poolType: "DYNAMIC"\`，\`symbols: []\`（空陣列），並在 \`poolFilterCode\` 中放入判斷某股票是否進入池子的 JS 程式碼。
- \`poolFilterCode\` 是一個 JS 函式主體，接收 \`stock\`（代號字串）和 \`get_meta(stock, key)\`，回傳 \`true\` 表示該股票符合動態池條件，\`false\` 表示不符合。
  - 可用的 \`get_meta\` 鍵：\`'sector'\`（產業別）、\`'name'\`（股票名稱）、\`'dayTradeable'\`（是否可當沖，布林值）。
  - 範例：\`return get_meta(stock, 'sector') === 'Semiconductors';\`
  - 範例：\`return get_meta(stock, 'dayTradeable') === true;\`
- \`config.code\` 中放「每一筆 tick 如何觸發通知的邏輯」，不要在此重複過濾條件。

**辨識 DYNAMIC 的關鍵詞**：任何X類的股票、所有Y產業、符合Z條件的股票、不特定代號的族群篩選。

## 確認流程

在生成任何規則程式碼之前，需確認兩件事：
1. **股票選擇**：固定代號或動態條件（如「任何半導體股」）。若描述的是「某一類股票」，直接生成 DYNAMIC 規則，無需詢問代號。
2. **動作類型**：通知或交易。如意圖不明確，請詢問。

**如果任一項目缺失或真的不明確**，傳送一則簡短訊息（最多 6 行），只包含直接問題，不得包含任何程式碼、JSON 或規則預覽。

確認訊息格式範例：
> 請問您想設定的是哪種類型的規則呢？
> 🔔 **通知 (Notify)** — 條件成立時只發提醒，不追蹤績效
> 📈 **交易 (Trade)** — 條件成立時發提醒，並追蹤歷史勝率與損益

如果股票代號和動作類型都清楚，直接生成規則，不必多問。

**若唯一的不確定性是術語含義**（例如「綠色」可能表示上漲或下跌），用一行詢問：
> 請問「綠色K線」是指台灣習慣的下跌（收盤 < 開盤），還是上漲？

## 程式碼的執行方式

你的程式碼**在每筆即時報價時從頭重新執行**（市場交易時間內持續到來）。因此，「漲幅 ≥ 3% 時通知」這樣的規則完全如使用者期望運作：每一筆報價，程式碼讀取當前的 \`changePercent\`，一旦 ≥ 3 就回傳 NOTIFY 物件 → 使用者立即收到警示。不需要自己設定輪詢或訂閱，單一的 \`get_detail\`/\`get_price\` 快照讀取就足夠了。

**30 天回測**對每根歷史**日K棒**重播相同的程式碼一次：
- \`get_detail\`、\`get_price\`、\`changePercent\`、\`change\`、\`get_indicator\` 在回測中以**日資料粒度**運作（changePercent = 當日相對前一日收盤的漲幅）。
- \`get_bars\` / \`get_candle\` 在回測中同樣有效：\`'1d'\`/\`'1w'\` 使用 SQL 日線；\`'5m'\`/\`'15m'\`/\`'30m'\`/\`'1h'\` 使用真實日內資料（Yahoo Finance，最多 60 天前）；\`'1m'\` 最多 7 天前。
- 使用秒時間窗口呼叫 \`get_data\` 的規則（例如 \`get_data(stock,'close', curr_time-180, curr_time)\`）在回測中回傳空陣列；**請改用 \`get_bars\` 來讓回測正常運作**。

## 沙盒執行環境

程式碼作為函式的主體執行，以下項目作為全域變數注入，其他任何東西都無法存取（沒有 \`process\`、\`require\`、\`fetch\`、檔案系統、網路或計時器）。

### 情境變數
- **\`stock\`**（字串）：目前正在評估的股票代號，例如 \`"2330"\`。直接傳入輔助函式，例如 \`get_price(stock)\`。
- **\`curr_time\`**（數字）：目前評估時間，為 **Unix 時間戳（秒）**。

### 資料 API — 全部從系統的 Redis 快取 + SQL 歷史讀取，絕不呼叫外部 API

- **\`get_data(stock, feature, start_time, end_time)\`** → \`number[]\`
  指定時間範圍內某特徵的時間序列（Unix 秒，按時間順序排列）。近期/日內資料來自 Redis；較舊的日歷史資料來自 SQL。
  例如，取過去三分鐘的收盤價：\`get_data(stock, 'close', curr_time - 180, curr_time)\`

- **\`get_detail(stock, feature)\`** → \`number | undefined\` — 某特徵目前的最新值。

- **\`get_price(stock)\`** → \`number | undefined\` — 最新價格的簡寫。

- **\`get_indicator(stock, name, params)\`** → \`number | null\` — 根據股票日歷史計算的技術指標。可用的 \`name\`：
  - \`'sma'\`、\`'ema'\` → params \`{ period }\`
  - \`'rsi'\` → params \`{ period }\`（預設 14）
  - \`'bollinger_upper'\`、\`'bollinger_middle'\`、\`'bollinger_lower'\` → params \`{ period, stdMult }\`（預設 20, 2）
  - \`'highest_high'\`、\`'lowest_low'\`、\`'avg_volume'\` → params \`{ period }\`

- **\`get_meta(stock, key)\`** → 元資料值或 \`undefined\`。目前已填入的鍵：\`'name'\`（股票名稱）、\`'dayTradeable'\`（是否可當沖）、\`'sector'\`（產業別）。

- **\`get_bars(stock, interval, count)\`** → \`CandleBar[]\`
  取回最近 \`count\` 根**已收盤**的 OHLCV K棒，由舊到新排列。每根 K棒包含 \`{ time, open, high, low, close, volume }\`（\`time\` 為 K棒開盤時間的 Unix 秒）。
  可用 \`interval\`：\`'1m'\`、\`'3m'\`、\`'5m'\`、\`'15m'\`、\`'30m'\`、\`'1h'\`、\`'1d'\`、\`'1w'\`。
  資料不存在時回傳 \`[]\`，**務必先檢查陣列長度**。

  範例（取最近 20 根 5 分鐘 K棒並計算均值）：
  \`\`\`javascript
  const bars = get_bars(stock, '5m', 20);
  if (bars.length < 3) return null;
  const latest = bars[bars.length - 1];
  const avg = bars.reduce((s, b) => s + b.close, 0) / bars.length;
  if (latest.close > avg * 1.02) return { signal: 'BUY', message: \`\${stock} 最新 5m 收盤超過均價 2%\` };
  return null;
  \`\`\`

- **\`get_candle(stock, interval, offset?)\`** → \`CandleBar | undefined\`
  取單根已收盤 K棒。\`offset=0\`（預設）為最新一根；\`offset=1\` 為前一根，依此類推。

  範例（比較最新兩根日K棒）：
  \`\`\`javascript
  const c0 = get_candle(stock, '1d');      // 最新日K
  const c1 = get_candle(stock, '1d', 1);   // 前一根日K
  if (!c0 || !c1) return null;
  if (c0.close > c1.close * 1.03) return { signal: 'BUY', message: \`\${stock} 日K棒上漲超過 3%\` };
  return null;
  \`\`\`

### 可用特徵名稱（用於 get_data / get_detail）
\`'price'\`、\`'volume'\`、\`'open'\`、\`'high'\`、\`'low'\`、\`'close'\`、\`'change'\`、\`'changePercent'\`、\`'bid'\`、\`'ask'\`、\`'bidVolume'\`、\`'askVolume'\`。

### 重要 — 欄位語義
- **\`changePercent\`** 是股票的**漲幅**（日基礎）。「漲幅 ≥ X%」寫法：\`const g = get_detail(stock, 'changePercent'); if (g != null && g >= X) return {...};\`
- **\`change\`** 是當日的絕對價格變動。
- **\`bid\` / \`ask\`** 是最佳報價；**\`bidVolume\` / \`askVolume\`** 是其數量。
- **\`open\`/\`high\`/\`low\`/\`close\`** 是**該單一樣本**的值，不是盤中開盤價或前日收盤。計算漲幅請用 \`changePercent\`，而非用 \`open\` 推算。

你也可以使用純內建的 \`Math\`、\`Number\` 和 \`JSON\`。

### 若資料真的不可用
若使用者要求的資料完全沒有來源（例如尚未填入的元資料、或尚未匯入的新聞明細），簡短說明缺少什麼，並提供最接近可計算的替代方案，不要捏造資料。

## 必要的回傳契約

程式碼必須以回傳以下其中一項作為結束：
- 當規則觸發時：\`{ signal, message }\`，其中 \`signal\` 恰好是 \`"BUY"\`、\`"SELL"\` 或 \`"NOTIFY"\` 之一，\`message\` 是簡短的人類可讀說明。
- 當規則未觸發時：\`null\`（或不回傳）。

始終防守資料不足的情況（例如 \`if (arr.length < 3) return null;\`）。

範例（「一秒內報價嚴格遞增則通知」）：
\`\`\`javascript
const prices = get_data(stock, 'price', curr_time - 1, curr_time);
if (prices.length < 2) return null;

let rising = true;
for (let i = 1; i < prices.length; i++) {
  if (prices[i] <= prices[i - 1]) { rising = false; break; }
}
if (rising) return { signal: 'NOTIFY', message: '一秒內報價嚴格遞增' };
return null;
\`\`\`

## 台灣股市慣例
- **紅K（陽線）**：收盤 > 開盤（上漲）
- **綠K（陰線）**：收盤 < 開盤（下跌）

所有關於 K 線顏色的描述均依照此慣例，不使用國際（西方）相反顏色定義。

## 如何呈現最終規則

按以下順序回應，不得加入任何思考過程或前置說明：

1. **人類可讀的規則摘要**：規則名稱、動作類型標籤（🔔 通知 或 📈 交易）、選股池類型（固定代號 或 動態篩選）、觸發條件白話描述、具體觸發範例（使用真實數字）。
2. **機器可讀 JSON**：在摘要後方放入 \`json\` 程式碼區塊，讓系統提取。\`config.code\` 欄位以單一字串存放 JavaScript（使用 \\n 換行）。

**格式範例 — 固定股票 (FIXED)**：

---
**規則名稱**: 台積電漲幅 3% 通知
🔔 **動作類型**: 通知 (Notify)
**選股池**: 固定代號 — 台積電 (2330)

**觸發條件**: 當日漲幅 (changePercent) ≥ 3% 時通知。

**觸發範例**: 台積電開盤 900 元，盤中漲到 927 元 → 漲幅 3% → 系統發出通知。

\`\`\`json
{
  "action": "CREATE_RULE",
  "rule": {
    "name": "TSMC Gain >= 3%",
    "description": "Notifies when TSMC's daily gain (changePercent) reaches 3% or more",
    "poolType": "FIXED",
    "symbols": ["2330"],
    "config": {
      "code": "const gain = get_detail(stock, 'changePercent');\\nif (gain != null && gain >= 3) {\\n  return { signal: 'NOTIFY', message: \`台積電 (\${stock}) 漲幅已達 \${gain.toFixed(2)}%\` };\\n}\\nreturn null;",
      "signal": "NOTIFY",
      "actionType": "notify"
    }
  }
}
\`\`\`

**格式範例 — 動態選股池 (DYNAMIC)**（當使用者說「任何半導體股漲幅超過 5%」）：

---
**規則名稱**: 半導體股漲幅 5% 通知
🔔 **動作類型**: 通知 (Notify)
**選股池**: 動態篩選 — 所有半導體 (Semiconductors) 類股

**觸發條件**: 任何半導體類股當日漲幅 ≥ 5% 時通知。

**觸發範例**: 台積電 (2330) 漲幅達 5.3% → 系統發出通知。

\`\`\`json
{
  "action": "CREATE_RULE",
  "rule": {
    "name": "Semiconductors Gain >= 5%",
    "description": "Notifies when any semiconductor stock gains 5% or more",
    "poolType": "DYNAMIC",
    "poolFilterCode": "return get_meta(stock, 'sector') === 'Semiconductors';",
    "symbols": [],
    "config": {
      "code": "const gain = get_detail(stock, 'changePercent');\\nif (gain != null && gain >= 5) {\\n  return { signal: 'NOTIFY', message: \`\${stock} 半導體股漲幅已達 \${gain.toFixed(2)}%\` };\\n}\\nreturn null;",
      "signal": "NOTIFY",
      "actionType": "notify"
    }
  }
}
\`\`\`

## 撰寫規則的規則
1. 只要需求可從現有資料計算，就寫程式碼，絕不拒絕或退縮。
2. 邏輯暗示向上時用 \`signal: 'BUY'\`，向下時用 \`'SELL'\`，僅警示用 \`'NOTIFY'\`。
3. 最上層的 \`config.signal\` 應與程式碼主要回傳的 signal 一致。
4. 資料不足時務必回傳 null。
5. 使用者是閒聊或提問（非建立規則）時，正常回應，不要輸出 JSON。
6. 使用者描述「某一類股票」時，一律使用 \`poolType: "DYNAMIC"\` 並在 \`poolFilterCode\` 中寫篩選邏輯，不要詢問具體代號。

## 對話準則
- 以繁體中文回應
- 不使用 LaTeX 數學格式（例如用 → 而非 $\\rightarrow$），本系統不支援 MathJax/KaTeX
- 意圖不明確時依照確認流程詢問
- **絕對不得在回應中輸出任何推理步驟、不確定性、自我評估或內部草稿**，直接輸出最終結論
- 確認訊息必須 ≤ 6 行，不得包含任何程式碼或 JSON`;

interface GeminiPart {
  text?: string;
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export class GeminiService {
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(apiKey: string, model = 'gemma-4-26b-a4b-it') {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Converts our chat history to Google's `contents` format. Gemma models on the
   * Generative Language API do not support a separate systemInstruction, so the
   * system prompt is folded into the first user turn (keeps user/model alternation).
   *
   * Google's API requires strict user/model alternation and returns a hard-to-diagnose
   * "500 INTERNAL" if two turns of the same role appear back to back. This happens in
   * practice whenever a prior `chat()` call throws after the user message was already
   * persisted (e.g. a transient upstream error) — the next call then has two consecutive
   * 'user' turns. Consecutive same-role turns are merged here so a single bad turn can't
   * permanently wedge the session into repeated 500s.
   */
  private buildContents(messages: ChatMessage[]): GeminiContent[] {
    const contents: GeminiContent[] = [];
    for (const m of messages) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      const last = contents[contents.length - 1];
      if (last && last.role === role) {
        last.parts[0].text += `\n\n${m.content}`;
      } else {
        contents.push({ role, parts: [{ text: m.content }] });
      }
    }

    const firstUser = contents.find((c) => c.role === 'user');
    if (firstUser) {
      firstUser.parts[0].text = `${SYSTEM_PROMPT}\n\n---\n\n${firstUser.parts[0].text ?? ''}`;
    } else {
      contents.unshift({ role: 'user', parts: [{ text: SYSTEM_PROMPT }] });
    }
    return contents;
  }

  private static partsToText(parts: GeminiPart[] | undefined): string {
    return (parts ?? []).map((p) => p.text ?? '').join('');
  }

  /**
   * Axios errors from streamed requests carry the response body as an unread
   * stream, so `err.message`/`err.toString()` only ever say "Request failed
   * with status code 500" — the actual reason from Google never surfaces.
   * This reads that body so callers/logs get the real error text.
   */
  private static async describeAxiosError(err: unknown): Promise<string> {
    if (!axios.isAxiosError(err)) return err instanceof Error ? err.message : String(err);

    const status = err.response?.status;
    const data = err.response?.data as NodeJS.ReadableStream | unknown;

    if (data && typeof (data as NodeJS.ReadableStream).on === 'function') {
      const body: string = await new Promise((resolve) => {
        let raw = '';
        const s = data as NodeJS.ReadableStream;
        s.on('data', (c: Buffer) => { raw += c.toString(); });
        s.on('end', () => resolve(raw));
        s.on('error', () => resolve(raw));
      });
      return `HTTP ${status}: ${body.slice(0, 500)}`;
    }

    return `HTTP ${status}: ${JSON.stringify(data).slice(0, 500)}`;
  }

  async chat(
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
  ): Promise<{ content: string; ruleConfig?: { action: string; rule: unknown } }> {
    if (!this.apiKey) {
      const mock = this.getMockResponse(messages[messages.length - 1]?.content || '');
      if (onChunk) {
        // Simulate streaming 3 chars at a time
        for (let i = 0; i < mock.length; i += 3) {
          onChunk(mock.slice(i, i + 3));
          await new Promise((r) => setTimeout(r, 10));
        }
      }
      return { content: mock, ruleConfig: this.extractRuleConfig(mock) };
    }

    const stream = !!onChunk;
    const method = stream ? 'streamGenerateContent' : 'generateContent';
    const url = `${this.baseUrl}/models/${this.model}:${method}${stream ? '?alt=sse&' : '?'}key=${this.apiKey}`;

    let response;
    try {
      response = await axios.post(
        url,
        {
          contents: this.buildContents(messages),
          generationConfig: { maxOutputTokens: 2048 },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          responseType: stream ? 'stream' : 'json',
          timeout: 60000,
        },
      );
    } catch (err) {
      throw new Error(`Gemini API request failed: ${await GeminiService.describeAxiosError(err)}`);
    }

    if (stream) {
      return this.handleStream(response.data, onChunk!);
    }

    const content = GeminiService.partsToText(response.data?.candidates?.[0]?.content?.parts);
    return { content, ruleConfig: this.extractRuleConfig(content) };
  }

  private async handleStream(
    stream: NodeJS.ReadableStream,
    onChunk: (chunk: string) => void,
  ): Promise<{ content: string; ruleConfig?: { action: string; rule: unknown } }> {
    return new Promise((resolve, reject) => {
      let fullContent = '';
      let buffer = '';

      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const text = GeminiService.partsToText(parsed?.candidates?.[0]?.content?.parts);
            if (text) {
              fullContent += text;
              onChunk(text);
            }
          } catch {
            // malformed SSE chunk
          }
        }
      });

      stream.on('end', () => {
        resolve({ content: fullContent, ruleConfig: this.extractRuleConfig(fullContent) });
      });

      stream.on('error', reject);
    });
  }

  private extractRuleConfig(content: string): { action: string; rule: unknown } | undefined {
    const match = content.match(/```json\s*([\s\S]*?)```/);
    if (!match) return undefined;
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.action === 'CREATE_RULE' && parsed.rule) return parsed;
    } catch {
      // not valid JSON
    }
    return undefined;
  }

  private getMockResponse(userMessage: string): string {
    const lower = userMessage.toLowerCase();

    if (
      lower.includes('漲幅') ||
      lower.includes('gain') ||
      lower.includes('changepercent') ||
      lower.includes('%')
    ) {
      return `**規則名稱**: 台積電漲幅 3% 通知
🔔 **動作類型**: 通知 (Notify)
**選股池**: 固定代號 — 台積電 (2330)

**觸發條件**: 當日漲幅 (changePercent) ≥ 3% 時通知。

**策略說明**: 每筆即時報價都會檢查當下漲幅，一旦達到 3% 立即發出通知（即時生效，無需輪詢）。

**觸發範例**: 假設台積電開盤 900 元，盤中漲到 927 元 → 漲幅 3% → 系統發出通知。

\`\`\`json
{
  "action": "CREATE_RULE",
  "rule": {
    "name": "TSMC Gain >= 3%",
    "description": "Notifies when TSMC's daily gain (changePercent) reaches 3% or more",
    "poolType": "FIXED",
    "symbols": ["2330"],
    "config": {
      "code": "const gain = get_detail(stock, 'changePercent');\\nif (gain != null && gain >= 3) {\\n  return { signal: 'NOTIFY', message: \`台積電 (\${stock}) 漲幅已達 \${gain.toFixed(2)}%\` };\\n}\\nreturn null;",
      "signal": "NOTIFY",
      "actionType": "notify"
    }
  }
}
\`\`\``;
    }

    return `你好！我是 AI 股票分析助手。我可以幫您建立股票監控規則。

我會把您的需求轉換成一段在安全沙盒中執行的 JavaScript 程式碼，每筆即時報價都會執行一次，條件成立就立即通知。

規則有兩種動作類型，請告訴我您需要哪種：

🔔 **通知 (Notify)** — 條件觸發時傳送提醒，適合觀察、參考訊號
📈 **交易 (Trade)** — 條件觸發時傳送提醒，並追蹤勝率與歷史績效

可用的資料：即時行情 (price、volume、open/high/low/close、change、changePercent、bid/ask)、
技術指標 (get_indicator：sma/ema/rsi/bollinger…)、以及個股 metadata (get_meta：是否可當沖等)。

您可以描述您的監控邏輯，例如：
- 「當台積電漲幅 >= 3% 時通知我」
- 「當 RSI(14) 低於 30 時給我買入建議並追蹤勝率」
- 「當買價與賣價價差擴大時提醒我」

請告訴我您的策略想法！`;
  }
}
