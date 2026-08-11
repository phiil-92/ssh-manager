ENTIRELY VIBE-CODED.
Web-Based SSH Connection Manager meant for personal use.

<img width="1900" height="920" alt="file1" src="https://github.com/user-attachments/assets/d25a187b-184a-4893-ac50-dce6eedb0e95" />


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
        image: phiil92921/ssh-manager:latest
        container_name: ssh-manager
        restart: unless-stopped
        ports:
          - "3000:3000"
        volumes:
          - ./data:/app/data
        environment:
          - NODE_ENV=production

Open the App on: http://server-ip:3000

