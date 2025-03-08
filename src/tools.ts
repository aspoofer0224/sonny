import axios from "axios";
import z from "zod";
import * as synaptic from "./lib/synaptic";
import { AnimeRecommender } from "./anime-recommender";
import { MultiSearch, OshiSearch, TavilySearch } from "./search";
import { openai } from "@ai-sdk/openai";

export const tools = {
  search: {
    description:
      "Search engine optimized for comprehensive, accurate, and trusted results. Useful for when you need to answer questions about Oshi or anime. Input should be a search query.",
    parameters: {
      query: z.string(),
    },
    fn: ({ query }: { query: string }): Promise<{ content: string }[]> =>
      new MultiSearch([
        new OshiSearch({
          meilisearchApiKey: process.env.MEILISEARCH_API_KEY!,
        }),
        new TavilySearch({
          tavilyApiKey: process.env.TAVILY_API_KEY!,
          quantity: 2,
        }),
        new TavilySearch({
          tavilyApiKey: process.env.TAVILY_API_KEY!,
          quantity: 2,
          language: "ja",
        }),
      ]).forward(openai("gpt-4o-mini"), { query }),
  },
  openUrl: {
    description: "Open a URL. Returns the HTML content.",
    parameters: {
      url: z.string(),
    },
    fn: async ({ url }: { url: string }) =>
      axios
        .get<string>(url, {
          timeout: 20000,
          headers: { Accept: "text/html" },
        })
        .then((response) => response.data),
  },
  searchSimilarAnime: {
    description: "Search for other anime similar to existing anime.",
    parameters: {
      titles: z.array(z.string()),
      limit: z.number().int(),
    },
    fn: ({ titles, limit }: { titles: string[]; limit: number }) =>
      new AnimeRecommender({ nsfw: false }).bySimilarity({ titles, limit }),
  },
} satisfies Record<string, synaptic.Tool>;
