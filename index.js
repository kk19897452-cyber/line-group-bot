require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const { google } = require("googleapis");
const mime = require("mime-types");
const { Readable } = require("stream");

const app = express();
const PORT = process.env.PORT || 3000;

// 保留 raw body，給 LINE 驗證簽章
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

function validateSignature(req) {
  const signature = req.headers["x-line-signature"];
  const channelSecret = process.env.LINE_CHANNEL_SECRET;

  const hash = crypto
    .createHmac("SHA256", channelSecret)
    .update(req.rawBody)
    .digest("base64");

  return hash === signature;
}

async function replyMessage(replyToken, messages) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken, messages },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    }
  );
}

// ===== Google Drive 設定 =====
const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/drive.file"]
});

const drive = google.drive({ version: "v3", auth });

async function uploadBufferToDrive(buffer, fileName, mimeType, folderId) {
  const stream = Readable.from(buffer);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: folderId ? [folderId] : undefined
    },
    media: {
      mimeType,
      body: stream
    },
    fields: "id,name,webViewLink"
  });

  return response.data;
}

// ===== LINE 下載媒體 =====
async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntilVideoReady(messageId, maxRetry = 12, intervalMs = 5000) {
  for (let i = 0; i < maxRetry; i++) {
    try {
      const res = await axios.get(
        `https://api-data.line.me/v2/bot/message/${messageId}/content/transcoding`,
        {
          headers: {
            Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
          }
        }
      );

      if (res.data.status === "succeeded") return true;
      if (res.data.status === "failed") return false;
    } catch (err) {
      console.log("transcoding check error:", err.response?.data || err.message);
    }

    await wait(intervalMs);
  }

  return false;
}

async function downloadLineContent(messageId) {
  const res = await axios.get(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    }
  );

  const contentType = res.headers["content-type"] || "application/octet-stream";

  return {
    buffer: Buffer.from(res.data),
    contentType
  };
}

function buildBackupFileName(event, messageType, contentType) {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-");

  const sourceId =
    event.source.groupId ||
    event.source.roomId ||
    event.source.userId ||
    "unknown";

  const messageId = event.message.id;
  const ext = mime.extension(contentType) || (messageType === "video" ? "mp4" : "jpg");

  return `${messageType}_${sourceId}_${messageId}_${ts}.${ext}`;
}

async function backupLineMedia(event) {
  const message = event.message;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!folderId) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID is not set");
  }

  if (message.type !== "image" && message.type !== "video") {
    return;
  }

  if (message.type === "video") {
    const ready = await waitUntilVideoReady(message.id);
    if (!ready) {
      throw new Error(`Video not ready for download: ${message.id}`);
    }
  }

  const { buffer, contentType } = await downloadLineContent(message.id);
  const fileName = buildBackupFileName(event, message.type, contentType);

  const uploaded = await uploadBufferToDrive(
    buffer,
    fileName,
    contentType,
    folderId
  );

  console.log("Backup success:", uploaded.id, uploaded.name);
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  try {
    if (!validateSignature(req)) {
      return res.status(403).send("Invalid signature");
    }

    const events = req.body.events || [];

    // 先回 200，避免 LINE timeout
    res.sendStatus(200);

    for (const event of events) {
      try {
        // Bot 被加入群組 / 聊天室
        if (event.type === "join") {
          await replyMessage(event.replyToken, [
            {
              type: "text",
              text: "大家好，我已加入本群，自動通知功能已啟用。"
            }
          ]);
          continue;
        }

        // 新成員加入群組
        if (event.type === "memberJoined") {
          await replyMessage(event.replyToken, [
            {
              type: "text",
              text: `歡迎加入 FORTY BEAR 群組 🐻\n\n新朋友、老朋友都歡迎！😇😇😇\n群組記事本可以留言自己的 IP，🫶🫶🫶\n方便大家配對一起玩。🐾\n\n之後如果有聚會或活動，🐗🐻🐻‍❄️🐼\n會看大家的人數來調整內容，\n目前還不確定會辦什麼，🐾🐾🐾\n但應該都是 輕鬆好玩的路線 🤡🤡🤡\n\n想聊天、開聊、\n路過丟一句都沒問題～🐗🐻🐻‍❄️🐼\n\n團長 淵淵 3/31🎆\n\nBY FORTY BEAR 機器熊奴`
            }
          ]);
          continue;
        }

        // 只備份圖片 / 影片，不回任何訊息
        if (event.type === "message") {
          const message = event.message;

          if (message.type === "image" || message.type === "video") {
            backupLineMedia(event).catch(err => {
              console.error("Backup failed:", err.response?.data || err.message);
            });
          }

          continue;
        }
      } catch (err) {
        console.error("Event handling error:", err.response?.data || err.message);
      }
    }
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message);
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
});

// 健康檢查
app.get("/", (req, res) => {
  res.send("LINE Bot is running.");
});

// self ping：每 10 分鐘
setInterval(() => {
  axios.get("https://line-group-bot-we69.onrender.com")
    .then(() => console.log("self ping"))
    .catch(err => console.log("ping fail:", err.message));
}, 600000);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
