import axios from 'axios';

/** Logs into the AI股探 server with the user's dashboard credentials to obtain a JWT for the signal socket. Never touches Fubon credentials. */
export async function loginToServer(serverUrl: string, username: string, password: string): Promise<string> {
  const res = await axios.post<{ token: string }>(`${serverUrl}/api/auth/login`, { username, password });
  return res.data.token;
}
