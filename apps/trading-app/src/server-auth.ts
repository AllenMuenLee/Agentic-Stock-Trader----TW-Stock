import axios from 'axios';

/** Logs into the AI股探 server with the user's dashboard credentials (now email-based, see apps/api/src/routes/auth.ts) to obtain a JWT for the signal socket. Never touches Fubon credentials. */
export async function loginToServer(serverUrl: string, email: string, password: string): Promise<string> {
  const res = await axios.post<{ token: string }>(`${serverUrl}/api/auth/login`, { email, password });
  return res.data.token;
}
