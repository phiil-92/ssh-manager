ENTIRELY VIBE-CODED.
SSH Connection Manager meant for personal use.

## Features so far
- AES256-GCM encrypted credential store
- Tabs and split view
- Folders, tags, favourites
- Server stats at the bottom of connected instance

## Install 
Requires Docker

docker-compose.yml:

    services:
      ssh-manager:
        image: ghcr.io/phiil92921/ssh-manager:latest
        container_name: ssh-manager
        restart: unless-stopped
        ports:
          - "3000:3000"
        volumes:
          - ./data:/app/data
        environment:
          - NODE_ENV=production

Open the App on: http://server-ip:3000
