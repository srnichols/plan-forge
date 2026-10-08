import { createServer } from "node:http";

const DEFAULT_FAKE_WAIT_MS = 1000;

export async function startFakeTelegram() {
  const calls = [];
  const updates = [];
  const files = new Map();
  const failures = new Map();
  const pendingPolls = new Set();
  let nextUpdateId = 1;
  let nextMessageId = 1;
  let closed = false;
  let server;

  function sendJson(response, status, body) {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }

  function matchUpdates(offset) {
    const minimum = Number.isInteger(offset) ? offset : 0;
    return updates.filter((update) => update.update_id >= minimum);
  }

  function releasePolls() {
    for (const release of pendingPolls) release();
    pendingPolls.clear();
  }

  async function readBody(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  async function handleApi(request, response, method, args) {
    const scripted = failures.get(method)?.shift();
    if (scripted) {
      if (scripted.body === "non-json") {
        response.writeHead(scripted.status, { "content-type": "text/plain" });
        response.end("not-json");
        return;
      }
      if (scripted.status === 429) {
        sendJson(response, scripted.status, {
          ok: false,
          error_code: 429,
          description: "Too Many Requests",
          parameters: { retry_after: scripted.retry_after ?? 1 },
        });
        return;
      }
      sendJson(response, scripted.status, scripted.body ?? {
        ok: false,
        error_code: scripted.status,
        description: "Scripted failure",
      });
      return;
    }
    if (method === "getUpdates") {
      const available = matchUpdates(args.offset);
      if (available.length > 0) {
        sendJson(response, 200, { ok: true, result: available });
        return;
      }
      let timer;
      const release = () => {
        clearTimeout(timer);
        pendingPolls.delete(release);
        if (response.writableEnded) return;
        sendJson(response, 200, { ok: true, result: matchUpdates(args.offset) });
      };
      pendingPolls.add(release);
      timer = setTimeout(release, Math.min(Number(args.timeout) || 0, 1) * 1000 || DEFAULT_FAKE_WAIT_MS);
      response.on("close", () => {
        clearTimeout(timer);
        pendingPolls.delete(release);
      });
      return;
    }
    if (method === "getMe") {
      sendJson(response, 200, { ok: true, result: {
        id: 9, is_bot: true, username: "fake_bot", can_read_all_group_messages: true,
      } });
      return;
    }
    if (method === "sendMessage") {
      sendJson(response, 200, { ok: true, result: {
        message_id: nextMessageId++,
        chat: { id: args.chat_id },
        text: args.text,
        ...(args.message_thread_id === undefined ? {} : { message_thread_id: args.message_thread_id }),
        ...(args.reply_markup === undefined ? {} : { reply_markup: args.reply_markup }),
      } });
      return;
    }
    if (method === "editMessageText") {
      sendJson(response, 200, { ok: true, result: { message_id: args.message_id, text: args.text } });
      return;
    }
    if (method === "answerCallbackQuery" || method === "sendChatAction"
      || method === "setMyCommands" || method === "setWebhook" || method === "deleteWebhook") {
      sendJson(response, 200, { ok: true, result: true });
      return;
    }
    if (method === "getFile") {
      const entry = files.get(args.file_id);
      if (!entry) {
        sendJson(response, 200, { ok: false, error_code: 404, description: "File not found" });
        return;
      }
      sendJson(response, 200, { ok: true, result: {
        file_id: args.file_id,
        file_path: entry.filePath,
        file_size: entry.bytes.length,
      } });
      return;
    }
    sendJson(response, 404, { ok: false, error_code: 404, description: "Unknown method" });
  }

  server = createServer(async (request, response) => {
    const requestPath = new URL(request.url, "http://127.0.0.1").pathname;
    const fileMatch = requestPath.match(/^\/file\/bot[^/]+\/(.+)$/);
    if (fileMatch && request.method === "GET") {
      const filePath = decodeURIComponent(fileMatch[1]);
      const entry = [...files.values()].find((item) => item.filePath === filePath);
      if (!entry) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(entry.bytes);
      return;
    }
    const apiMatch = requestPath.match(/^\/bot[^/]+\/([A-Za-z]+)$/);
    if (!apiMatch) {
      sendJson(response, 404, { ok: false, description: "Not found" });
      return;
    }
    const method = apiMatch[1];
    let args;
    try {
      args = request.method === "GET" ? {} : await readBody(request);
    } catch {
      sendJson(response, 400, { ok: false, description: "Invalid request" });
      return;
    }
    calls.push({ method, args });
    await handleApi(request, response, method, args);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();

  function push(update) {
    const record = { update_id: nextUpdateId++, ...update };
    updates.push(record);
    releasePolls();
    return record;
  }

  function pushMessage({ chatId = 42, userId = 7, text = "hello", threadId, ...message } = {}) {
    return push({ message: {
      message_id: nextMessageId++,
      chat: { id: chatId },
      from: { id: userId },
      text,
      ...(threadId === undefined ? {} : { message_thread_id: threadId }),
      ...message,
    } });
  }

  function pushCallback({ chatId = 42, userId = 7, data = "tap", callbackId = "callback-1", threadId } = {}) {
    return push({ callback_query: {
      id: callbackId,
      from: { id: userId },
      data,
      message: {
        message_id: nextMessageId++,
        chat: { id: chatId },
        ...(threadId === undefined ? {} : { message_thread_id: threadId }),
      },
    } });
  }

  function failNext(method, options = 500) {
    if (!failures.has(method)) failures.set(method, []);
    failures.get(method).push(typeof options === "number"
      ? { status: options }
      : typeof options === "string"
      ? { status: Number(options) || 500, body: { ok: false, error_code: options, description: options } }
      : options);
  }

  function addFile(fileId, bytes, filePath = `documents/${fileId}.bin`) {
    const data = Buffer.from(bytes);
    files.set(fileId, { bytes: data, filePath });
  }

  async function waitForCall(method, predicate = () => true, timeoutMs = 3000) {
    if (typeof predicate !== "function") {
      const options = predicate ?? {};
      predicate = () => true;
      timeoutMs = options.timeoutMs ?? timeoutMs;
    }
    const until = Date.now() + timeoutMs;
    while (Date.now() <= until) {
      const match = calls.find((call) => call.method === method && predicate(call.args, call));
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for fake Telegram method ${method}`);
  }

  function edits(chatId, messageId) {
    return calls.filter(({ method, args }) => method === "editMessageText"
      && (chatId === undefined || String(args.chat_id) === String(chatId))
      && (messageId === undefined || String(args.message_id) === String(messageId)));
  }

  function menus() {
    return calls.filter(({ method }) => method === "setMyCommands").map(({ args }) => args);
  }

  function sentTo(chatId) {
    return calls.filter(({ method, args }) => method === "sendMessage"
      && String(args.chat_id) === String(chatId));
  }

  function reset({ preserveUpdateSequence = false } = {}) {
    calls.length = 0;
    updates.length = 0;
    files.clear();
    failures.clear();
    if (!preserveUpdateSequence) nextUpdateId = 1;
    nextMessageId = 1;
  }

  async function close() {
    if (closed) return;
    closed = true;
    releasePolls();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  return {
    apiBase: `http://127.0.0.1:${address.port}`,
    calls,
    pushMessage,
    pushCallback,
    failNext,
    addFile,
    waitForCall,
    edits,
    menus,
    sentTo,
    reset,
    close,
  };
}
