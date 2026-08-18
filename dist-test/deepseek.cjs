"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/providers/deepseek.ts
var deepseek_exports = {};
__export(deepseek_exports, {
  streamChat: () => streamChat
});
module.exports = __toCommonJS(deepseek_exports);
function parseSseEvent(line) {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (data === "[DONE]") return { data: null };
  try {
    return { data: JSON.parse(data) };
  } catch {
    return null;
  }
}
async function streamChat(request, handlers, signal) {
  const endpoint = `${request.baseURL.replace(/\/+$/, "")}/responses`;
  const body = {
    model: request.model,
    input: request.messages.map((m) => ({ role: m.role, content: [{ type: "input_text", text: m.content }] })),
    stream: true,
    max_output_tokens: request.maxTokens ?? 4096
  };
  if (request.tools && request.tools.length > 0) body.tools = request.tools;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (signal?.aborted) return;
    handlers.onError(new Error(`\u8BF7\u6C42\u5931\u8D25: ${String(error)}`));
    return;
  }
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const parsed = await response.json();
      message = parsed.error?.message ?? parsed.message ?? message;
    } catch {
    }
    handlers.onError(new Error(`API \u9519\u8BEF: ${message}`));
    return;
  }
  if (!response.body) {
    handlers.onError(new Error("\u54CD\u5E94\u65E0\u6570\u636E\u6D41"));
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const ev = parseSseEvent(trimmed);
        if (!ev || ev.data === null) continue;
        dispatch(ev.data, handlers);
      }
    }
    handlers.onDone();
  } catch (error) {
    if (signal?.aborted) return;
    handlers.onError(error instanceof Error ? error : new Error(String(error)));
  }
}
function dispatch(data, handlers) {
  if (typeof data !== "object" || data === null) return;
  const record = data;
  const type = record.type;
  switch (type) {
    case "response.output_text.delta":
      if (typeof record.delta === "string") handlers.onTextDelta(record.delta);
      break;
    case "response.reasoning_summary_text.delta":
    case "response.reasoning_text.delta":
      if (typeof record.delta === "string") handlers.onReasoningDelta(record.delta);
      break;
    case "response.function_call_arguments.done":
      if (typeof record.name === "string" && typeof record.arguments === "string") {
        let args = {};
        try {
          args = JSON.parse(record.arguments);
        } catch {
        }
        handlers.onToolCall({ id: String(record.call_id ?? ""), name: record.name, args });
      }
      break;
    case "response.completed":
      handlers.onDone();
      break;
    default:
      break;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  streamChat
});
