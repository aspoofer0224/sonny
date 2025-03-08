import { Marked, MarkedToken } from 'marked';
import z from 'zod';

type GalleryItem = z.infer<typeof GalleryItem>;
const GalleryItem = z.object({
  title: z.string(),
  description: z.string(),
  url: z.string(),
  image_url: z.string(),
});

export type Block = z.infer<typeof Block>;
export const Block = z.union([
  z.object({
    type: z.literal('text'),
    content: z.string(),
  }),
  z.object({
    type: z.literal('gallery'),
    items: z.array(GalleryItem),
  }),
  z.object({
    type: z.literal('community_list'),
    items: z.array(CommunityListItem),
  }),
]);

export function makeBlocks(message: string): Block[] {
  const marked = new Marked();
  const tokens = marked.lexer(message);

  const blocks: Block[] = [];

  for (const token of tokens as MarkedToken[]) {
    const galleryItems: GalleryItem[] = [];
    const communityListItems: CommunityListItem[] = [];

    if (token.type === 'list') {
      for (const item of token.items) {
        for (const text of item.tokens) {
          if (text.type === 'text') {
            for (const link of text.tokens ?? []) {
              if (
                link.type === 'link' &&
                link.href.startsWith('https://www.animeoshi.com/anime/')
              ) {
                for (const image of link.tokens ?? []) {
                  if (image.type === 'image') {
                    galleryItems.push({
                      title: image.text,
                      description: link.title,
                      url: link.href,
                      image_url: image.href,
                    });
                  }
                }
              } else if (
                link.type === 'link' &&
                link.href.startsWith('https://discord.com/channels/')
              ) {
                for (const text of link.tokens ?? []) {
                  if (text.type === 'text') {
                    communityListItems.push({
                      title: text.text,
                      url: link.href,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    if (
      galleryItems.length > 0 &&
      token.type === 'list' &&
      galleryItems.length === token.items.length
    ) {
      blocks.push({ type: 'gallery', items: galleryItems });
    } else if (
      communityListItems.length > 0 &&
      token.type === 'list' &&
      communityListItems.length === token.items.length
    ) {
      blocks.push({ type: 'community_list', items: communityListItems });
    } else if (token.type !== 'space') {
      blocks.push({ type: 'text', content: token.raw });
    }
  }

  return blocks;
}
