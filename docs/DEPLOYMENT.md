# 🚀 Deployment Guide

## Prerequisites
- VPS: Ubuntu 24.04, 8GB RAM, 2 vCPU
- Domain pointed to VPS IP
- SSH access

## Step 1: System Setup

```bash
# Update system
apt update && apt upgrade -y

# Install dependencies
apt install -y nodejs npm python3 python3-pip ffmpeg git build-essential cmake

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2
npm install -g pm2

# Install Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Install Python packages
pip3 install --break-system-packages faster-whisper uvicorn fastapi python-multipart llama-cpp-python
```

## Step 2: Clone Repo

```bash
cd /root
git clone https://github.com/ARIKO13/alynne.edu.git
cd alynne.edu
```

## Step 3: Frontend Setup

```bash
cd frontend
cp ../config/env/frontend.env.template .env
# Edit .env with real values
nano .env

npm install --legacy-peer-deps
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

## Step 4: Backend Setup

```bash
cd ../backend
# Copy env config
cp ../config/env/backend.env.template .env

# Download Qwen model
mkdir -p /root/models
python3 -c "
from huggingface_hub import hf_hub_download
path = hf_hub_download(
    repo_id='Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    filename='qwen2.5-1.5b-instruct-q4_k_m.gguf',
    local_dir='/root/models',
)
print(f'Downloaded: {path}')
"

pm2 start ecosystem.config.cjs
pm2 save
```

## Step 5: Caddy Config

```bash
sudo cp ../config/Caddyfile /etc/caddy/Caddyfile
# Edit domain name
sudo nano /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Step 6: PM2 Startup

```bash
pm2 startup
pm2 save
```

## Step 7: Security Hardening

```bash
# SSH key only
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# UFW firewall
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Fail2ban
apt install -y fail2ban
cat > /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled = true
maxretry = 3
bantime = 86400
EOF
systemctl enable fail2ban
systemctl restart fail2ban

# Auto security updates
apt install -y unattended-upgrades
```

## Step 8: Add Swap (4GB)

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo "/swapfile none swap sw 0 0" >> /etc/fstab
```

## Verify

```bash
# Check services
pm2 list
systemctl status caddy
systemctl status fail2ban

# Test endpoints
curl https://your-domain.com/
curl https://your-domain.com/api/auth/status
curl https://your-domain.com/api/whisper/health
```
