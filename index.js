require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// 保留 raw body（LINE 簽章驗證用）
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// 驗證 LINE 簽章
function validateSignature(req) {
  const signature = req.headers["x-line-signature"];
  const channelSecret = process.env.LINE_CHANNEL_SECRET;

  const hash = crypto
    .createHmac("SHA256", channelSecret)
    .update(req.rawBody)
    .digest("base64");

  return hash === signature;
}

// Reply（回覆）
async function replyMessage(replyToken, messages) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    }
  );
}

// Push（主動發送，避免 replyToken 過期）
async function pushMessage(to, messages) {
  await axios.post(
    "https://api.line.me/v2/bot/message/push",
    {
      to,
      messages
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    }
  );
}

// Webhook
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
        // Bot 被加入
        if (event.type === "join") {
          await replyMessage(event.replyToken, [
            {
              type: "text",
              text: "大家好，我已加入本群，自動通知功能已啟用。"
            }
          ]);
          continue;
        }

        // 新成員加入
        if (event.type === "memberJoined") {
          await replyMessage(event.replyToken, [
            {
              type: "text",
              text: `歡迎加入 FORTY BEAR 群組 🐻\n\n新朋友、老朋友都歡迎！😇😇😇\n群組記事本可以留言自己的 IP，🫶🫶🫶\n方便大家配對一起玩。🐾\n\n之後如果有聚會或活動，🐗🐻🐻‍❄️🐼\n會看大家的人數來調整內容，\n目前還不確定會辦什麼，🐾🐾🐾\n但應該都是 輕鬆好玩的路線 🤡🤡🤡\n\n想聊天、開聊、\n路過丟一句都沒問題～🐗🐻🐻‍❄️🐼\n\n團長 淵淵 3/31🎆\n\nBY FORTY BEAR 機器熊奴`
            }
          ]);
          continue;
        }

        // 收到訊息（只處理圖片 / 影片）
        if (event.type === "message") {
          const message = event.message;

          if (message.type === "image" || message.type === "video") {

            // 群組 or 個人
            const targetId = event.source.groupId || event.source.userId;

            // ⏱ 10秒後：回覆（reply）
            setTimeout(async () => {
              try {
                await replyMessage(event.replyToken, [
                  { type: "text", text: "已備份到雲端 ✅" }
                ]);
              } catch (err) {
                console.log("Reply failed:", err.message);
              }
            }, 10000);

            // ⏱ 再10秒（共20秒）：推播（push）
            setTimeout(async () => {
              try {
                await pushMessage(targetId, [
                  { type: "text", text: "沒啦\n騙你的\n愚人節快樂 🤡" }
                ]);
              } catch (err) {
                console.log("Push failed:", err.message);
              }
            }, 20000);
          }

          // 其他訊息不回（保持安靜）
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

// self ping（每10分鐘）
setInterval(() => {
  axios.get("https://line-group-bot-we69.onrender.com")
    .then(() => console.log("self ping"))
    .catch((err) => console.log("ping fail:", err.message));
}, 600000);

// 啟動
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
