'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronRight, Copy, Check, Zap, Lock, Radio, Bell, Code2, BookOpen } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Section {
  id: string;
  label: string;
  icon?: React.ReactNode;
  children?: { id: string; label: string }[];
}

// ─── Sidebar config ───────────────────────────────────────────────────────────
const sections: Section[] = [
  { id: 'overview', label: '概覽', icon: <BookOpen className="w-4 h-4" /> },
  { id: 'auth', label: '身份驗證', icon: <Lock className="w-4 h-4" />, children: [
    { id: 'auth-register', label: '註冊帳號' },
    { id: 'auth-login', label: '登入' },
    { id: 'auth-me', label: '取得目前使用者' },
    { id: 'auth-password', label: '修改密碼' },
  ]},
  { id: 'rules', label: '規則管理', icon: <Zap className="w-4 h-4" />, children: [
    { id: 'rules-list', label: '取得規則列表' },
    { id: 'rules-create', label: '新增規則' },
    { id: 'rules-toggle', label: '啟用／停用規則' },
    { id: 'rules-delete', label: '刪除規則' },
  ]},
  { id: 'settings', label: '帳號設定', icon: <Code2 className="w-4 h-4" />, children: [
    { id: 'settings-get', label: '取得設定' },
    { id: 'settings-update', label: '更新 Email' },
    { id: 'settings-test', label: '測試通知' },
  ]},
  { id: 'bind', label: '通知綁定', icon: <Bell className="w-4 h-4" />, children: [
    { id: 'bind-line-code', label: 'LINE 取得綁定碼' },
    { id: 'bind-line-unbind', label: 'LINE 解除綁定' },
    { id: 'bind-discord-url', label: 'Discord 取得授權網址' },
    { id: 'bind-discord-unbind', label: 'Discord 解除綁定' },
  ]},
  { id: 'websocket', label: 'WebSocket API', icon: <Radio className="w-4 h-4" />, children: [
    { id: 'ws-connect', label: '建立連線' },
    { id: 'ws-subscribe', label: '訂閱報價' },
    { id: 'ws-events', label: '接收事件' },
  ]},
];

// ─── Code block component ──────────────────────────────────────────────────────
function CodeBlock({ code, language = 'http' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800">
        <span className="text-xs text-slate-500 font-mono">{language}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? '已複製' : '複製'}
        </button>
      </div>
      <pre className="p-4 text-sm text-slate-300 font-mono overflow-x-auto leading-relaxed whitespace-pre">{code}</pre>
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
const methodColors: Record<string, string> = {
  GET: 'bg-sky-600/20 text-sky-400 border-sky-600/30',
  POST: 'bg-green-600/20 text-green-400 border-green-600/30',
  PATCH: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
  DELETE: 'bg-red-600/20 text-red-400 border-red-600/30',
  WS: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
};

function MethodBadge({ method }: { method: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border ${methodColors[method] ?? 'bg-slate-700 text-slate-300'}`}>
      {method}
    </span>
  );
}

// ─── Endpoint section ─────────────────────────────────────────────────────────
function Endpoint({
  id, method, path, title, description, auth = true, request, response,
}: {
  id: string; method: string; path: string; title: string; description?: string;
  auth?: boolean; request?: string; response?: string;
}) {
  return (
    <div id={id} className="scroll-mt-20 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40">
      <div className="px-5 py-4 border-b border-slate-800 flex items-start gap-3 flex-wrap">
        <MethodBadge method={method} />
        <code className="font-mono text-sm text-slate-200 flex-1">{path}</code>
        {auth && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-900/20 border border-amber-700/30 rounded px-2 py-0.5">
            <Lock className="w-3 h-3" /> 需要認證
          </span>
        )}
      </div>
      <div className="p-5 space-y-4">
        <div>
          <h4 className="font-semibold text-slate-100">{title}</h4>
          {description && <p className="text-sm text-slate-400 mt-1">{description}</p>}
        </div>
        {request && (
          <div>
            <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Request</p>
            <CodeBlock code={request} language="json" />
          </div>
        )}
        {response && (
          <div>
            <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Response</p>
            <CodeBlock code={response} language="json" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────
function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 text-xl font-bold text-slate-100 mt-12 mb-6 flex items-center gap-2 border-b border-slate-800 pb-3">
      {children}
    </h2>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-slate-300 mt-8 mb-3">{children}</h3>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DocsPage() {
  const [activeId, setActiveId] = useState('overview');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const allIds = sections.flatMap((s) => [s.id, ...(s.children?.map((c) => c.id) ?? [])]);
    const elements = allIds.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    elements.forEach((el) => observerRef.current!.observe(el));
    return () => observerRef.current?.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-800 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-6 px-4">
        <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-4 px-2">目錄</p>
        <nav className="space-y-0.5">
          {sections.map((section) => (
            <div key={section.id}>
              <button
                onClick={() => scrollTo(section.id)}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-left transition-colors ${
                  activeId === section.id
                    ? 'bg-sky-600/15 text-sky-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                {section.icon}
                <span className="font-medium">{section.label}</span>
              </button>
              {section.children && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-800 pl-3">
                  {section.children.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => scrollTo(child.id)}
                      className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-left transition-colors ${
                        activeId === child.id
                          ? 'text-sky-400'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <ChevronRight className="w-3 h-3 shrink-0" />
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 max-w-3xl mx-auto px-6 py-8 pb-24">

        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 text-xs text-sky-400 bg-sky-900/20 border border-sky-700/30 rounded-full px-3 py-1 mb-4">
            <Code2 className="w-3.5 h-3.5" /> API 文件
          </div>
          <h1 className="text-3xl font-bold text-slate-100">智股通 API 文件</h1>
          <p className="text-slate-400 mt-2">完整的 REST 與 WebSocket API 參考文件，讓你在外部應用中整合即時股票訊號。</p>
        </div>

        {/* Base URL box */}
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 mb-8 flex items-center gap-3">
          <span className="text-xs text-slate-500 shrink-0">Base URL</span>
          <code className="font-mono text-sky-300 text-sm">http://localhost:3001</code>
        </div>

        {/* ── Overview ── */}
        <SectionHeading id="overview"><BookOpen className="w-5 h-5 text-sky-400" /> 概覽</SectionHeading>
        <div className="prose-custom space-y-4 text-slate-400 text-sm leading-relaxed">
          <p>智股通 API 提供兩種接入方式：</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { icon: <Lock className="w-5 h-5 text-sky-400" />, title: 'REST API', desc: '標準 HTTP 請求，用於帳號管理、規則設定、設定查詢等操作。所有受保護的端點需在 Header 帶入 JWT Token。' },
              { icon: <Radio className="w-5 h-5 text-purple-400" />, title: 'WebSocket API', desc: '基於 Socket.IO 的即時連線，用於接收即時報價（tick）與規則觸發通知（notification）。' },
            ].map((item) => (
              <div key={item.title} className="border border-slate-800 rounded-lg p-4 bg-slate-900/40">
                <div className="flex items-center gap-2 mb-2">{item.icon}<span className="font-semibold text-slate-200">{item.title}</span></div>
                <p className="text-xs">{item.desc}</p>
              </div>
            ))}
          </div>

          <SubHeading>認證方式</SubHeading>
          <p>先呼叫登入端點取得 JWT Token，再將 Token 帶入所有受保護請求的 <code className="text-sky-300 bg-slate-800 px-1 rounded text-xs">Authorization</code> Header：</p>
          <CodeBlock code={`Authorization: Bearer <你的 JWT Token>`} language="http" />

          <SubHeading>錯誤格式</SubHeading>
          <p>所有錯誤回應均使用以下格式，HTTP 狀態碼反映錯誤類型（400、401、403、404、409、500）：</p>
          <CodeBlock code={`{ "error": "錯誤描述訊息" }`} language="json" />
        </div>

        {/* ── Auth ── */}
        <SectionHeading id="auth"><Lock className="w-5 h-5 text-sky-400" /> 身份驗證</SectionHeading>

        <Endpoint
          id="auth-register"
          method="POST"
          path="/api/auth/register"
          title="註冊帳號"
          description="建立新帳號，成功後回傳 JWT Token（即可直接使用，無需再次登入）。"
          auth={false}
          request={`{
  "username": "myuser",   // 必填，至少 3 個字元
  "password": "mypass123" // 必填，至少 6 個字元
}`}
          response={`{
  "token": "eyJhbGci...",
  "user": {
    "id": "clxxxxxxxx",
    "username": "myuser"
  }
}`}
        />

        <div className="mt-4" />
        <Endpoint
          id="auth-login"
          method="POST"
          path="/api/auth/login"
          title="登入"
          description="驗證帳號密碼，回傳有效期 7 天的 JWT Token。"
          auth={false}
          request={`{
  "username": "myuser",
  "password": "mypass123"
}`}
          response={`{
  "token": "eyJhbGci...",
  "user": {
    "id": "clxxxxxxxx",
    "username": "myuser"
  }
}`}
        />

        <div className="mt-4" />
        <Endpoint
          id="auth-me"
          method="GET"
          path="/api/auth/me"
          title="取得目前使用者"
          description="驗證 Token 並回傳目前登入的使用者資訊，包含 LINE 與 Discord 的綁定狀態。"
          response={`{
  "id": "clxxxxxxxx",
  "username": "myuser",
  "email": "you@example.com",
  "lineUserId": "Uxxxxxxxxxxxx",   // null 表示未綁定
  "discordUserId": "123456789012"  // null 表示未綁定
}`}
        />

        <div className="mt-4" />
        <Endpoint
          id="auth-password"
          method="PATCH"
          path="/api/auth/password"
          title="修改密碼"
          request={`{
  "currentPassword": "oldpass",
  "newPassword": "newpass123" // 至少 6 個字元
}`}
          response={`{ "ok": true }`}
        />

        {/* ── Rules ── */}
        <SectionHeading id="rules"><Zap className="w-5 h-5 text-sky-400" /> 規則管理</SectionHeading>

        <Endpoint
          id="rules-list"
          method="GET"
          path="/api/rules"
          title="取得規則列表"
          description="回傳目前登入使用者的所有規則，包含最近的觸發記錄。"
          response={`[
  {
    "id": "clxxxxxxxx",
    "name": "台積電突破均線",
    "description": "20日均線突破通知",
    "symbols": ["2330"],
    "isActive": true,
    "config": { ... },
    "createdAt": "2026-07-01T08:00:00Z",
    "triggers": [
      {
        "id": "clxxxxxxxx",
        "signal": "BUY",
        "price": 920,
        "message": "2330 股價突破20日均線",
        "triggeredAt": "2026-07-01T10:30:00Z"
      }
    ]
  }
]`}
        />

        <div className="mt-4" />
        <Endpoint
          id="rules-create"
          method="POST"
          path="/api/rules"
          title="新增規則"
          description="建立新的監控規則。規則程式碼在沙箱環境中執行，可使用 get_indicator()、get_detail()、get_meta() 等輔助函式。"
          request={`{
  "name": "台積電突破均線",
  "description": "選填的說明文字",
  "symbols": ["2330"],
  "config": {
    "code": "const sma = get_indicator(stock, 'sma', { period: 20 }); const price = get_detail(stock, 'price'); if (!sma) return null; if (price > sma) return { signal: 'BUY', message: \`\${stock} 突破20日均線\` }; return null;",
    "signal": "BUY",
    "actionType": "notify"
  }
}`}
          response={`{
  "id": "clxxxxxxxx",
  "name": "台積電突破均線",
  "symbols": ["2330"],
  "isActive": true,
  ...
}`}
        />

        <div className="mt-4" />
        <Endpoint
          id="rules-toggle"
          method="PATCH"
          path="/api/rules/:id/toggle"
          title="啟用／停用規則"
          description="切換規則的啟用狀態（isActive），回傳更新後的規則物件。"
          response={`{
  "id": "clxxxxxxxx",
  "isActive": false,
  ...
}`}
        />

        <div className="mt-4" />
        <Endpoint
          id="rules-delete"
          method="DELETE"
          path="/api/rules/:id"
          title="刪除規則"
          response={`{ "ok": true }`}
        />

        {/* ── Settings ── */}
        <SectionHeading id="settings"><Code2 className="w-5 h-5 text-sky-400" /> 帳號設定</SectionHeading>

        <Endpoint
          id="settings-get"
          method="GET"
          path="/api/settings"
          title="取得設定"
          response={`{
  "email": "you@example.com",
  "lineUserId": "Uxxxxxxxxxxxx",  // null 表示未綁定
  "discordUserId": "1234567890"   // null 表示未綁定
}`}
        />

        <div className="mt-4" />
        <Endpoint
          id="settings-update"
          method="PUT"
          path="/api/settings"
          title="更新 Email"
          description="更新帳號的 Email，用於接收信件通知。"
          request={`{ "email": "new@example.com" }`}
          response={`{ "ok": true }`}
        />

        <div className="mt-4" />
        <Endpoint
          id="settings-test"
          method="POST"
          path="/api/settings/test-notification"
          title="測試通知"
          description="發送測試訊息至所有已綁定的通知管道（Email、LINE、Discord）。"
          response={`{ "ok": true }`}
        />

        {/* ── Bind ── */}
        <SectionHeading id="bind"><Bell className="w-5 h-5 text-sky-400" /> 通知綁定</SectionHeading>

        <div className="bg-slate-900/60 border border-sky-800/40 rounded-lg p-4 mb-6 text-sm text-slate-300">
          <p className="font-semibold text-sky-300 mb-1">LINE 綁定流程</p>
          <ol className="list-decimal list-inside space-y-1 text-slate-400 text-xs">
            <li>呼叫 <code className="text-slate-200">/api/bind/line/code</code> 取得 6 位數綁定碼（有效 15 分鐘）</li>
            <li>使用 QR Code 加入 LINE 官方帳號</li>
            <li>在 LINE 聊天室傳送該 6 位數碼</li>
            <li>Webhook 接收後自動完成綁定</li>
          </ol>
        </div>

        <Endpoint
          id="bind-line-code"
          method="GET"
          path="/api/bind/line/code"
          title="LINE 取得綁定碼"
          description="產生一組 6 位數英數字綁定碼，有效期 15 分鐘。同時回傳 LINE Bot 的 QR Code（base64 data URI）。"
          response={`{
  "code": "A3F9B2",
  "expiry": "2026-07-01T11:00:00Z",
  "lineUserId": null,
  "qrCodeUrl": "data:image/png;base64,iVBORw0KGgo...",
  "botBasicId": "xxxxx"
}`}
        />

        <div className="mt-4" />
        <Endpoint
          id="bind-line-unbind"
          method="POST"
          path="/api/bind/line/unbind"
          title="LINE 解除綁定"
          response={`{ "ok": true }`}
        />

        <div className="mt-6 bg-slate-900/60 border border-purple-800/40 rounded-lg p-4 mb-6 text-sm text-slate-300">
          <p className="font-semibold text-purple-300 mb-1">Discord 綁定流程</p>
          <ol className="list-decimal list-inside space-y-1 text-slate-400 text-xs">
            <li>呼叫 <code className="text-slate-200">/api/bind/discord/url</code> 取得 OAuth2 授權網址</li>
            <li>將使用者導向該網址，完成 Discord 授權</li>
            <li>Discord 回呼至 <code className="text-slate-200">/api/bind/discord/callback</code>，自動完成綁定</li>
          </ol>
        </div>

        <Endpoint
          id="bind-discord-url"
          method="GET"
          path="/api/bind/discord/url"
          title="Discord 取得授權網址"
          description="產生含 CSRF 防護 state 的 Discord OAuth2 授權網址。需在伺服器環境變數設定 DISCORD_CLIENT_ID 與 DISCORD_REDIRECT_URI。"
          response={`{
  "url": "https://discord.com/api/oauth2/authorize?client_id=...&scope=identify",
  "discordUserId": null
}`}
        />

        <div className="mt-4" />
        <Endpoint
          id="bind-discord-unbind"
          method="POST"
          path="/api/bind/discord/unbind"
          title="Discord 解除綁定"
          response={`{ "ok": true }`}
        />

        {/* ── WebSocket ── */}
        <SectionHeading id="websocket"><Radio className="w-5 h-5 text-sky-400" /> WebSocket API</SectionHeading>
        <p className="text-slate-400 text-sm mb-6">使用 <a href="https://socket.io/docs/v4/client-installation/" className="text-sky-400 underline underline-offset-2" target="_blank" rel="noreferrer">Socket.IO v4 客戶端</a>連線。無需認證即可接收即時報價；帶入 JWT Token 後可額外接收帳號專屬的訊號通知。</p>

        <div id="ws-connect" className="scroll-mt-20 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40 mb-4">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-3">
            <MethodBadge method="WS" />
            <code className="font-mono text-sm text-slate-200">ws://localhost:3001</code>
          </div>
          <div className="p-5 space-y-4">
            <h4 className="font-semibold text-slate-100">建立連線</h4>
            <p className="text-sm text-slate-400">帶入 Token 後，連線成功即自動加入 <code className="text-sky-300 bg-slate-800 px-1 rounded text-xs">user:&lt;id&gt;</code> 房間，可接收 <code className="text-sky-300 bg-slate-800 px-1 rounded text-xs">notification</code> 事件。</p>

            <div>
              <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">JavaScript / TypeScript</p>
              <CodeBlock language="typescript" code={`import { io } from 'socket.io-client';

const TOKEN = 'eyJhbGci...'; // 登入取得的 JWT Token

const socket = io('http://localhost:3001', {
  auth: { token: \`Bearer \${TOKEN}\` },
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log('已連線，Socket ID:', socket.id);
});`} />
            </div>

            <div>
              <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Python</p>
              <CodeBlock language="python" code={`import socketio

sio = socketio.Client()
TOKEN = 'eyJhbGci...'

@sio.event
def connect():
    print('已連線')

sio.connect(
    'http://localhost:3001',
    auth={'token': f'Bearer {TOKEN}'},
    transports=['websocket']
)
sio.wait()`} />
            </div>
          </div>
        </div>

        <div id="ws-subscribe" className="scroll-mt-20 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40 mb-4">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-3">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border bg-slate-700/30 text-slate-300 border-slate-600">EMIT</span>
            <code className="font-mono text-sm text-slate-200">subscribe / unsubscribe</code>
          </div>
          <div className="p-5 space-y-4">
            <h4 className="font-semibold text-slate-100">訂閱即時報價</h4>
            <p className="text-sm text-slate-400">傳送股票代號陣列以訂閱即時 tick 資料。不需登入即可使用。</p>
            <CodeBlock language="typescript" code={`// 訂閱
socket.emit('subscribe', ['2330', '0050', '2317']);

// 取消訂閱
socket.emit('unsubscribe', ['2317']);`} />
          </div>
        </div>

        <div id="ws-events" className="scroll-mt-20 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40">
          <div className="px-5 py-4 border-b border-slate-800">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border bg-sky-700/30 text-sky-300 border-sky-600">ON</span>
            <span className="ml-3 font-mono text-sm text-slate-200">接收事件</span>
          </div>
          <div className="p-5 space-y-6">

            <div>
              <div className="flex items-center gap-2 mb-2">
                <code className="text-green-400 font-mono text-sm bg-slate-800 px-2 py-0.5 rounded">tick</code>
                <span className="text-xs text-slate-500">不需登入即可接收</span>
              </div>
              <p className="text-sm text-slate-400 mb-3">即時報價更新，每次 Fugle 推送時觸發。</p>
              <CodeBlock language="typescript" code={`socket.on('tick', (data) => {
  /*
  {
    symbol:    "2330",
    price:     920.0,
    volume:    12345,
    timestamp: "2026-07-01T10:30:00Z"
  }
  */
  console.log(\`\${data.symbol} 報價：\${data.price}\`);
});`} />
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <code className="text-sky-400 font-mono text-sm bg-slate-800 px-2 py-0.5 rounded">notification</code>
                <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-900/20 border border-amber-700/30 rounded px-1.5 py-0.5"><Lock className="w-3 h-3" /> 需要 JWT 認證</span>
              </div>
              <p className="text-sm text-slate-400 mb-3">屬於你帳號的規則觸發通知，只有你能收到。</p>
              <CodeBlock language="typescript" code={`socket.on('notification', (data) => {
  /*
  {
    ruleId:      "clxxxxxxxx",
    ruleName:    "台積電突破均線",
    triggerId:   "clxxxxxxxx",
    symbol:      "2330",
    signal:      "BUY",
    price:       920,
    message:     "2330 股價突破20日均線",
    triggeredAt: "2026-07-01T10:30:00Z"
  }
  */
  console.log(\`訊號：\${data.signal} \${data.symbol} @ \${data.price}\`);
});`} />
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <code className="text-slate-400 font-mono text-sm bg-slate-800 px-2 py-0.5 rounded">signal</code>
                <span className="text-xs text-slate-500">所有客戶端均可接收（廣播）</span>
              </div>
              <p className="text-sm text-slate-400 mb-3">全域廣播的規則觸發事件，所有已連線的客戶端都會收到（不論帳號）。資料格式與 notification 相同。</p>
              <CodeBlock language="typescript" code={`socket.on('signal', (data) => {
  console.log('全域訊號：', data.ruleName, data.signal);
});`} />
            </div>

          </div>
        </div>

        {/* Event table */}
        <div className="mt-8 rounded-xl border border-slate-800 overflow-hidden">
          <div className="px-5 py-3 bg-slate-900 border-b border-slate-800">
            <p className="text-sm font-semibold text-slate-300">事件一覽表</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/50">
                <th className="text-left px-5 py-2.5 text-xs text-slate-500 font-medium w-32">事件名稱</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-medium w-20">方向</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-medium">說明</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-medium w-24">是否需認證</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {[
                { name: 'subscribe', dir: '發送', desc: '訂閱股票即時報價', needsAuth: '否' },
                { name: 'unsubscribe', dir: '發送', desc: '取消訂閱報價', needsAuth: '否' },
                { name: 'tick', dir: '接收', desc: '即時報價更新', needsAuth: '否' },
                { name: 'signal', dir: '接收', desc: '規則觸發廣播（所有人）', needsAuth: '否' },
                { name: 'notification', dir: '接收', desc: '帳號專屬規則觸發通知', needsAuth: '是' },
              ].map((row) => (
                <tr key={row.name} className="hover:bg-slate-900/40 transition-colors">
                  <td className="px-5 py-3"><code className="text-sky-300 font-mono text-xs">{row.name}</code></td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{row.dir}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{row.desc}</td>
                  <td className="px-4 py-3 text-xs">
                    {row.needsAuth === '是'
                      ? <span className="text-amber-400">是</span>
                      : <span className="text-slate-500">否</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-slate-600 mt-16">智股通 API · Base URL: <code className="text-slate-500">http://localhost:3001</code></p>
      </div>
    </div>
  );
}
