const fetch = require('node-fetch');
const os = require('os');
const { downloadMediaMessage } = require('baron-baileys-v2');
const store = require('./store');

const BOT_NAME = process.env.BOT_NAME || 'MD-Bot';
const OWNERS = (process.env.OWNER_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);

const startTime = Date.now();

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

const MENU = `
╭───「 *${BOT_NAME}* 」
│
│ *UTILITY*
│ .ping — check bot latency
│ .alive — check bot status
│ .menu — show this menu
│ .owner — show owner contact
│ .runtime — show uptime
│ .sticker — reply an image/video with this to make a sticker
│
│ *GROUP (admins only)*
│ .kick @user — remove member
│ .promote @user — make admin
│ .demote @user — remove admin
│ .tagall — mention all members
│ .antilink on/off — auto-delete links
│ .welcome on/off — toggle welcome msgs
│ .mute / .unmute — restrict group to admins
│
│ *FUN*
│ .meme — random meme
│ .quote — random quote
│ .joke — random joke
│ .8ball <question> — magic 8-ball
│ .dice — roll a dice
│
╰────────────────
`.trim();

async function isSenderAdmin(sock, groupId, sender) {
  const meta = await sock.groupMetadata(groupId);
  const participant = meta.participants.find(p => p.id === sender);
  return participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
}

async function isBotAdmin(sock, groupId) {
  const meta = await sock.groupMetadata(groupId);
  const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
  const botP = meta.participants.find(p => p.id.startsWith(botId.split('@')[0]));
  return botP && (botP.admin === 'admin' || botP.admin === 'superadmin');
}

async function handleCommand(sock, msg, ctx) {
  const { command, args, isGroup, sender, chatId } = ctx;
  const text = args.join(' ');

  const reply = (content) => sock.sendMessage(chatId, content, { quoted: msg });

  switch (command) {
    case 'ping': {
      const start = Date.now();
      const sent = await reply({ text: 'Pinging...' });
      const latency = Date.now() - start;
      await sock.sendMessage(chatId, { text: `🏓 Pong! ${latency}ms`, edit: sent.key }).catch(() => {});
      break;
    }

    case 'alive':
      await reply({ text: `✅ *${BOT_NAME}* is alive and running.\nUptime: ${fmtUptime(Date.now() - startTime)}` });
      break;

    case 'menu':
      await reply({ text: MENU });
      break;

    case 'owner': {
      const ownerText = OWNERS.length
        ? `👤 Owner contact:\n${OWNERS.map(o => `wa.me/${o}`).join('\n')}`
        : '👤 Owner number not configured.';
      await reply({ text: ownerText });
      break;
    }

    case 'runtime':
      await reply({ text: `⏱️ Uptime: ${fmtUptime(Date.now() - startTime)}\nHost load: ${os.loadavg()[0].toFixed(2)}` });
      break;

    case 'sticker': {
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const target = quoted ? { message: quoted } : msg;
      const hasMedia = target.message?.imageMessage || target.message?.videoMessage;
      if (!hasMedia) {
        await reply({ text: '📎 Reply to an image or short video with *.sticker*' });
        break;
      }
      let stickerLib;
      try {
        stickerLib = require('wa-sticker-formatter');
      } catch {
        await reply({ text: '❌ Sticker support isn\'t installed on this host. Run `pkg install libvips -y && npm install` (Termux) or redeploy on Render/Railway, where it installs automatically.' });
        break;
      }
      try {
        const { Sticker, StickerTypes } = stickerLib;
        const buffer = await downloadMediaMessage(target, 'buffer', {});
        const sticker = new Sticker(buffer, {
          pack: BOT_NAME,
          author: 'via ' + BOT_NAME,
          type: StickerTypes.FULL,
          quality: 70,
        });
        const stickerBuffer = await sticker.toBuffer();
        await sock.sendMessage(chatId, { sticker: stickerBuffer }, { quoted: msg });
      } catch (e) {
        await reply({ text: '❌ Failed to create sticker: ' + e.message });
      }
      break;
    }

    // ---- GROUP MANAGEMENT ----
    case 'tagall': {
      if (!isGroup) return reply({ text: '❌ Group only command.' });
      const meta = await sock.groupMetadata(chatId);
      const mentions = meta.participants.map(p => p.id);
      const listText = mentions.map(m => `@${m.split('@')[0]}`).join(' ');
      await sock.sendMessage(chatId, { text: `📢 ${text || 'Attention everyone!'}\n\n${listText}`, mentions });
      break;
    }

    case 'kick':
    case 'promote':
    case 'demote': {
      if (!isGroup) return reply({ text: '❌ Group only command.' });
      if (!(await isSenderAdmin(sock, chatId, sender))) return reply({ text: '❌ Admins only.' });
      if (!(await isBotAdmin(sock, chatId))) return reply({ text: '❌ I need to be admin to do that.' });

      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      if (!mentioned.length) return reply({ text: '❌ Mention the user, e.g. .kick @user' });

      const action = command === 'kick' ? 'remove' : command === 'promote' ? 'promote' : 'demote';
      await sock.groupParticipantsUpdate(chatId, mentioned, action);
      await reply({ text: `✅ Done: ${command}` });
      break;
    }

    case 'mute':
    case 'unmute': {
      if (!isGroup) return reply({ text: '❌ Group only command.' });
      if (!(await isSenderAdmin(sock, chatId, sender))) return reply({ text: '❌ Admins only.' });
      if (!(await isBotAdmin(sock, chatId))) return reply({ text: '❌ I need to be admin to do that.' });
      await sock.groupSettingUpdate(chatId, command === 'mute' ? 'announcement' : 'not_announcement');
      await reply({ text: command === 'mute' ? '🔇 Group muted (admins only can send).' : '🔊 Group unmuted.' });
      break;
    }

    case 'antilink':
    case 'welcome': {
      if (!isGroup) return reply({ text: '❌ Group only command.' });
      if (!(await isSenderAdmin(sock, chatId, sender))) return reply({ text: '❌ Admins only.' });
      const val = args[0]?.toLowerCase();
      if (!['on', 'off'].includes(val)) return reply({ text: `Usage: .${command} on|off` });
      store.setGroup(chatId, { [command]: val === 'on' });
      await reply({ text: `✅ ${command} turned ${val}.` });
      break;
    }

    // ---- FUN ----
    case 'meme': {
      try {
        const res = await fetch('https://meme-api.com/gimme');
        const data = await res.json();
        await sock.sendMessage(chatId, { image: { url: data.url }, caption: data.title }, { quoted: msg });
      } catch {
        await reply({ text: '❌ Could not fetch a meme right now.' });
      }
      break;
    }

    case 'quote': {
      try {
        const res = await fetch('https://api.quotable.io/random');
        const data = await res.json();
        await reply({ text: `💬 "${data.content}"\n— ${data.author}` });
      } catch {
        await reply({ text: '❌ Could not fetch a quote right now.' });
      }
      break;
    }

    case 'joke': {
      try {
        const res = await fetch('https://official-joke-api.appspot.com/random_joke');
        const data = await res.json();
        await reply({ text: `😂 ${data.setup}\n${data.punchline}` });
      } catch {
        await reply({ text: '❌ Could not fetch a joke right now.' });
      }
      break;
    }

    case '8ball': {
      const answers = ['Yes.', 'No.', 'Maybe.', 'Definitely!', 'Ask again later.', 'Unlikely.', 'Absolutely.'];
      await reply({ text: `🎱 ${answers[Math.floor(Math.random() * answers.length)]}` });
      break;
    }

    case 'dice': {
      await reply({ text: `🎲 You rolled a ${1 + Math.floor(Math.random() * 6)}` });
      break;
    }

    default:
      // Unknown command - stay silent to avoid spamming groups
      break;
  }
}

module.exports = { handleCommand, MENU };
