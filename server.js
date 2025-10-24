import express from "express";
import cors from "cors";
import { WebcastPushConnection } from "tiktok-live-connector";

const app = express();

// --- CORS setup ---
const allowedOrigins = [
  "https://streamdoctors-multichat.netlify.app",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (like curl or health checks)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// --- Health check route ---
app.get("/", (req, res) => {
  res.send("✅ TikTok relay is running");
});

// --- Global connection pool ---
const pool = new Map();

app.get("/tiktok/:username/sse", async (req, res) => {
  const username = req.params.username.toLowerCase();
  if (!username) return res.status(400).send("Missing username");

  // If no active connection, create one
  if (!pool.has(username)) {
    console.log(`⚡ Creating new TikTok connection for @${username}`);
    const conn = new WebcastPushConnection(username);
    const clients = [];

    conn.on("chat", (msg) => {
      const payload = JSON.stringify({
        user: msg.uniqueId,
        message: msg.comment,
        color: "#00f2ea",
        timestamp: Date.now(),
      });
      for (const c of clients) {
        try {
          c.write(`data: ${payload}\n\n`);
        } catch (err) {
          console.error("❌ Write error:", err.message);
        }
      }
    });

    conn.on("disconnected", () => {
      console.log(`🛑 Disconnected from @${username}`);
      if (clients.length > 0) {
        console.log(`🔁 Reconnecting to @${username} in 10s`);
        setTimeout(() => conn.connect().catch(console.error), 10000);
      } else {
        pool.delete(username);
      }
    });

    conn.on("error", (err) => {
      console.error(`⚠️ TikTok error for @${username}:`, err.message);
    });

    try {
      await conn.connect();
      console.log(`✅ Connected to @${username}`);
    } catch (err) {
      console.error(`❌ Failed to connect to @${username}:`, err.message);
    }

    pool.set(username, { conn, clients });
  }

  // Get active entry
  const entry = pool.get(username);
  entry.clients.push(res);

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(
    `data: ${JSON.stringify({ system: "connected", user: username })}\n\n`
  );

  req.on("close", () => {
    entry.clients = entry.clients.filter((c) => c !== res);
    console.log(`👋 Client left @${username} (${entry.clients.length} left)`);

    if (entry.clients.length === 0) {
      console.log(`🕐 No clients for @${username}, disconnecting in 60s`);
      setTimeout(() => {
        if (entry.clients.length === 0) {
          entry.conn.disconnect();
          pool.delete(username);
          console.log(`🛑 Disconnected idle @${username}`);
        }
      }, 60000);
    }
  });
});

// --- Start server ---
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`✅ TikTok relay live on port ${port}`));
