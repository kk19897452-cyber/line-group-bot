require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

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
    {
      replyToken,
      messages
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    }
  );
}

app.post("/webhook", async (req, res) => {
  try {
    if (!validateSignature(req)) {
      return res.status(403).send("Invalid signature");
    }

    const events = req.body.events || [];

    for (const event of events) {
      // 1) Bot 被加入群組 / 多人聊天室
      if (event.type === "join") {
        await replyMessage(event.replyToken, [
          {
            type: "text",
            text: "大家好，我已加入本群，自動通知功能已啟用。"
          }
        ]);
      }

      // 2) 有新成員加入群組
      if (event.type === "memberJoined") {
        await replyMessage(event.replyToken, [
          {
            type: "text",
            text: "歡迎新成員加入！🎉"
          }
        ]);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.send("LINE Bot is running.");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});