# Detailed Guide: DuckDNS + SSL for Docker (GHCR) Setup

Since you are running the application via Docker, setting up a real, valid SSL certificate ensures that your PWA installation works flawlessly across all devices (including iOS) without annoying browser warnings.

We will achieve this using a free dynamic DNS provider (DuckDNS) and Let's Encrypt's DNS-01 challenge. This method is highly secure as it doesn't require opening any ports on your router.

## Step 1: Claim your Free Domain
1. Go to [DuckDNS.org](https://www.duckdns.org/) and log in (using Google, GitHub, etc.).
2. Type a unique name (e.g., `my-drum-tabs`) and click **"add domain"**.
3. Under **"current ip"**, change the public IP to your local Server's private IP (e.g. `192.168.1.100`). Click **"update ip"**.
4. Copy the **"token"** at the top of the page. You will need this shortly.

## Step 2: Install `acme.sh`
Log in to your machine via SSH. We will use `acme.sh` because it has native, easy-to-use support for the DuckDNS API.
```bash
curl https://get.acme.sh | sh -s email=your-email@example.com
```
Reload your bash profile:
```bash
source ~/.bashrc
```

## Step 3: Issue the Certificate
Export your DuckDNS token as an environment variable. This allows `acme.sh` to temporarily prove to Let's Encrypt that you own the domain by setting a DNS record.
```bash
export DuckDNS_Token="your-duckdns-token-here"
```
Generate the certificate (this process takes about 2-3 minutes):
```bash
acme.sh --issue --dns dns_duckdns -d yourdomain.duckdns.org
```

## Step 4: Install the Certificate for Docker
Create a folder next to your `docker-compose.yml` file to store the certificates:
```bash
mkdir -p certs
```
Install the certificates into this new folder. We must use this exact command so `acme.sh` can automatically renew and overwrite these files every 60 days:
```bash
acme.sh --install-cert -d yourdomain.duckdns.org \
--key-file       $(pwd)/certs/key.pem  \
--fullchain-file $(pwd)/certs/cert.pem
```

## Step 5: Verify Volume Mounts
The provided `docker-compose.yml` is already configured to look for SSL certificates. By default, it maps a local `./certs` folder into the container:

```yaml
    volumes:
      - ./downloads:/app/downloads
      # This mount automatically enables HTTPS if certificates are found here
      - ./certs:/app/certs:ro
```

If you installed the certificates into a different folder in Step 4, simply update `./certs` in the `docker-compose.yml` file to the absolute path of your custom folder.

## Step 6: Restart the Container!
To ensure Docker properly maps the new volume mounts and certificates, it is best practice to wind down the container first and bring it back up:
```bash
docker compose down
docker compose up -d
```

When the container starts, `app.py` will find the mounted certificates and automatically switch to HTTPS. You can now access your PWA flawlessly at `https://yourdomain.duckdns.org:5000`.
