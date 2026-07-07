import { exec } from 'child_process';

/** Opens the user's default browser to `url`. Best-effort — failures are non-fatal, the URL is always printed too. */
export function openBrowser(url: string): void {
  const command =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  exec(command, (err) => {
    if (err) console.warn(`[UI] 無法自動開啟瀏覽器，請手動開啟：${url}`);
  });
}
