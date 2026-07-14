import axios from 'axios';

/** Logs into the AI股探 server with the user's dashboard credentials (now email-based, see apps/api/src/routes/auth.ts) to obtain a JWT for the signal socket. Never touches Fubon credentials. */
export async function loginToServer(serverUrl: string, email: string, password: string): Promise<string> {
  const res = await axios.post<{ token: string }>(`${serverUrl}/api/auth/login`, { email, password });
  return res.data.token;
}

/** Checks whether a previously-saved JWT (see config.ts's aiToken) is still accepted by the server, so a restart can skip AI股探 login entirely when it is. */
export async function verifyToken(serverUrl: string, token: string): Promise<boolean> {
  try {
    await axios.get(`${serverUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    return true;
  } catch {
    return false;
  }
}
