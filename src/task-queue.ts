import { Redis } from "ioredis";
import z from "zod";

export default class TaskQueue<T> {
  constructor(private redis: Redis, private taskSchema: z.ZodType<T>) {}

  async size(): Promise<number> {
    return await this.redis.zcard("queue");
  }

  async maxAge(): Promise<number | null> {
    const result = await this.redis.zrange("queue", 0, 0, "WITHSCORES");

    if (result.length === 0) {
      return null;
    } else {
      const [, timestamp] = result[0];
      return Date.now() / 1000 - parseFloat(timestamp);
    }
  }

  async add(id: string, value: T): Promise<void> {
    await this.redis.set(`task:${id}`, JSON.stringify(value));
    await this.redis.zadd("queue", Date.now() / 1000, id);
  }

  async *subscribe(): AsyncIterable<[string, number]> {
    while (true) {
      try {
        const result = await this.redis.bzpopmin("queue", 0);

        if (!result) {
          break;
        }

        const [, id, timestamp] = result;

        yield [id, parseFloat(timestamp)];
      } catch (error) {
        break;
      }
    }
  }

  async fetch(id: string): Promise<T | null> {
    const encoded = await this.redis.get(`task:${id}`);

    if (encoded) {
      return this.taskSchema.parse(JSON.parse(encoded));
    } else {
      return null;
    }
  }

  async fetchIfModified(id: string, since: number): Promise<T | null> {
    const timestamp = await this.redis.zscore("queue", id);

    if (timestamp !== null && parseFloat(timestamp) > since) {
      return await this.fetch(id);
    } else {
      return null;
    }
  }
}
