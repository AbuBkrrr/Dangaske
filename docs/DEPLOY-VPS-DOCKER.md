# Deploying on your VPS with Docker (Debian 13)

The site runs as its own container (`dangaske-web`) next to your other app. It does not touch your other containers.
Server IP: `102.68.85.97` · Domain: `dangaskerealestate.com.ng`

## 1. DNS
At your domain registrar add two **A records** pointing to `102.68.85.97`: `dangaskerealestate.com.ng` and `www`.

## 2. Get the code and settings
```bash
git clone https://github.com/AbuBkrrr/Dangaske.git && cd Dangaske
```
```bash
cp .env.example .env && nano .env
```
Set at least: `BASE_URL=https://dangaskerealestate.com.ng`, a long random `SESSION_SECRET`,
`ADMIN_PHONES=2348037572052,2348161304050`, plus the SMTP / WhatsApp / Paystack values when you have them.
Generate a secret with `openssl rand -hex 32`.

## 3. Start the container
```bash
mkdir -p data && chown 1000:1000 data
```
```bash
docker compose up -d --build
```
Check it: `docker compose ps` (should say *healthy*) and `curl -s http://127.0.0.1:3010/api/me`.
The site listens only on `127.0.0.1:3010`, so it cannot clash with your other app.

## 4. HTTPS and the domain — pick ONE
First see what already uses the web ports: `ss -tlnp | grep -E ':80 |:443 '`

**A. Something already serves 80/443 (nginx, Caddy, Traefik, Nginx Proxy Manager…)** — add the site to it.
- nginx:
```nginx
server {
    server_name dangaskerealestate.com.ng www.dangaskerealestate.com.ng;
    client_max_body_size 160m;
    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```
  then `certbot --nginx -d dangaskerealestate.com.ng -d www.dangaskerealestate.com.ng`.
- Caddy: add `dangaskerealestate.com.ng, www.dangaskerealestate.com.ng { request_body { max_size 160MB } reverse_proxy 127.0.0.1:3010 }`.
- Nginx Proxy Manager / Traefik: create a proxy host to `127.0.0.1:3010` (or `dangaske-web:3000` on a shared Docker network), enable SSL, and allow uploads up to 160 MB.

**B. Ports 80/443 are free** — use the included Caddy (automatic HTTPS):
```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.caddy.yml up -d --build
```
Open ports 80 and 443 in the VPS firewall if there is one.

## 5. First sign-in and checks
Open `https://dangaskerealestate.com.ng`, sign in with an admin phone number, then check **Admin → Settings → Integrations**.
WhatsApp and Paystack steps are in `docs/DEPLOY-WHOGOHOST.md` (sections 7 and 8; the webhook URLs are the same).
Email: create a mailbox at your email provider and put its SMTP details in `.env`, then `docker compose up -d`.

## Updating
```bash
git pull && docker compose up -d --build
```

## Backups (do this!)
Everything important is in `./data`. Add a nightly backup with `crontab -e`:
```
0 2 * * * tar czf /root/dangaske-backup-$(date +\%F).tar.gz -C /root/Dangaske data && find /root -name 'dangaske-backup-*' -mtime +14 -delete
```
(Adjust `/root/Dangaske` to where you cloned.) Copy backups off the server regularly.

## Useful commands
`docker compose logs -f web` · `docker compose restart web` · `docker compose down` (data is kept in `./data`).
