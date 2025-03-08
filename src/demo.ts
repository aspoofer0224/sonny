import { Redis } from "ioredis";
import TaskQueue from "./task-queue";
import { Task } from "./modes";

async function main(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL!);
  const taskQueue = new TaskQueue(redis, Task);

  await taskQueue.add("demo", {
    content: "What is Oshi?",
    metadata: {
      persona: "oshibotsu",
      mode: "chat",
      channel: "discord",
      replyId: "1",
      history: [],
    },
  });

  process.exit(0);
}

main();
