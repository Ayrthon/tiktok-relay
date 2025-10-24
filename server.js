import express from "express";
import cors from "cors";
import { WebcastPushConnection } from "tiktok-live-connector";

const app = express();
app.use(cors({ origin: "*", methods: ["GET"] }));

const connectionPool = new Map();

app.get("/tiktok/:username/sse", async (req, res) => {
  const username = req.params.username.replace(/^@/, "").toLowerCase();
  if (!username) return res.status(400).send("Missing username");

  let shared = connectionPool.get(username);

  if (!shared) {
    console.log(`⚡ Creating new TikTok connection for @${username}`);
    const connection = new WebcastPushConnection(username);
    const clients = new Set();

    shared = {
      connection,
      clients,
      timeout: null,
      connecting: false,
      lastConnect: 0,
    };
    connectionPool.set(username, shared);

    // --- connect helper ---
    async function tryConnect() {
      if (shared.connecting || connection.isConnected) return;
      const now = Date.now();
      if (now - shared.lastConnect < 5000) return; // avoid too-frequent reconnects

      shared.connecting = true;
      shared.lastConnect = now;

      try {
        console.log(`🔌 Trying to connect to @${username}...`);
        await connection.connect();
        console.log(`✅ Connected to @${username}`);
      } catch (err) {
        console.error(`❌ Failed to connect to @${username}:`, err.message);
        setTimeout(tryConnect, 10000);
      } finally {
        shared.connecting = false;
      }
    }

    // --- event handlers ---
    connection.on("chat", (msg) => {
      const payload = JSON.stringify({
        user: msg.uniqueId,
        message: msg.comment,
        color: "#00f2ea",
        timestamp: Date.now(),
      });
      for (const c of clients) {
        try {
          c.write(`data: ${payload}\n\n`);
        } catch {}
      }
    });

    connection.on("disconnected", () => {
      console.log(`🛑 Disconnected from @${username}`);
      if (clients.size > 0) {
        console.log(`🔁 Reconnecting in 15s for @${username}`);
        setTimeout(tryConnect, 15000);
      } else {
        connectionPool.delete(username);
      }
    });

    connection.on("error", (err) => {
      console.error(`⚠️ TikTok chat error for @${username}:`, err.message);
    });

    // connect immediately
    tryConnect();
  }

  const { connection, clients } = shared;

  // --- setup SSE response ---
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(`: connected\n\n`); // initial SSE ping

  // --- track client ---
  clients.add(res);
  console.log(`👤 Client connected to @${username} (${clients.size} active)`);

  // cancel pending disconnect timer
  if (shared.timeout) {
    clearTimeout(shared.timeout);
    shared.timeout = null;
  }

  // --- handle disconnect ---
  req.on("close", () => {
    clients.delete(res);
    console.log(`👋 Client left @${username} (${clients.size} left)`);

    if (clients.size === 0) {
      shared.timeout = setTimeout(() => {
        console.log(
          `🕐 No clients for @${username}, disconnecting after 60s idle`
        );
        connection.disconnect();
        connectionPool.delete(username);
      }, 60000);
    }
  });
});

app.get("/", (req, res) => res.send("✅ TikTok relay is running."));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`🚀 TikTok relay live on port ${port}`));
