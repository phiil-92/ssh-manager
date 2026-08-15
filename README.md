### Web-Based SSH Connection Manager

![preview](https://i.ibb.co/LzLy3GYc/fil22.png)

## v1.0.0

### Feature list
- Credential store
- Tabs and split view
- Folders, tags, favourites
- Recent connections launcher
- Snippet panel for shortcuts
- Option to export/import saved connections encrypted as .sshm files
- Server stats at the bottom of connected instance (cpu, ram, disk, ping, session time, user)
- Tab groups
- Terminal Themes
- Global UI themes
- Wake-On-Lan (Save the MAC-Address of the host you want to wake when connecting for it to work)
- Session logging

### Snippet Panel
- Panel on the right side (toggle via "Snippets" button)
- Add, edit, delete command snippets
- Click snippet to run it

### Encrypted Export/Import
- Export connections, folders and snippets to a ".sshm" file
- File is encrypted with AES256-GCM using your master password
- Import on any instance using the master password the file was exported with

### Security
- This is intended to be used in a trusted network / homelab. Do not expose to the internet or an untrusted network.(Atleast not without a reverse proxy, but honestly just don't...)
- Recommend putting it behind a reverse proxy with HTTPS.
- 2FA TOTP
- Credential store AES256-GCM encrypted
- Single Sign On via OIDC (Keycloak, Authelia, Authentik, Google Workspace, and others)

##

### Install 
Requires Docker

**`docker-compose.yml`:**
```yaml
services:
  ssh-manager:
    image: phiil92921/ssh-manager:latest
    container_name: ssh-manager
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - NODE_ENV=production

      # ---------- SSO (optional) ----------
      # Uncomment to enable Single Sign-On via any OIDC provider.
      # Tested with: Keycloak, Authelia, Authentik, Google Workspace
      #
      # - SSO_ENABLED=true
      # - SSO_ISSUER=https://auth.example.com/realms/myrealm
      # - SSO_CLIENT_ID=ssh-manager
      # - SSO_CLIENT_SECRET=your-client-secret
      # - SSO_REDIRECT_URI=http://your-server:3000/auth/callback
      # - SSO_ALLOWED_ROLES=ssh-manager-users  # optional: restrict by role/group
      # - SESSION_SECRET=change-this-to-a-long-random-string
```

```bash
docker compose up -d
```

Open the App on: http://server-ip:3000

### SSO Setup

SSO is disabled by default. When enabled, users must sign in via your OIDC provider before reaching the vault unlock screen. The vault master password remains independent and still protects all stored credentials.

**Supported providers (tested):**
- Keycloak
- Authelia
- Authentik
- Google Workspace

Any OIDC-compliant provider should work.

**Keycloak quick setup:**
1. Create a client - Client ID: `ssh-manager`, Client authentication: On
2. Set valid redirect URI to `http://your-server:3000/auth/callback`
3. Set web origins to `http://your-server:3000`
4. Copy the client secret from the Credentials tab
5. Optionally create a role `ssh-manager-users` and assign it to your users
6. Uncomment and fill in the SSO environment variables in `docker-compose.yml`
7. Restart the container

**Role restriction** (`SSO_ALLOWED_ROLES`): comma-separated list of roles or groups. Users without a matching role will see an "Access denied" message after SSO login. Leave unset to allow all authenticated users.

> [!NOTE]
> I made this as a tool for myself to use in my homelab using claude, use at your own discretion.

