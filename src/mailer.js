/** Outbound email, dependency-free. Two transports:

    1. SMTP_URL (smtp://user:pass@host:587 or smtps://user:pass@host:465)
       — a minimal RFC 5321 client with STARTTLS and AUTH LOGIN, which is
       all Postmark/SES/Mailgun/Sendgrid SMTP endpoints need.
    2. NOVA_EMAIL_WEBHOOK — POST {to, subject, text} JSON to any URL
       (a serverless relay, Zapier, or your own service).

    With neither set, email features are off and sendEmail resolves false.
    EMAIL_FROM sets the sender (default nova@<platform domain or localhost>). */

const net = require('net');
const tls = require('tls');

function emailEnabled() {
  return Boolean(process.env.SMTP_URL || process.env.NOVA_EMAIL_WEBHOOK);
}

function fromAddress() {
  return process.env.EMAIL_FROM || `nova@${process.env.PLATFORM_DOMAIN || 'localhost'}`;
}

/** Minimal SMTP conversation. Returns when the message is accepted. */
function smtpSend({ url, to, subject, text }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const secure = u.protocol === 'smtps:';
    const port = Number(u.port) || (secure ? 465 : 587);
    const user = decodeURIComponent(u.username || '');
    const pass = decodeURIComponent(u.password || '');
    const from = fromAddress();

    let socket = secure
      ? tls.connect({ host: u.hostname, port, servername: u.hostname })
      : net.connect({ host: u.hostname, port });
    let buffer = '';
    let stage = 0;
    let supportsStartTls = false;
    const timer = setTimeout(() => fail(new Error('SMTP timeout')), 15000);

    function fail(err) {
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* closed */ }
      reject(err);
    }
    function write(line) {
      socket.write(`${line}\r\n`);
    }
    const message = [
      `From: Nova CMS <${from}>`,
      `To: <${to}>`,
      `Subject: ${subject.replace(/[\r\n]/g, ' ')}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      text.replace(/^\./gm, '..'),
      '.',
    ].join('\r\n');

    function attach(sock) {
      socket = sock;
      socket.on('data', onData);
      socket.on('error', fail);
    }

    function onData(chunk) {
      buffer += chunk.toString();
      if (!/\r?\n$/.test(buffer)) return;
      const lines = buffer.trim().split(/\r?\n/);
      const last = lines[lines.length - 1];
      if (/^\d{3}-/.test(last)) return; // multiline reply still coming
      const code = Number(last.slice(0, 3));
      const all = buffer;
      buffer = '';
      if (code >= 400) return fail(new Error(`SMTP ${code}: ${last.slice(4)}`));

      if (stage === 0) { stage = 1; write('EHLO nova-cms'); }
      else if (stage === 1) {
        supportsStartTls = /STARTTLS/i.test(all);
        if (!secure && supportsStartTls) { stage = 2; write('STARTTLS'); }
        else { stage = 3; onData.afterHello(); }
      } else if (stage === 2) {
        // Upgrade the socket, then say hello again.
        socket.removeAllListeners('data');
        const upgraded = tls.connect({ socket, servername: u.hostname });
        upgraded.on('secureConnect', () => { stage = 1; attach(upgraded); write('EHLO nova-cms'); });
        upgraded.on('error', fail);
      } else if (stage === 4) { write(Buffer.from(user).toString('base64')); stage = 5; }
      else if (stage === 5) { write(Buffer.from(pass).toString('base64')); stage = 6; }
      else if (stage === 6) { stage = 7; write(`MAIL FROM:<${from}>`); }
      else if (stage === 7) { stage = 8; write(`RCPT TO:<${to}>`); }
      else if (stage === 8) { stage = 9; write('DATA'); }
      else if (stage === 9) { stage = 10; socket.write(`${message}\r\n`); }
      else if (stage === 10) {
        clearTimeout(timer);
        write('QUIT');
        socket.end();
        resolve(true);
      }
    }
    onData.afterHello = () => {
      if (user) { stage = 4; write('AUTH LOGIN'); }
      else { stage = 6; onData('250 ok\r\n'); }
    };

    attach(socket);
  });
}

/** Send one plain-text email. Resolves true if handed off, false if email
    is not configured. Errors reject — callers decide whether to care. */
async function sendEmail({ to, subject, text }) {
  if (!to) return false;
  if (process.env.SMTP_URL) {
    await smtpSend({ url: process.env.SMTP_URL, to, subject, text });
    return true;
  }
  if (process.env.NOVA_EMAIL_WEBHOOK) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      await fetch(process.env.NOVA_EMAIL_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ from: fromAddress(), to, subject, text }),
      });
    } finally {
      clearTimeout(timer);
    }
    return true;
  }
  return false;
}

module.exports = { sendEmail, emailEnabled, fromAddress };
