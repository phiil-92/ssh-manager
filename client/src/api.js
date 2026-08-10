async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  vaultStatus: () => req("/api/vault/status"),
  vaultSetup: (password) =>
    req("/api/vault/setup", { method: "POST", body: JSON.stringify({ password }) }),
  vaultUnlock: (password) =>
    req("/api/vault/unlock", { method: "POST", body: JSON.stringify({ password }) }),
  vaultLock: () => req("/api/vault/lock", { method: "POST" }),
  listHosts: () => req("/api/hosts"),
  addHost: (host) => req("/api/hosts", { method: "POST", body: JSON.stringify(host) }),
  deleteHost: (id) => req(`/api/hosts/${id}`, { method: "DELETE" }),
};
