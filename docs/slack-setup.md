# Slack Integration Setup

## Overview

One Slack channel per project, auto-managed. Each ticket = one Slack message. Agent activity posts as thread replies. Replying in a thread adds a comment to the ticket. `/reopen` in a thread reopens the ticket.

Public URL: `https://slack.your-domain.dev` (permanent, via Cloudflare Tunnel)

---

## 1. Cloudflare Tunnel — first-time setup

This exposes your local backend (port 50008) to the internet so Slack can POST events to it.

### Install and authenticate

```bash
brew install cloudflared
cloudflared tunnel login
# Opens browser → select your Cloudflare account → authorise
# Writes cert to ~/.cloudflared/cert.pem
```

### Create the tunnel

```bash
cloudflared tunnel create overemployed
# Writes credentials to ~/.cloudflared/<tunnel-id>.json
# Note the tunnel ID printed — you need it for config.yml
```

### Add DNS record

```bash
cloudflared tunnel route dns overemployed slack.your-domain.dev
```

If that fails (domain not on Cloudflare nameservers), add it manually in the Cloudflare dashboard:

```
Type:    CNAME
Name:    slack
Content: <tunnel-id>.cfargotunnel.com
Proxy:   Proxied (orange cloud ON)
TTL:     Auto
```

### Create the config file

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /Users/<your-username>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: slack.your-domain.dev
    service: http://127.0.0.1:50008
  - service: http_status:404
```

Replace `<tunnel-id>` with the ID printed when you ran `cloudflared tunnel create`.

### Current tunnel info (already set up)

- Tunnel ID: `40dd9625-b1de-4b00-b827-472b31fa709c`
- Credentials: `~/.cloudflared/40dd9625-b1de-4b00-b827-472b31fa709c.json`
- Config: `~/.cloudflared/config.yml`

---

## 2. Running the tunnel

Run this in a separate terminal before starting the app:

```bash
cloudflared tunnel run overemployed
```

You should see `INF Registered tunnel connection` — then `https://slack.your-domain.dev` is live.

---

## 3. Slack App — first-time setup

### Create the app

1. Go to **https://api.slack.com/apps**
2. Click **Create New App** → **From a manifest**
3. Select your workspace
4. Choose the **JSON** tab
5. Go to **Settings → Slack** in the app and click **Copy App Manifest** — enter your domain when prompted, then copy

### Install and get credentials

1. **Install App** → Install to workspace → Allow
2. **OAuth & Permissions** → copy the **Bot User OAuth Token** (`xoxb-...`)
3. **Basic Information** → copy the **Signing Secret**
4. Go to **Settings → Slack** in the app and paste both fields → Save

---

## 4. How it works

| Event | What happens in Slack |
|---|---|
| Ticket created | New message posted to `#oe-{project-name}` |
| Agent adds activity | Reply in the ticket's thread |
| Ticket moves columns | Reply: "Status → In Progress / Done / Blocked" |
| PR opened/merged | Reply in thread |
| User replies in thread | Comment added to ticket |
| User sends `/reopen` in thread | Ticket moved to Reopened column |

Channels are created automatically when a project is first used.
