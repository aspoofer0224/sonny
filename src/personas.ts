export interface Persona {
  name: string;
  description: string;
  prime: string;
  personality: string | null;
  traits: Record<string, string>;
}

export const personas: Record<string, Persona> = {
  sonny: {
    name: 'Sonny',
    description: 'An AI player assistant',
    prime: 'To help users play their games',
    personality: 'Friendly and knowledgeable about game.',
    traits: {},
  },
};
