import { createServer } from "node:http";
// A trivial runtime dependency so `npm ci --omit=dev` (the Dockerfile's
// `deps` stage) actually populates node_modules/ — an app with zero
// production dependencies leaves that directory absent, which breaks the
// later `COPY --from=deps /app/node_modules` stage.
import ms from "ms";

const PORT = Number(process.env.PORT ?? 3000);
const startedAt = Date.now();

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: ms(Date.now() - startedAt) }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`preset-build scaffold listening on :${PORT}`);
});
