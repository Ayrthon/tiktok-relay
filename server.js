import express from "express";
import cors from "cors";
import { WebcastPushConnection } from "tiktok-live-connector";

const app = express();
app.use(cors());
const pool = new Map();

app.get("/tiktok/:username/sse", async (req, res) => {
  const username = req.params.username.toLowerCase();

  if (!pool.has(username)) {
    const conn = new WebcastPushConnection(username);
    conn.connect();
    const clients = [];
    conn.on("chat", (msg) => {
      const payload = JSON.stringify({
        user: msg.uniqueId,
        message: msg.comment,
        color: "#00f2ea",
        timestamp: Date.now(),
      });
      for (const c of clients) c.write(`data: ${payload}\n\n`);
    });
    pool.set(username, { conn, clients });
  }

  const entry = pool.get(username);
  entry.clients.push(res);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  req.on("close", () => {
    entry.clients = entry.clients.filter((c) => c !== res);
    if (entry.clients.length === 0) {
      entry.conn.disconnect();
      pool.delete(username);
      console.log(`🛑 Disconnected from @${username}`);
    }
  });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`✅ TikTok relay live on port ${port}`));
