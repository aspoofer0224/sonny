import { LanguageModel } from 'ai';
import z from 'zod';
import * as synaptic from './lib/synaptic';
import { unlines } from './utils';

export type Task = z.infer<typeof Task>;
export const Task = z.object({
  content: z.string(),
  metadata: z.object({
    persona: z.string(),
    language: z.string().optional(),
    mode: z.string(),
    channel: z.string(),
    replyId: z.string(),
    nsfw: z.boolean().optional(),
    trait: z.string().optional(),
    history: z.array(
      z.object({
        type: z.union([z.literal('human'), z.literal('ai')]),
        name: z.string().optional(),
        content: z.string(),
      })
    ),
  }),
});

export interface Persona {
  name: string;
  description: string;
  prime: string;
  personality: string | null;
  traits: Record<string, string>;
}

export abstract class Mode implements synaptic.Module<Task, {}> {
  constructor(
    protected tools: Record<string, synaptic.Tool<any, any>>,
    protected personas: Record<string, Persona>,
    protected say: (message: string, sourceUrls: string[]) => Promise<void>
  ) {}

  abstract forward(lm: LanguageModel, task: Task): Promise<{}>;
}

export class ChatMode extends Mode {
  async forward(lm: LanguageModel, { content, metadata }: Task): Promise<{}> {
    const persona = this.personas[metadata.persona];
    const agent = new synaptic.ReAct(
      {
        instructions: unlines(
          "You are notified of a message from an anime fan in a group chat that may or may not be addressed to you. You are not required to respond to the message, but you may do so if you believe it's relevant to your primary function. If you do respond, use the `say` tool to send a reply to the anime fan.",
          '',
          'When replying:',
          '* Verify facts by using the search engine and provide accurate information.',
          '* When looking up current events, remember to use the current date.',
          '* Give in-depth explanations.',
          '* Speak in the same language as the anime fan.',
          '* Speak in casual tone and skip the niceties like "Let me know if you have more questions!".',
          '* Speak shorter sentences but concise.',
          '* Speak longer if the user asks for it.',
          '',
          'When recommending anime, always format the anime list as a numbered list exactly like the following:',
          '',
          '1. [![A Farewell to Arms](https://cdn.myanimelist.net/images/anime/4/53169.jpg)](https://www.animeoshi.com/anime/a-farewell-to-arms "Set in a futuristic Tokyo, skilled individuals confront automated tanks in this action-packed film.")',
          '2. [![Lightning Atom](https://cdn.myanimelist.net/images/anime/9/45160.jpg)](https://www.animeoshi.com/anime/lightning-atom "A young boy with electric superpowers fights evil forces in this classic adventure.")'
        ),
        inputFields: {
          yourName: z.string(),
          yourDescription: z.string(),
          defaultLanguage: z.string(),
          primaryFunction: z.string(),
          personality: z.string().nullable(),
          currentTime: z.string(),
          sender: z.string(),
          channel: z.string(),
          previousMessages: z.string(),
          message: z.string(),
        },
        outputFields: {
          reply: z.string(),
          sourceUrls: z.array(z.string()),
        },
      },
      this.tools
    );

    agent.on('thought', (thought) => console.log(`✦ ${thought}`));
    agent.on('action', (toolName, toolArgs) =>
      console.log(`→ ${toolName}: ${JSON.stringify(toolArgs)}`)
    );
    agent.on('observation', (toolName, observation) =>
      console.log(`← ${toolName}: ${JSON.stringify(observation)}`)
    );

    console.log(`← ${content}`);

    const [{ reply, sourceUrls }] = await agent.forward(
      lm,
      {
        yourName: persona.name,
        yourDescription: persona.description,
        defaultLanguage: metadata.language ?? 'en',
        primaryFunction: persona.prime,
        personality: persona.personality,
        currentTime: new Date().toISOString(),
        sender: metadata.replyId,
        channel: metadata.channel,
        previousMessages: unlines(
          ...metadata.history.map(
            (message) =>
              `${message.type === 'ai' ? '[You]' : message.name ?? '[Them]'}: ${
                message.content
              }`
          )
        ),
        message: content,
      },
      { maxIterations: 5 }
    );

    console.log(`→ ${reply}`);

    await this.say(reply, sourceUrls);

    return {};
  }
}

export const modes: Record<
  string,
  {
    new (
      tools: Record<string, synaptic.Tool<any, any>>,
      personas: Record<string, Persona>,
      say: (message: string, sourceUrls: string[]) => Promise<void>
    ): Mode;
  }
> = {
  chat: ChatMode,
};
