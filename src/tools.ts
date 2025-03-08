import axios from 'axios';
import z from 'zod';
import * as synaptic from './lib/synaptic';

export const tools = {
  openUrl: {
    description: 'Open a URL. Returns the HTML content.',
    parameters: {
      url: z.string(),
    },
    fn: async ({ url }: { url: string }) =>
      axios
        .get<string>(url, {
          timeout: 20000,
          headers: { Accept: 'text/html' },
        })
        .then((response) => response.data),
  },
  say: {
    description:
      'Send a message to the user. Use this whenever you want to reply to the user.',
    parameters: {
      message: z.string(),
    },
    fn: async ({ message }: { message: string }) => message,
  },
} satisfies Record<string, synaptic.Tool>;
