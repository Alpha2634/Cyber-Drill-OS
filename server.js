'use strict';
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const app = createApp({ dataFile: process.env.DATA_FILE });

app.server.listen(PORT, () => {
  console.log(`Cyber Drill backend listening on http://localhost:${PORT}`);
  console.log(process.env.ANTHROPIC_API_KEY ? 'AI feedback: enabled (validated)' : 'AI feedback: off (static explanations)');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await app.close(); process.exit(0); });
}
