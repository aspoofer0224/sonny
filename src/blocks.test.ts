import { makeBlocks } from "./blocks";
import { unlines } from "./utils";

describe("makeBlocks", () => {
  it("makes blocks", () => {
    const message = unlines(
      "When recommending anime, always format the anime list as a numbered list exactly like the following:",
      "",
      '1. [![A Farewell to Arms](https://cdn.myanimelist.net/images/anime/4/53169.jpg)](https://www.animeoshi.com/anime/a-farewell-to-arms "Set in a futuristic Tokyo, skilled individuals confront automated tanks in this action-packed film.")',
      '2. [![Lightning Atom](https://cdn.myanimelist.net/images/anime/9/45160.jpg)](https://www.animeoshi.com/anime/lightning-atom "A young boy with electric superpowers fights evil forces in this classic adventure.")',
      "",
      "When listing Discord threads, always format the thread list as a numbered list exactly like the following:",
      "",
      "1. [Death Note Fandom Chat](https://discord.com/channels/1255431993215422504/1329291403624185856aa)",
      "2. [Manga & Manhwas](https://discord.com/channels/1255431993215422504/1329366744661360650)"
    );
    const output = makeBlocks(message);

    expect(output).toMatchInlineSnapshot(`
[
  {
    "content": "When recommending anime, always format the anime list as a numbered list exactly like the following:",
    "type": "text",
  },
  {
    "items": [
      {
        "description": "Set in a futuristic Tokyo, skilled individuals confront automated tanks in this action-packed film.",
        "image_url": "https://cdn.myanimelist.net/images/anime/4/53169.jpg",
        "title": "A Farewell to Arms",
        "url": "https://www.animeoshi.com/anime/a-farewell-to-arms",
      },
      {
        "description": "A young boy with electric superpowers fights evil forces in this classic adventure.",
        "image_url": "https://cdn.myanimelist.net/images/anime/9/45160.jpg",
        "title": "Lightning Atom",
        "url": "https://www.animeoshi.com/anime/lightning-atom",
      },
    ],
    "type": "gallery",
  },
  {
    "content": "When listing Discord threads, always format the thread list as a numbered list exactly like the following:",
    "type": "text",
  },
  {
    "items": [
      {
        "title": "Death Note Fandom Chat",
        "url": "https://discord.com/channels/1255431993215422504/1329291403624185856aa",
      },
      {
        "title": "Manga & Manhwas",
        "url": "https://discord.com/channels/1255431993215422504/1329366744661360650",
      },
    ],
    "type": "community_list",
  },
]
`);
  });
});
