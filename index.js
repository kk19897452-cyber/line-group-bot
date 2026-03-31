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
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
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
      // Bot 被加入群組 / 聊天室
      if (event.type === "join") {
        await replyMessage(event.replyToken, [
          {
            type: "text",
            text: "大家好，我已加入本群，自動通知功能已啟用。"
          }
        ]);
      }

      // 有新成員加入群組
      if (event.type === "memberJoined") {
        await replyMessage(event.replyToken, [
          {
            type: "text",
            text: `歡迎加入 FORTY BEAR 群組 🐻

            新朋友、老朋友都歡迎！😇😇😇
            群組已來本可以留言自己的 IP，🫶🫶🫶
            方便大家配對一起玩。🐾

            之後如果有聚會或活動，🐗🐻🐻‍❄️🐼
            會看大家的人數來調整內容，
            目前還不確定會辦什麼，🐾🐾🐾
            但應該都是 輕鬆好玩的路線 🤡🤡🤡

            想聊天、開聊、
            路過丟一句都沒問題～🐗🐻🐻‍❄️🐼

            團長 洲洲 3/31🎆🎆🎆
            BY FORTY BEAR 機器熊奴`
          }
        ]);
      }

      // message 事件不處理 = 不會每句都回
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
