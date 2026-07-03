'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  Mail, MessageSquare, Disc, CheckCircle, XCircle, Send,
  Lock, Link2, Link2Off, RefreshCw, ExternalLink,
} from 'lucide-react';

interface Settings {
  email: string | null;
  lineUserId: string | null;
  discordUserId: string | null;
}

interface LineCode {
  code: string;
  expiry: string;
  qrCodeUrl: string | null;
  botBasicId: string;
}

// ─── Discord OAuth result banner ───────────────────────────────────────────────
function DiscordCallbackBanner({ onBound }: { onBound: () => void }) {
  const params = useSearchParams();
  const discord = params.get('discord');

  useEffect(() => {
    if (discord === 'bound') onBound();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discord]);

  if (!discord) return null;

  if (discord === 'bound') {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3">
        <CheckCircle className="w-4 h-4 flex-shrink-0" />
        Discord 帳號綁定成功！
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
      <XCircle className="w-4 h-4 flex-shrink-0" />
      Discord 綁定失敗，請再試一次。
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings>({ email: null, lineUserId: null, discordUserId: null });
  const [email, setEmail] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<'ok' | 'error' | null>(null);

  // LINE binding state
  const [lineCode, setLineCode] = useState<LineCode | null>(null);
  const [lineCodeLoading, setLineCodeLoading] = useState(false);
  const [lineSecondsLeft, setLineSecondsLeft] = useState(0);
  const [lineTesting, setLineTesting] = useState(false);
  const [lineTestResult, setLineTestResult] = useState<'ok' | 'error' | null>(null);
  const [lineUnbinding, setLineUnbinding] = useState(false);

  // Discord binding state
  const [discordLoading, setDiscordLoading] = useState(false);
  const [discordTesting, setDiscordTesting] = useState(false);
  const [discordTestResult, setDiscordTestResult] = useState<'ok' | 'error' | null>(null);
  const [discordTestError, setDiscordTestError] = useState<string | null>(null);
  const [discordUnbinding, setDiscordUnbinding] = useState(false);
  const [discordGuildJoined, setDiscordGuildJoined] = useState<boolean | null>(null);
  const [discordInviteUrl, setDiscordInviteUrl] = useState<string | null>(null);
  const [discordGuildChecking, setDiscordGuildChecking] = useState(false);

  // Password change state
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdSaved, setPwdSaved] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
      setEmail(s.email || '');
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const checkDiscordGuild = useCallback(async () => {
    setDiscordGuildChecking(true);
    try {
      const { joined, inviteUrl } = await api.getDiscordGuildStatus();
      setDiscordGuildJoined(joined);
      setDiscordInviteUrl(inviteUrl);
    } catch (err) {
      console.error(err);
    } finally {
      setDiscordGuildChecking(false);
    }
  }, []);

  useEffect(() => {
    if (settings.discordUserId) checkDiscordGuild();
  }, [settings.discordUserId, checkDiscordGuild]);

  // Countdown timer for LINE binding code
  useEffect(() => {
    if (!lineCode) return;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(lineCode.expiry).getTime() - Date.now()) / 1000));
      setLineSecondsLeft(remaining);
      if (remaining <= 0) setLineCode(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lineCode]);

  // ─── Email ────────────────────────────────────────────────────────────────────
  const saveEmail = async () => {
    setEmailSaving(true);
    try {
      await api.updateSettings({ email });
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 3000);
      await loadSettings();
    } finally {
      setEmailSaving(false);
    }
  };

  const testEmail = async () => {
    setEmailTesting(true);
    try {
      await api.testNotification('email');
      setEmailTestResult('ok');
    } catch {
      setEmailTestResult('error');
    } finally {
      setEmailTesting(false);
      setTimeout(() => setEmailTestResult(null), 5000);
    }
  };

  // ─── LINE ─────────────────────────────────────────────────────────────────────
  const generateLineCode = async () => {
    setLineCodeLoading(true);
    try {
      const result = await api.getLineCode();
      setLineCode(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLineCodeLoading(false);
    }
  };

  const unbindLine = async () => {
    setLineUnbinding(true);
    try {
      await api.unbindLine();
      await loadSettings();
      setLineCode(null);
    } finally {
      setLineUnbinding(false);
    }
  };

  const testLine = async () => {
    setLineTesting(true);
    try {
      await api.testNotification('line');
      setLineTestResult('ok');
    } catch {
      setLineTestResult('error');
    } finally {
      setLineTesting(false);
      setTimeout(() => setLineTestResult(null), 5000);
    }
  };

  // ─── Discord ──────────────────────────────────────────────────────────────────
  const authorizeDiscord = async () => {
    setDiscordLoading(true);
    try {
      const { url } = await api.getDiscordUrl();
      window.location.href = url;
    } catch (err) {
      console.error(err);
      setDiscordLoading(false);
    }
  };

  const unbindDiscord = async () => {
    setDiscordUnbinding(true);
    try {
      await api.unbindDiscord();
      await loadSettings();
    } finally {
      setDiscordUnbinding(false);
    }
  };

  const testDiscord = async () => {
    setDiscordTesting(true);
    setDiscordTestError(null);
    try {
      await api.testNotification('discord');
      setDiscordTestResult('ok');
    } catch (err) {
      setDiscordTestResult('error');
      if (err instanceof Error && err.message.includes('discord_not_in_guild')) {
        setDiscordTestError('尚未加入 Discord 伺服器');
        setDiscordGuildJoined(false);
      }
    } finally {
      setDiscordTesting(false);
      setTimeout(() => setDiscordTestResult(null), 5000);
    }
  };

  // ─── Password ─────────────────────────────────────────────────────────────────
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPwd || !newPwd || !confirmPwd) { setPwdError('請填寫所有欄位'); return; }
    if (newPwd !== confirmPwd) { setPwdError('兩次輸入的新密碼不一致'); return; }
    if (newPwd.length < 6) { setPwdError('新密碼至少需要 6 個字元'); return; }
    setPwdError('');
    setPwdLoading(true);
    try {
      await api.updatePassword({ currentPassword: currentPwd, newPassword: newPwd });
      setPwdSaved(true);
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
      setTimeout(() => setPwdSaved(false), 3000);
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : '密碼更新失敗');
    } finally {
      setPwdLoading(false);
    }
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Account Info */}
      <div className="mb-8">
        <h1 className="text-xl font-bold text-slate-100 mb-1">帳號設定</h1>
        <p className="text-sm text-slate-400">管理您的帳號資訊與通知方式。</p>
        {user && (
          <div className="mt-3 inline-flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300">
            <span className="text-slate-500">登入身份：</span>
            <span className="font-medium text-sky-400">{user.username}</span>
          </div>
        )}
      </div>

      {/* Discord OAuth callback banner */}
      <Suspense fallback={null}>
        <DiscordCallbackBanner onBound={loadSettings} />
      </Suspense>

      {/* ── Email Section ── */}
      <h2 className="text-base font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Mail className="w-4 h-4 text-sky-400" />
        電子郵件通知
      </h2>
      <div className="card p-5 mb-6">
        <div className="flex gap-2">
          <input
            className="input"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            onClick={saveEmail}
            disabled={emailSaving}
            className="btn-primary flex-shrink-0 flex items-center gap-1.5 text-sm"
          >
            {emailSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
            儲存
          </button>
          <button
            onClick={testEmail}
            disabled={!settings.email || emailTesting}
            className="btn-ghost flex-shrink-0 flex items-center gap-1.5 text-sm"
          >
            <Send className={`w-4 h-4 ${emailTesting ? 'animate-pulse' : ''}`} />
            測試
          </button>
        </div>
        {emailSaved && (
          <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> 已儲存</p>
        )}
        {emailTestResult && (
          <p className={`text-xs mt-2 flex items-center gap-1 ${emailTestResult === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
            {emailTestResult === 'ok' ? <><CheckCircle className="w-3.5 h-3.5" /> 測試郵件已發送！</> : <><XCircle className="w-3.5 h-3.5" /> 發送失敗，請確認 SMTP 設定。</>}
          </p>
        )}
        <p className="text-xs text-slate-500 mt-2">使用伺服器 SMTP 設定發送。</p>
      </div>

      {/* ── LINE Bot Section ── */}
      <h2 className="text-base font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-green-400" />
        LINE 通知
      </h2>
      <div className="card p-5 mb-6">
        {settings.lineUserId ? (
          /* Bound state */
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-emerald-400 font-medium">已綁定</span>
              <span className="text-xs text-slate-500 font-mono ml-1">{settings.lineUserId}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={testLine}
                disabled={lineTesting}
                className="btn-ghost flex items-center gap-1.5 text-sm"
              >
                <Send className={`w-4 h-4 ${lineTesting ? 'animate-pulse' : ''}`} />
                測試通知
              </button>
              <button
                onClick={unbindLine}
                disabled={lineUnbinding}
                className="btn-ghost flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300"
              >
                <Link2Off className="w-4 h-4" />
                {lineUnbinding ? '解除中…' : '解除綁定'}
              </button>
            </div>
            {lineTestResult && (
              <p className={`text-xs mt-2 flex items-center gap-1 ${lineTestResult === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                {lineTestResult === 'ok' ? <><CheckCircle className="w-3.5 h-3.5" /> 測試訊息已發送！</> : <><XCircle className="w-3.5 h-3.5" /> 發送失敗。</>}
              </p>
            )}
          </div>
        ) : (
          /* Unbound state */
          <div>
            <p className="text-sm text-slate-400 mb-4">掃描 QR Code 加入 LINE 官方帳號，並發送綁定碼完成綁定。</p>

            {lineCode && lineSecondsLeft > 0 ? (
              <div className="flex flex-col sm:flex-row gap-6 items-start">
                {lineCode.qrCodeUrl && (
                  <div className="flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={lineCode.qrCodeUrl}
                      alt="LINE QR Code"
                      width={160}
                      height={160}
                      className="rounded-xl border border-slate-700"
                    />
                    <p className="text-xs text-slate-500 mt-2 text-center">掃描加入好友</p>
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-xs text-slate-400 mb-2">加入後，在對話框中發送以下綁定碼：</p>
                  <div className="bg-slate-800 border border-slate-600 rounded-xl px-6 py-4 text-center mb-3">
                    <span className="text-3xl font-mono font-bold tracking-[0.3em] text-sky-300">
                      {lineCode.code}
                    </span>
                  </div>
                  <p className={`text-xs flex items-center gap-1 ${lineSecondsLeft < 60 ? 'text-red-400' : 'text-slate-500'}`}>
                    有效時間：{fmtTime(lineSecondsLeft)}
                  </p>
                  <button
                    onClick={generateLineCode}
                    disabled={lineCodeLoading}
                    className="btn-ghost flex items-center gap-1.5 text-xs mt-3"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    重新取得綁定碼
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={generateLineCode}
                disabled={lineCodeLoading}
                className="btn-primary flex items-center gap-2"
              >
                <Link2 className="w-4 h-4" />
                {lineCodeLoading ? '取得中…' : '取得綁定碼'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Discord Bot Section ── */}
      <h2 className="text-base font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Disc className="w-4 h-4 text-indigo-400" />
        Discord 通知
      </h2>
      <div className="card p-5 mb-8">
        {settings.discordUserId ? (
          /* Bound state */
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-emerald-400 font-medium">已綁定</span>
              <span className="text-xs text-slate-500 font-mono ml-1">{settings.discordUserId}</span>
            </div>

            {discordGuildJoined === false && (
              <div className="mb-3 flex flex-col gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
                <span>Discord 政策要求 Bot 與使用者需有共同伺服器才能私訊。請先加入指定伺服器以接收通知。</span>
                <div className="flex gap-2">
                  {discordInviteUrl && (
                    <a
                      href={discordInviteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary text-xs flex items-center gap-1.5 w-fit"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      加入 Discord 伺服器
                    </a>
                  )}
                  <button
                    onClick={checkDiscordGuild}
                    disabled={discordGuildChecking}
                    className="btn-ghost text-xs flex items-center gap-1.5 w-fit"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${discordGuildChecking ? 'animate-spin' : ''}`} />
                    已加入，重新檢查
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={testDiscord}
                disabled={discordTesting}
                className="btn-ghost flex items-center gap-1.5 text-sm"
              >
                <Send className={`w-4 h-4 ${discordTesting ? 'animate-pulse' : ''}`} />
                測試通知
              </button>
              <button
                onClick={unbindDiscord}
                disabled={discordUnbinding}
                className="btn-ghost flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300"
              >
                <Link2Off className="w-4 h-4" />
                {discordUnbinding ? '解除中…' : '解除綁定'}
              </button>
            </div>
            {discordTestResult && (
              <p className={`text-xs mt-2 flex items-center gap-1 ${discordTestResult === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                {discordTestResult === 'ok' ? <><CheckCircle className="w-3.5 h-3.5" /> 測試訊息已發送！</> : <><XCircle className="w-3.5 h-3.5" /> {discordTestError || '發送失敗。'}</>}
              </p>
            )}
          </div>
        ) : (
          /* Unbound state */
          <div>
            <p className="text-sm text-slate-400 mb-4">
              透過 Discord OAuth2 授權，讓智股通 Bot 傳送私訊通知給您。
            </p>
            <button
              onClick={authorizeDiscord}
              disabled={discordLoading}
              className="btn-primary flex items-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              {discordLoading ? '跳轉中…' : '授權 Discord Bot'}
            </button>
          </div>
        )}
      </div>

      {/* ── Password Change ── */}
      <div className="border-t border-slate-800 pt-8">
        <h2 className="text-base font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Lock className="w-4 h-4 text-sky-400" />
          更改密碼
        </h2>

        <form onSubmit={changePassword} className="card p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">目前密碼</label>
            <input
              className="input"
              type="password"
              placeholder="輸入目前密碼"
              value={currentPwd}
              onChange={(e) => setCurrentPwd(e.target.value)}
              disabled={pwdLoading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">新密碼</label>
            <input
              className="input"
              type="password"
              placeholder="至少 6 個字元"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              disabled={pwdLoading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">確認新密碼</label>
            <input
              className="input"
              type="password"
              placeholder="再次輸入新密碼"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              disabled={pwdLoading}
            />
          </div>

          {pwdError && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {pwdError}
            </p>
          )}

          <div className="flex items-center gap-4">
            <button type="submit" disabled={pwdLoading} className="btn-primary flex items-center gap-2">
              <Lock className="w-4 h-4" />
              {pwdLoading ? '更新中…' : '更新密碼'}
            </button>
            {pwdSaved && (
              <span className="flex items-center gap-1.5 text-emerald-400 text-sm">
                <CheckCircle className="w-4 h-4" />
                密碼已更新！
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
