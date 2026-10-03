/**
 * Local SMTP sink — a fake SMTP server for LIVE-FIRE mail testing.
 *
 * Listens on 127.0.0.1:1025 (loopback only — nothing reaches the internet).
 * Captures every accepted message as JSON in scripts/_sink_capture/ so the
 * live-fire run can be verified byte-level (recipients, LOCK banner, MIME,
 * attachments) without any real-world email leaving the machine.
 *
 * NOTE: deliberately does NOT advertise STARTTLS — nodemailer with
 * secure:false falls back to plaintext, which is all we need locally.
 *
 * Usage:  bun run scripts/mail_sink.mjs   (kill -TERM to stop)
 */
import net from "node:net";
import fs from "node:fs";

const CAPTURE_DIR = "/home/z/my-project/scripts/_sink_capture";
fs.mkdirSync(CAPTURE_DIR, { recursive: true });

let counter = 0;

const server = net.createServer((socket) => {
  let state = "cmd"; // "cmd" | "data"
  let buf = "";
  let mail = { from: "", to: [], raw: "" };

  socket.write("220 mail-sink.local ESMTP ready\r\n");

  socket.on("data", (chunk) => {
    buf += chunk.toString();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (state === "data") {
        const end = buf.indexOf("\r\n.\r\n");
        if (end === -1) return; // wait for the rest of the message
        mail.raw = buf.slice(0, end);
        counter += 1;
        const file = `${CAPTURE_DIR}/msg_${String(counter).padStart(3, "0")}.json`;
        fs.writeFileSync(
          file,
          JSON.stringify(
            {
              receivedAt: new Date().toISOString(),
              from: mail.from,
              to: mail.to,
              bytes: mail.raw.length,
              raw: mail.raw,
            },
            null,
            2
          )
        );
        console.log(
          `[sink] captured #${counter} from=${mail.from} to=${mail.to.join(",")} (${mail.raw.length} bytes) -> ${file}`
        );
        buf = buf.slice(end + 5);
        state = "cmd";
        mail = { from: "", to: [], raw: "" };
        socket.write("250 OK: message accepted for delivery\r\n");
        continue;
      }
      const idx = buf.indexOf("\r\n");
      if (idx === -1) return; // wait for a full command line
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const cmd = line.toUpperCase();

      if (cmd.startsWith("EHLO")) {
        // No STARTTLS capability advertised -> client stays on plaintext.
        socket.write("250-mail-sink.local\r\n250-8BITMIME\r\n250-SIZE 35882577\r\n250 SMTPUTF8\r\n");
      } else if (cmd.startsWith("HELO")) {
        socket.write("250 mail-sink.local\r\n");
      } else if (cmd.startsWith("MAIL FROM")) {
        mail.from = line.slice(10).trim();
        socket.write("250 OK\r\n");
      } else if (cmd.startsWith("RCPT TO")) {
        mail.to.push(line.slice(8).trim());
        socket.write("250 OK\r\n");
      } else if (cmd.startsWith("DATA")) {
        state = "data";
        socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      } else if (cmd.startsWith("RSET")) {
        mail = { from: "", to: [], raw: "" };
        socket.write("250 OK\r\n");
      } else if (cmd.startsWith("NOOP")) {
        socket.write("250 OK\r\n");
      } else if (cmd.startsWith("QUIT")) {
        socket.write("221 Bye\r\n");
        socket.end();
      } else {
        socket.write("250 OK\r\n");
      }
    }
  });

  socket.on("error", () => {
    /* client hung up — ignore */
  });
});

server.listen(1025, "127.0.0.1", () => {
  console.log("[sink] SMTP sink listening on 127.0.0.1:1025 (loopback only)");
});

process.on("SIGTERM", () => {
  console.log(`[sink] shutting down — ${counter} message(s) captured`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});
