import base58 from "bs58";
import { randomBytes } from "crypto";
import express from "express";
import asyncHandler from "express-async-handler";
import { Redis } from "ioredis";
import jwt from "jsonwebtoken";
import { isNumber, isString } from "lodash";
import WebSocket from "ws";
import { ReplyMetadata } from "./agent";
import { Task } from "./modes";
import PubSub from "./pubsub";
import TaskQueue from "./task-queue";

const MAX_TASK_COUNT = 100;

async function main(): Promise<void> {
  const taskQueue = new TaskQueue(new Redis(process.env.REDIS_URL!), Task);
  const app = express();

  app.use(express.json());

  app.get("/healthz", (_req, res) => {
    res.status(200).type("txt").send("OK");
  });

  app.post(
    "/chats",
    asyncHandler(async (req, res) => {
      const size = await taskQueue.size();
      const maxAge = await taskQueue.maxAge();

      if (size >= MAX_TASK_COUNT) {
        res
          .status(429)
          .set(
            "Retry-After",
            isNumber(maxAge) ? Math.ceil(maxAge).toString() : "60"
          )
          .send({ queue_size: size });

        return;
      }

      const chatId = base58.encode(randomBytes(16));

      res.type("txt").send(
        jwt.sign(
          {
            chat_id: chatId,
            persona: req.body.persona,
            trait: req.body.trait,
            language: req.body.language,
          },
          process.env.JWT_SECRET!,
          { algorithm: "HS256" }
        )
      );
    })
  );

  app.post(
    "/messages",
    asyncHandler(async (req, res) => {
      const claims = jwt.verify(req.body.chat, process.env.JWT_SECRET!, {
        algorithms: ["HS256"],
      });

      if (isString(claims)) {
        throw new Error("Invalid chat token");
      }

      const replyId = claims.chat_id;

      await taskQueue.add(`self:${replyId}`, {
        content: req.body.content ?? "",
        metadata: {
          persona: claims.persona,
          trait: claims.trait,
          language: claims.language,
          channel: req.body.channel ?? "",
          replyId: replyId,
          history: req.body.history,
          mode: "group-chat",
          nsfw: req.body.nsfw,
        },
      });

      res.end();
    })
  );

  const httpServer = app.listen(8080, "0.0.0.0");
  const wsServer = new WebSocket.Server({
    server: httpServer,
    path: "/replies",
  });

  wsServer.on("connection", async (ws, req) => {
    try {
      const chat = new URLSearchParams(req.url!.split("?")[1]).get("chat")!;
      const claims = jwt.verify(chat, process.env.JWT_SECRET!, {
        algorithms: ["HS256"],
      });

      if (isString(claims)) {
        throw new Error("Invalid chat token");
      }

      const replyId = claims.chat_id;

      console.log(
        `SUB ${replyId}: ${req.socket.remoteAddress}:${req.socket.remotePort}`
      );

      const pubsub = new PubSub(
        new Redis(process.env.REDIS_URL!),
        ReplyMetadata
      );

      for await (const [content, metadata] of pubsub.subscribe(
        `replies:${replyId}`
      )) {
        await new Promise((resolve, reject) =>
          ws.send(JSON.stringify({ content, metadata }), (e) =>
            e ? reject(e) : resolve(undefined)
          )
        );
      }
    } catch (e) {
      console.error(e);
    }
  });
}

main();
