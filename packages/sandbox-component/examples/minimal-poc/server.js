import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 5175);

const FILES = new Map([
  ["/index.html", { path: "public/index.html", type: "text/html; charset=utf-8" }],
  ["/sw.js", { path: "public/sw.js", type: "text/javascript; charset=utf-8" }],
]);

createServer(async (req, res) => {
  const file = FILES.get(new URL(req.url, "http://localhost").pathname);
  if (!file) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": file.type });
  res.end(await readFile(new URL(file.path, import.meta.url)));
}).listen(PORT, () => console.log(`http://localhost:${PORT}/index.html`));
