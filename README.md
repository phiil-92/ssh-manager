### Web-Based SSH Connection Manager meant for personal use.

![preview](https://i.ibb.co/LzLy3GYc/fil22.png)

## v0.9.2

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
- Wake-On-Lan (Save the MAC-Address of the host you want to wake when connecting for it to work)
- Option to log terminal inputs and download them at any point

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
- 2FA
- Credential store AES256-GCM encrypted

##

### Install 
Requires Docker

docker-compose.yml:

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

Open the App on: http://server-ip:3000

> [!NOTE]
> I made this as a tool for myself to use in my homelab using claude, use at your own discretion.
