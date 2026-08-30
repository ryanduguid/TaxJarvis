// SPDX-License-Identifier: AGPL-3.0-only
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_PORT, previewPort } from "./validation-primitives.mjs";

const ALLOWED_METHODS = new Set(["GET", "HEAD"]);
const STATIC_ROUTES = new Map([
  ["/", "index.html"],
  ["/methodology/", "methodology/index.html"],
  ["/feed.xml", "feed.xml"],
  ["/feed.json", "feed.json"],
  ["/assets/site.css", "assets/site.css"],
]);
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".xml", "application/rss+xml; charset=utf-8"],
]);
const ERROR_RESPONSES = new Map([
  [400, "Bad request\n"],
  [403, "Forbidden\n"],
  [404, "Not found\n"],
  [405, "Method not allowed\n"],
]);

class HttpPathError extends Error {
  constructor(statusCode) {
    super("Request path is not permitted");
    this.statusCode = statusCode;
  }
}

function isContained(rootDir, candidate) {
  return candidate === rootDir || candidate.startsWith(`${rootDir}${sep}`);
}

function decodedRequestPath(requestUrl) {
  let decoded = String(requestUrl ?? "/").split(/[?#]/, 1)[0];
  while (true) {
    if (/%(?:2f|5c)/i.test(decoded)) throw new HttpPathError(403);
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      throw new HttpPathError(400);
    }
  }
  if (
    !decoded.startsWith("/")
    || decoded.includes("\0")
    || decoded.includes("\\")
    || decoded.split("/").includes("..")
  ) {
    throw new HttpPathError(403);
  }
  return decoded;
}

async function developmentEntries(rootDir) {
  try {
    return await readdir(join(rootDir, "developments"), { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

async function publicRoutes(rootDir) {
  const entries = await developmentEntries(rootDir);
  return new Map([
    ...STATIC_ROUTES,
    ...entries.filter(entry => entry.isDirectory()).map(entry => [
      `/developments/${entry.name}/`,
      `developments/${entry.name}/index.html`,
    ]),
  ]);
}

function resolveRequestPath(rootDir, requestUrl, routes) {
  const route = decodedRequestPath(requestUrl);
  const relativePath = routes.get(route);
  const filePath = relativePath ?? (route.endsWith("/") ? `${route}index.html` : route);

  const rootPath = resolve(rootDir);
  const candidate = resolve(rootPath, relativePath ?? `.${filePath}`);
  if (!isContained(rootPath, candidate)) throw new HttpPathError(403);
  return { candidate, isPublicRoute: relativePath !== undefined };
}

function sendFixedResponse(outgoing, statusCode, method) {
  const body = ERROR_RESPONSES.get(statusCode) ?? "Internal server error\n";
  const headers = {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    ...(statusCode === 405 ? { Allow: "GET, HEAD" } : {}),
  };
  outgoing.writeHead(statusCode, headers);
  outgoing.end(method === "HEAD" ? undefined : body);
}

function sendConnectResponse(socket) {
  const body = ERROR_RESPONSES.get(405);
  socket.end([
    "HTTP/1.1 405 Method Not Allowed",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "X-Content-Type-Options: nosniff",
    "Allow: GET, HEAD",
    "",
    body,
  ].join("\r\n"));
}

function createStaticServer({ rootDir, routes }) {
  const rootPath = resolve(rootDir);
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      if (!ALLOWED_METHODS.has(incoming.method)) {
        sendFixedResponse(outgoing, 405, incoming.method);
        return;
      }

      try {
        const { candidate, isPublicRoute } = resolveRequestPath(rootPath, incoming.url, routes);
        const realCandidate = await realpath(candidate);
        if (!isContained(rootPath, realCandidate)) throw new HttpPathError(403);

        const information = await stat(realCandidate);
        if (!isPublicRoute || !information.isFile()) throw new HttpPathError(404);

        const body = await readFile(realCandidate);
        outgoing.writeHead(200, {
          "Content-Type": CONTENT_TYPES.get(extname(realCandidate)),
          "Content-Length": body.length,
          "X-Content-Type-Options": "nosniff",
        });
        outgoing.end(incoming.method === "HEAD" ? undefined : body);
      } catch (error) {
        const statusCode = error.statusCode ?? (error.code === "ENOENT" ? 404 : 500);
        sendFixedResponse(outgoing, statusCode, incoming.method);
      }
    })();
  });
  server.on("connect", (_incoming, socket) => sendConnectResponse(socket));
  return server;
}

export async function startServer({
  rootDir,
  hostname = "127.0.0.1",
  port = DEFAULT_PORT,
}) {
  const canonicalRoot = await realpath(resolve(rootDir));
  const server = createStaticServer({
    rootDir: canonicalRoot,
    routes: await publicRoutes(canonicalRoot),
  });
  await new Promise((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, resolveListening);
  });
  return server;
}

const REPOSITORY_ROOT = fileURLToPath(new URL(".", import.meta.url));
const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";

if (invokedPath === import.meta.url) {
  void (async () => {
    try {
      const port = previewPort(process.env.PORT);
      await startServer({
        rootDir: resolve(REPOSITORY_ROOT, "out"),
        hostname: "127.0.0.1",
        port,
      });
      console.log(`Serving out/ at http://127.0.0.1:${port}/`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  })();
}
