Web-Based SSH Connection Manager meant for personal use.

<img width="1916" height="931" alt="file3" src="https://github.com/user-attachments/assets/6707a82e-8d16-4d1f-993e-b2fa66fe6be4" />

## v0.7.0

### Snippet Panel
- Panel on the right side (toggle via "Snippets" button)
- Add, edit, delete command snippets
- Click snippet to run it

### Encrypted Export/Import
- Export connections, folders and snippets to a ".sshm" file
- File is encrypted with AES256-GCM using your master password
- Import on any instance using the master password the file was exported with

### Feature list
- AES256-GCM encrypted credential store
- Tabs and split view
- Folders, tags, favourites
- Recent connections launcher
- Snippet panel for shortcuts
- Option to export/import saved connections encrypted as .sshm files
- Server stats at the bottom of connected instance (cpu, ram, disk, ping, session time, user)

## Install 
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

### I "made" this as a tool for myself to use in my homelab using claude. This is not intended as a official piece of software with the goal of doing big numbers since this is a Vibe-Coded tool.
### I do not support Vibe-Coded software with the goal of making big numbers being sold and so on.
