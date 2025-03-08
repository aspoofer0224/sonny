import Redis from "ioredis";
import z from "zod";

export default class PubSub<T> {
  constructor(private redis: Redis, private metadataSchema: z.ZodType<T>) {}

  async *subscribe(topic: string): AsyncIterable<[string, T]> {
    let lastItemId = "$";

    while (true) {
      const messages = await this.redis.xread(
        "BLOCK",
        0,
        "STREAMS",
        topic,
        lastItemId
      );

      for (const [, items] of messages ?? []) {
        for (const [id, fields] of items) {
          const fieldMap: Record<string, string> = {};

          for (let i = 0; i < fields.length; i += 2) {
            fieldMap[fields[i]] = fields[i + 1];
          }

          yield [
            fieldMap.content,
            this.metadataSchema.parse(JSON.parse(fieldMap.metadata)),
          ];

          lastItemId = id;
        }
      }
    }
  }

  async publish(topic: string, content: string, metadata: T): Promise<void> {
    await this.redis.xadd(
      topic,
      "*",
      "content",
      content,
      "metadata",
      JSON.stringify(metadata)
    );
  }
}
