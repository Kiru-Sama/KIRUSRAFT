"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/test-raw-events.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var yaml = import_node_fs.default.readFileSync(import_node_path.default.join(import_node_os.default.homedir(), ".dsh", ".credentials.yaml"), "utf8");
var key = yaml.match(/DEEPSEEK_API_KEY:\s*["']?([^"'\s]+)/)[1].trim();
(async () => {
  const body = {
    model: "deepseek-v4-flash-0731",
    input: [{ role: "user", content: [{ type: "input_text", text: "\u73B0\u5728\u51E0\u70B9\u4E86\uFF1F\u8BF7\u8C03\u7528 get_time_info \u5DE5\u5177\u56DE\u7B54\u3002" }] }],
    stream: true,
    max_output_tokens: 512,
    tools: [{
      type: "function",
      name: "get_time_info",
      description: "\u83B7\u53D6\u5F53\u524D\u65E5\u671F\u65F6\u95F4",
      parameters: { type: "object", properties: {} }
    }]
  };
  const res = await fetch("https://tokenrhythm.studio/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  console.log("HTTP", res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const types = /* @__PURE__ */ new Map();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const obj = JSON.parse(data);
        const type = obj.type || "?";
        types.set(type, (types.get(type) || 0) + 1);
        if (type.includes("item") || type.includes("function") || type.includes("output")) {
          console.log("\u4E8B\u4EF6:", JSON.stringify(obj).slice(0, 300));
        }
      } catch {
      }
    }
  }
  console.log("\n=== \u4E8B\u4EF6\u7C7B\u578B\u7EDF\u8BA1 ===");
  for (const [k, v] of types) console.log(`${k}: ${v}`);
})();
