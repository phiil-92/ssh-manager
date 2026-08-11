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
  updateHost: (id, host) => req(`/api/hosts/${id}`, { method: "PUT", body: JSON.stringify(host) }),
  changeMasterPassword: (currentPassword, newPassword) =>
    req("/api/vault/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  wipeAll: () => req("/api/vault/wipe", { method: "POST" }),
  listFolders: () => req("/api/folders"),
  addFolder: (name) => req("/api/folders", { method: "POST", body: JSON.stringify({ name }) }),
  renameFolder: (id, name) => req(`/api/folders/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  deleteFolder: (id) => req(`/api/folders/${id}`, { method: "DELETE" }),
  listSnippets: () => req("/api/snippets"),
  addSnippet: (s) => req("/api/snippets", { method: "POST", body: JSON.stringify(s) }),
  updateSnippet: (id, s) => req(`/api/snippets/${id}`, { method: "PUT", body: JSON.stringify(s) }),
  deleteSnippet: (id) => req(`/api/snippets/${id}`, { method: "DELETE" }),
  exportData: async (password) => {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Export failed"); }
    return res.blob();
  },
  importData: (fileData, password) => req("/api/import", { method: "POST", body: JSON.stringify({ fileData, password }) }),
};
