import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import readline from 'readline';

interface BridgeRequest {
  id: number;
  action: 'login' | 'placeOrder' | 'logout';
  params?: Record<string, unknown>;
}

interface BridgeResponse {
  id: number;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface FubonLoginParams {
  id: string;
  password: string;
  certPath: string;
  certPassword: string;
  /** When true, the bridge points the SDK at Fubon's simulation ("模擬") environment endpoint instead of production. */
  simulate: boolean;
}

export interface FubonOrderParams {
  symbol: string;
  side: 'Buy' | 'Sell';
  quantity: number;
}

export interface OrderResult {
  orderId: string | null;
  raw?: unknown;
}

/**
 * Talks to python/fubon_bridge.py over newline-delimited JSON on stdio. All
 * Fubon credentials are passed directly to the subprocess and never touch
 * the network or the AI股探 server.
 *
 * Real trading accounts connect to production; Fubon-issued simulation
 * ("模擬") accounts connect to Fubon's simulation endpoint
 * (wss://neoapitest.fbs.com.tw/TASP/XCPXWS) via `FubonSDK(url=...)` — see
 * python/fubon_bridge.py. Login/order call shapes are otherwise identical.
 */
export class FubonClient {
  private proc: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;

  constructor(pythonBin = process.env.PYTHON_BIN || 'python') {
    const scriptPath = path.join(__dirname, '..', 'python', 'fubon_bridge.py');
    this.proc = spawn(pythonBin, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });

    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => this.handleLine(line));
    this.proc.stderr.on('data', (chunk: Buffer) => console.error(`[FubonBridge] ${chunk.toString().trim()}`));
    this.proc.on('exit', (code) => {
      if (code !== null && code !== 0) console.warn(`[FubonBridge] process exited with code ${code}`);
    });
  }

  private handleLine(line: string): void {
    let msg: BridgeResponse;
    try {
      msg = JSON.parse(line) as BridgeResponse;
    } catch {
      return; // ignore stray non-JSON output (e.g. SDK banner text on stdout)
    }
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.ok) pending.resolve(msg.data);
    else pending.reject(new Error(msg.error || 'Fubon bridge error'));
  }

  private call(action: BridgeRequest['action'], params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify({ id, action, params } satisfies BridgeRequest)}\n`);
    });
  }

  async login(params: FubonLoginParams): Promise<void> {
    await this.call('login', { ...params });
  }

  async placeOrder(params: FubonOrderParams): Promise<OrderResult> {
    // The bridge stringifies whatever fubon_neo's place_order() returns — its exact
    // shape (order id field name, etc.) needs verifying against the official SDK docs
    // (see python/fubon_bridge.py), so we don't assume a structured order id here.
    const data = await this.call('placeOrder', { ...params });
    return { orderId: null, raw: data };
  }

  async logout(): Promise<void> {
    await this.call('logout');
  }

  shutdown(): void {
    this.proc.kill();
  }
}
