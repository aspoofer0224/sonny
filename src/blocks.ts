import { Marked, MarkedToken } from 'marked';
import z from 'zod';

type GameItem = z.infer<typeof GameItem>;
const GameItem = z.object({
  title: z.string(),
  description: z.string(),
  url: z.string(),
  image_url: z.string().optional(),
  platform: z.string().optional(),
  genre: z.string().optional(),
});

export type Block = z.infer<typeof Block>;
export const Block = z.union([
  z.object({
    type: z.literal('text'),
    content: z.string(),
  }),
  z.object({
    type: z.literal('game_list'),
    items: z.array(GameItem),
  }),
]);

export function makeBlocks(message: string): Block[] {
  const marked = new Marked();
  const tokens = marked.lexer(message);

  const blocks: Block[] = [];

  for (const token of tokens as MarkedToken[]) {
    const gameItems: GameItem[] = [];
  }
}
