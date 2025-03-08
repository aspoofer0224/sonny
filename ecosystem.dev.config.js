module.exports = {
  apps: [
    {
      name: "redis",
      script: "redis-server",
    },
    {
      name: "agent",
      script: "dotenvx run -- tsx src/agent",
    },
    {
      name: "server",
      script: "dotenvx run -- tsx src/server",
    },
  ],
};
