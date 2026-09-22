export class RemoteClient {
  constructor(public readonly id: string, private readonly token: string) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`/api/viewer/${encodeURIComponent(this.id)}/${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers, Authorization: `Bearer ${this.token}` },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'Viewer session expired or invalid.' : `Viewer service request failed (${response.status}).`);
    return response;
  }
}
