const fs = require('fs');
const baileysLib = require('baron-baileys-v2');
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = baileysLib;
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const { handleCommand } = require('./commands');
const store = require('./store');

const SESSION_DIR = './session';
const PREFIX = process.env.PREFIX || '.';
const LINK_REGEX = /(https?:\/\/|chat\.whatsapp\.com\/|wa\.me\/)/i;

let sock = null;
let socketReady = false; // true once the WS handshake to WhatsApp has actually started

// Single source of truth the frontend polls via GET /api/status
// status: disconnected | connecting | pairing | connected
const state = {
  status: 'disconnected',
  message: '',
  pairingCode: null,
};

function getState() {
  return { ...state };
}

async function startSocket() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  socketReady = false;

  // Note: deliberately NOT calling fetchLatestBaileysVersion here. This fork
  // calibrates its protocol/crypto layer against a specific WA APK version
  // (see its changelog); forcing the generic upstream "latest" version against
  // that pinned layer is a plausible cause of pairing codes being rejected.
  // Let the library fall back to whatever version it was built/tested against.
  const browserTuple = baileysLib.Browsers?.ubuntu
    ? baileysLib.Browsers.ubuntu('Chrome')
    : ['Ubuntu', 'Chrome', '120.0.0.0'];

  sock = makeWASocket({
    auth: authState,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false, // pairing happens through the web UI, not the terminal
    browser: browserTuple,
  });

  if (authState.creds.registered) {
    state.status = 'connecting';
    state.message = 'Resuming session…';
  } else {
    state.status = 'disconnected';
    state.message = '';
  }
  state.pairingCode = null;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    socketReady = true; // any update means the WS handshake has actually begun
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      state.pairingCode = null;
      if (shouldReconnect) {
        state.status = 'connecting';
        state.message = 'Connection dropped, reconnecting…';
        console.log('[wa] connection closed, reconnecting...');
        setTimeout(() => startSocket().catch((e) => console.error('[wa] reconnect failed', e)), 2000);
      } else {
        state.status = 'disconnected';
        state.message = 'Logged out. Enter a number to link again.';
        console.log('[wa] logged out.');
      }
    } else if (connection === 'open') {
      state.status = 'connected';
      state.message = 'Bot is online.';
      state.pairingCode = null;
      console.log('[wa] connected to WhatsApp.');
    }
  });

  // Welcome messages
  sock.ev.on('group-participants.update', async (event) => {
    try {
      const settings = store.getGroup(event.id);
      if (!settings.welcome || event.action !== 'add') return;
      for (const participant of event.participants) {
        await sock.sendMessage(event.id, {
          text: `👋 Welcome @${participant.split('@')[0]} to the group!`,
          mentions: [participant],
        });
      }
    } catch (e) {
      console.error('[wa] welcome error', e);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const chatId = msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    const sender = isGroup ? msg.key.participant : chatId;

    const body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      '';

    // Antilink enforcement
    if (isGroup) {
      const settings = store.getGroup(chatId);
      if (settings.antilink && LINK_REGEX.test(body)) {
        try {
          const meta = await sock.groupMetadata(chatId);
          const participant = meta.participants.find((p) => p.id === sender);
          const senderIsAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
          if (!senderIsAdmin) {
            await sock.sendMessage(chatId, { delete: msg.key });
            await sock.sendMessage(chatId, {
              text: `🚫 @${sender.split('@')[0]} links aren't allowed here.`,
              mentions: [sender],
            });
            return;
          }
        } catch (e) {
          console.error('[wa] antilink error', e);
        }
      }
    }

    if (!body.startsWith(PREFIX)) return;
    const args = body.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();
    if (!command) return;

    try {
      await handleCommand(sock, msg, { command, args, isGroup, sender, chatId });
    } catch (e) {
      console.error('[wa] command error', e);
      await sock.sendMessage(chatId, { text: `❌ Error running command: ${e.message}` }, { quoted: msg });
    }
  });
}

async function waitUntilReady(timeoutMs = 15000) {
  const start = Date.now();
  while (!socketReady) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Socket never reached WhatsApp — check your internet connection and retry.');
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function requestPairingCode(rawNumber) {
  const cleaned = String(rawNumber || '').replace(/[^0-9]/g, '');
  if (!cleaned || cleaned.length < 6) {
    throw new Error('Enter a valid number with country code, digits only (no +, no leading 0).');
  }
  if (!sock) throw new Error('Bot is still starting up, try again in a few seconds.');
  if (sock.authState.creds.registered) {
    state.status = 'connecting';
    state.message = 'Already linked — reconnecting existing session.';
    return getState();
  }

  state.status = 'pairing';
  state.message = 'Waiting for socket handshake…';
  state.pairingCode = null;

  // Requesting a code before the WS handshake has started produces a code
  // WhatsApp's servers will reject with "Couldn't link device".
  await waitUntilReady();

  state.message = 'Requesting pairing code…';
  try {
    const code = await sock.requestPairingCode(cleaned);
    state.pairingCode = code;
    state.message = 'Enter this code in WhatsApp before it expires — request a new one if it stops working after ~60s.';
    return getState();
  } catch (e) {
    state.status = 'disconnected';
    state.message = '';
    state.pairingCode = null;
    throw new Error(`WhatsApp rejected the pairing request: ${e.message}`);
  }
}

async function logout() {
  try {
    if (sock) await sock.logout().catch(() => {});
  } finally {
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }
    state.status = 'disconnected';
    state.message = 'Session cleared. Enter a number to link again.';
    state.pairingCode = null;
    startSocket().catch((e) => console.error('[wa] restart after logout failed', e));
  }
}

module.exports = { startSocket, requestPairingCode, getState, logout };
