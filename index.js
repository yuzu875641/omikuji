const express = require("express");
const axios = require("axios");
const { URLSearchParams } = require('url');
const { isUserAdmin, sendReplyMessage, chatworkApi, getChatworkMembers, changeUserRole, deleteMessage } = require("./config");
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// コマンドファイルのインポート
const handleOmikujiCommand = require("./commands/omikuji");
const handleDeleteCommand = require("./commands/delete");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

let botAccountId;
let roomMessageCounts = {};
let getOk = null;

const CHATWORK_EMOJIS = [
  ':)', ':(', ':D', '8-)', ':o', ';)', ':(', '(sweat)', ':|', ':*', ':p', '(blush)', ':^)', '|-)',
  '(inlove)', ']:)', '(talk)', '(yawn)', '(puke)', '(emo)', '8-|', ':#)', '(nod)', '(shake)',
  '(^^;)', '(whew)', '(clap)', '(bow)', '(roger)', '(flex)', '(dance)', '(:/)', '(gogo)',
  '(think)', '(please)', '(quick)', '(anger)', '(devil)', '(lightbulb)', '(*)', '(h)', '(F)',
  '(cracker)', '(eat)', '(^)', '(coffee)', '(beer)', '(handshake)', '(y)'
];

const MESSAGE_LOG_DIR = path.join(__dirname, 'logs');
const REPORT_ROOM_ID = 407802259; // レポートを投稿したい部屋のIDに置き換えてください

// ユーザーの権限を不正なメッセージで変更する関数
async function blockMembers(accountIdToBlock, roomId, messageId, accountId) {
  try {
    const isAdmin = await isUserAdmin(accountIdToBlock, roomId);
    if (isAdmin) {
      console.log("Sender is an admin. Ignoring role change.");
      return;
    }
    
    await changeUserRole(accountIdToBlock, 'readonly', roomId, messageId, accountId);
    
    const message = `[info][title]不正利用記録[/title][piconname:${accountIdToBlock}]さんに対して、不正利用フィルターが発動しました。[/info]`;
    await sendReplyMessage(roomId, message, { accountId, messageId });
  } catch (error) {
    console.error('不正利用フィルターエラー:', error.response ? error.response.data : error.message);
  }
}

// サーバー起動時の処理
const initializeBot = async () => {
  try {
    const meResponse = await chatworkApi.get('/me');
    botAccountId = meResponse.data.account_id;
    console.log(`Bot's account ID: ${botAccountId}`);
  } catch (error) {
    console.error('botの、アカウントIDを取得したよ　account　id:', error.response ? error.response.data : error.message);
    process.exit(1);
  }
}

app.get("/", (req, res) => {
  res.send("Chatwork bot is running!");
});

app.post("/webhook", async (req, res) => {
  const event = req.body.webhook_event;

  if (!req.body || !event || typeof event.account_id !== 'number') {
    console.error("Received webhook event with missing or invalid account_id:", req.body);
    return res.status(400).end();
  }
  
  const accountId = event.account_id;
  const roomId = event.room_id;
  const messageId = event.message_id;
  const body = event.body;

  if (accountId === botAccountId) {
    console.log("Ignoring message from the bot itself.");
    return res.status(200).end();
  }

  if (!roomMessageCounts.hasOwnProperty(roomId)) {
    roomMessageCounts[roomId] = 0;
  }
  roomMessageCounts[roomId]++;

  if (body.trim() === 'おみくじ') {
    await handleOmikujiCommand(messageId, roomId, accountId);
    return res.status(200).end();
  }
  
  
  // 管理者コマンドのチェック
  const replyMatches = body.match(/\[rp aid=(\d+) to=(\d+)-(\d+)/);
  if (replyMatches) {
    const targetAccountId = parseInt(replyMatches[1]);
    const replyMessageId = replyMatches[3];

    if (body.includes("/削除/")) {
        await handleDeleteCommand(roomId, replyMessageId, messageId, accountId);
        return res.status(200).end();
      }
    }
  }

  // 不正利用フィルター
  const countEmojis = (text) => {
    let count = 0;
    let remainingText = text;
    CHATWORK_EMOJIS.forEach(emoji => {
      const escapedEmoji = emoji.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const regex = new RegExp(escapedEmoji, 'g');
      
      const matches = remainingText.match(regex);
      if (matches) {
        count += matches.length;
        remainingText = remainingText.replace(regex, "");
      }
    });
    return count;
  };

  let shouldChangeRole = false;
  if (body.includes("[toall]")) {
    shouldChangeRole = true;
  }
  if (countEmojis(body) >= 15) {
    shouldChangeRole = true;
  }
  const zalgoPattern = /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g;
  const zalgoCount = (body.match(zalgoPattern) || []).length;
  if (zalgoCount >= 18) {
    shouldChangeRole = true;
  }

  if (shouldChangeRole) {
    await blockMembers(accountId, roomId, messageId, accountId);
  }

  res.status(200).end();
});

app.listen(PORT, () => {
  console.log(`サーバーが起動したよ port ${PORT}`);
  initializeBot();
});
