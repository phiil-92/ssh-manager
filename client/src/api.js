let _suppressVaultLocked = false;
let _vaultLockedWhileSuppressed = false;

function getToken() { return sessionStorage.getItem("session-token") || ""; }

async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      "x-session-token": getToken(),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.error !== "Wrong password" && data.error !== "Invalid authenticator code" && data.error !== "Invalid code — try again" && data.error !== "Invalid code") {
      if (_suppressVaultLocked) { _vaultLockedWhileSuppressed = true; }
      else window.dispatchEvent(new CustomEvent("vault-locked"));
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  // suppression — called when settings opens/closes
  setVaultLockedSuppressed: (suppress) => {
    _suppressVaultLocked = suppress;
    if (!suppress && _vaultLockedWhileSuppressed) {
      _vaultLockedWhileSuppressed = false;
      window.dispatchEvent(new CustomEvent("vault-locked"));
    }
  },
  authStatus: () => fetch("/api/auth/status").then((r) => r.json()),

  getSessionToken: () => sessionStorage.getItem("session-token") || "",

  vaultStatus: () => req("/api/vault/status"),

  vaultSetup: async (password) => {
    const data = await req("/api/vault/setup", { method: "POST", body: JSON.stringify({ password }) });
    if (data.token) sessionStorage.setItem("session-token", data.token);
    return data;
  },

  vaultUnlock: async (password, token = null) => {
    const res  = await fetch("/api/vault/unlock", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ password, token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    if (data.token) sessionStorage.setItem("session-token", data.token);
    return data; // { ok: true } or { requires2fa: true }
  },

  vaultLock: async () => {
    const data = await req("/api/vault/lock", { method: "POST" });
    sessionStorage.removeItem("session-token");
    return data;
  },

  changeMasterPassword: (currentPassword, newPassword) =>
    req("/api/vault/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),

  wipeAll: async () => {
    const data = await req("/api/vault/wipe", { method: "POST" });
    sessionStorage.removeItem("session-token");
    return data;
  },

  // 2FA
  setup2FA:   ()      => req("/api/vault/2fa/setup",   { method: "POST" }),
  confirm2FA: (token) => req("/api/vault/2fa/confirm", { method: "POST", body: JSON.stringify({ token }) }),
  disable2FA: (token) => req("/api/vault/2fa/disable", { method: "POST", body: JSON.stringify({ token }) }),

  // Export / Import
  exportData: async (password) => {
    const res = await fetch("/api/export", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-session-token": getToken() },
      body:    JSON.stringify({ password }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Export failed"); }
    return res.blob();
  },
  importData: (fileData, password) =>
    req("/api/import", { method: "POST", body: JSON.stringify({ fileData, password }) }),

  // Folders
  listFolders:  ()         => req("/api/folders"),
  addFolder:    (name)     => req("/api/folders",       { method: "POST",   body: JSON.stringify({ name }) }),
  renameFolder: (id, name) => req(`/api/folders/${id}`, { method: "PUT",    body: JSON.stringify({ name }) }),
  deleteFolder: (id)       => req(`/api/folders/${id}`, { method: "DELETE" }),

  // Hosts
  listHosts:   ()         => req("/api/hosts"),
  addHost:     (host)     => req("/api/hosts",       { method: "POST",   body: JSON.stringify(host) }),
  updateHost:  (id, host) => req(`/api/hosts/${id}`, { method: "PUT",    body: JSON.stringify(host) }),
  deleteHost:  (id)       => req(`/api/hosts/${id}`, { method: "DELETE" }),
  wakeOnLan:   (id)       => req(`/api/wol/${id}`,   { method: "POST" }),

  // Snippets
  listSnippets:  ()      => req("/api/snippets"),
  addSnippet:    (s)     => req("/api/snippets",       { method: "POST",   body: JSON.stringify(s) }),
  updateSnippet: (id, s) => req(`/api/snippets/${id}`, { method: "PUT",    body: JSON.stringify(s) }),
  deleteSnippet: (id)    => req(`/api/snippets/${id}`, { method: "DELETE" }),
  
  // Snippet folders
  listSnippetFolders:  ()         => req("/api/snippet-folders"),
  addSnippetFolder:    (name)     => req("/api/snippet-folders",       { method: "POST",   body: JSON.stringify({ name }) }),
  renameSnippetFolder: (id, name) => req(`/api/snippet-folders/${id}`, { method: "PUT",    body: JSON.stringify({ name }) }),
  deleteSnippetFolder: (id)       => req(`/api/snippet-folders/${id}`, { method: "DELETE" }),
};


