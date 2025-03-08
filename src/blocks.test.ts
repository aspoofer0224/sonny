import { makeBlocks } from './blocks';
import { unlines } from './utils';

describe('makeBlocks', () => {
  it('makes blocks', () => {
    const message = unlines(
      'When recommending games, always format the game list as a numbered list exactly like the following:',
      '',
      '1. [![The Legend of Zelda: Breath of the Wild](https://example.com/images/zelda.jpg)](https://www.nintendo.com/store/products/the-legend-of-zelda-breath-of-the-wild-switch/ "Open-world adventure game with exploration and puzzle-solving. Available on Nintendo Switch.")',
      '2. [![Minecraft](https://example.com/images/minecraft.jpg)](https://www.minecraft.net/en-us "A sandbox game where players can build and explore virtual worlds. Available on multiple platforms.")',
      '',
      'When listing gaming communities, always format the thread list as a numbered list exactly like the following:',
      '',
      '1. [Zelda Speedrunning Community](https://discord.com/channels/123456789/zelda-speedruns)',
      '2. [Minecraft Building Tips](https://reddit.com/r/MinecraftBuilds)'
    );
    const output = makeBlocks(message);

    expect(output).toMatchSnapshot();
  });
});
