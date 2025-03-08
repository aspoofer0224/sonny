module.exports = {
  apps: [
    {
      name: "agent",
      script: "node dist/agent.js",
    },
    {
      name: "server",
      script: "node dist/server.js",
    },
  ],
};
