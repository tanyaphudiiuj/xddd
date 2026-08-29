# WhatsApp MD Bot

A WhatsApp multi-device bot built on [baron-baileys-v2](https://github.com/7ucg/baron-baileys-v2) (a [Baileys](https://github.com/WhiskeySockets/Baileys) fork), with a **dark cyberpunk web UI** for pairing (enter your number in the browser, get the pairing code on-screen — no terminal, no QR scanner needed). Includes utility, group-management, and fun commands, plus ready-to-use deployment configs for Render, Railway, and Docker-based panels.

> ⚠️ **Note on Terms of Service:** this library connects to WhatsApp by reverse-engineering the WhatsApp Web protocol, not WhatsApp's official Business API. Automating a personal account this way can violate WhatsApp's Terms of Service and lead to the number being banned. Use a secondary/test number, not your primary one.
>
> **Note on this specific fork:** `baron-baileys-v2` is maintained by one person and, as of this writing, isn't published on the npm registry — it's installed straight from GitHub (`package.json` points at `github:7ucg/baron-baileys-v2`). It also ships an anti-ban module (rate limiting, connection fingerprinting, human-like typing simulation) that this project does **not** import or use — only the core socket/pairing functionality is wired up. Worth knowing since this library will hold your session credentials.

## Features

**Utility:** `.ping` `.alive` `.menu` `.owner` `.runtime` `.sticker`
**Group (admin only):** `.kick` `.promote` `.demote` `.tagall` `.antilink on/off` `.welcome on/off` `.mute` `.unmute`
**Fun:** `.meme` `.quote` `.joke` `.8ball` `.dice`

Commands and prefix are all defined in `lib/commands.js` — add new `case` blocks there to extend it.

## 1. Local setup

```bash
git clone <your-repo-url>
cd whatsapp-md-bot
npm install
cp .env.example .env
```

Edit `.env`:
- `OWNER_NUMBERS` — comma-separated numbers allowed to see owner info
- `PREFIX` — command prefix (default `.`)

Run it:

```bash
npm start
```

Open **http://localhost:3000** — you'll get the pairing terminal UI:

1. Type the WhatsApp number to link (digits only, country code, no `+`, e.g. `15551234567`).
2. Click **INITIATE LINK**. The screen switches to a live pairing code.
3. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number instead**, then enter the code shown (valid ~60s, shown by the countdown bar).
4. The UI flips to a **LINK ESTABLISHED** state once WhatsApp confirms the connection — that's your live status, polled automatically every 1.5s.

Once linked, `session/` holds your auth credentials — keep this folder private and never commit it (already in `.gitignore`). On every restart, if a `session/` already exists the bot **auto-resumes** the connection without needing the UI again; the UI is only needed for the first link (or after `TERMINATE SESSION` / a WhatsApp-side unlink).

## 2. Deploy to Render

1. Push this project to a GitHub repo.
2. In Render, click **New → Blueprint** and point it at your repo (it will read `render.yaml`), or **New → Web Service** manually with:
   - Build command: `npm install`
   - Start command: `npm start`
3. Set the `OWNER_NUMBERS` environment variable in the Render dashboard.
4. Deploy, then open the live URL Render gives you (e.g. `https://your-app.onrender.com`) — that's the pairing UI. Enter your number there and complete pairing in WhatsApp.

**Persistence caveat:** Render's free web services don't include a persistent disk, so the `session/` folder is lost on redeploy or when the instance is recreated — you'll need to re-pair. For a persistent session, add a paid **Persistent Disk** mounted at `/app/session`, or adapt `lib/store.js`-style logic to save the auth state to an external store (S3, a database, etc.) instead of the filesystem.

## 3. Deploy to Railway

1. Push to GitHub, then in Railway: **New Project → Deploy from GitHub repo**.
2. Railway auto-detects Node via `railway.json`/Nixpacks. Set `OWNER_NUMBERS` as a variable in the Railway dashboard.
3. Deploy, then open the generated Railway domain — that's the pairing UI. Enter your number and pair from there.
4. Railway volumes can be attached to `/app/session` for persistence across restarts (Settings → Volumes).

## 4. Deploy to other panels (Docker-based: Heroku, Fly.io, Koyeb, Panel hosts, VPS, etc.)

Use the included `Dockerfile`:

```bash
docker build -t whatsapp-md-bot .
docker run -d --name wa-bot \
  -e OWNER_NUMBERS=15551234567 \
  -v $(pwd)/session:/app/session \
  -p 3000:3000 \
  whatsapp-md-bot
```

Open `http://<host>:3000` for the pairing UI. Mounting `-v $(pwd)/session:/app/session` keeps the session on the host so it survives container restarts — this is the most reliable option for long-running bots since you fully control the disk.

For any generic Node.js panel (Pterodactyl, CyberPanel-style bot hosts, etc.), just point it at `npm install` as the install command and `npm start` (or `node index.js`) as the run command, and set the same environment variables.

## Extending it

Add new commands by adding a `case 'yourcommand':` block inside the `switch (command)` in `lib/commands.js`, and list it in the `MENU` string. Group-level toggles (like `antilink`/`welcome`) persist in `data/store.json` via `lib/store.js`.
