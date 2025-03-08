import { openai } from '@ai-sdk/openai';
import { Redis } from 'ioredis';
import z from 'zod';
import { Block, makeBlocks } from './blocks';
import { modes, Task } from './modes';
import { personas } from './personas';
import PubSub from './pubsub';
import TaskQueue from './task-queue';
import { tools } from './tools';

export const ReplyMetadata = z.object({
  sourceUrls: z.array(z.string()),
  blocks: z.array(Block),
});

async function main(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL!);
  const pubsub = new PubSub(redis, ReplyMetadata);
  const taskQueue = new TaskQueue(redis, Task);
  const lm = openai('gpt-4o');

  for await (const [taskId, taskTimestamp] of taskQueue.subscribe()) {
    try {
      const { content, metadata } = (await taskQueue.fetch(taskId))!;
      const mode = new modes[metadata.mode](
        tools,
        personas,
        async (message, sourceUrls) => {
          // if (!(await taskQueue.fetchIfModified(taskId, taskTimestamp))) {
          const blocks = makeBlocks(message);

          await pubsub.publish(`replies:${metadata.replyId}`, message, {
            sourceUrls,
            blocks,
          });
          // }
        }
      );

      await mode.forward(lm, { content, metadata });
    } catch (e) {
      console.error(e);
    } finally {
    }
  }
}

main();
