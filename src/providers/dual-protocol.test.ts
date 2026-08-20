/**
 * 双协议 provider 测试（v0.0.38）
 * 锁住：OpenAI 官方预设可切换协议——protocol='responses' 走 /responses，否则走 /chat/completions。
 */
import { describe, expect, it, vi } from 'vitest';
import { createDualProtocolProvider } from './openai-compatible';
import type { ChatRequest, ChatStreamHandlers } from '../core/types';

function makeHandlers(): ChatStreamHandlers {
  return {
    onTextDelta: () => undefined,
    onReasoningDelta: () => undefined,
    onToolCall: () => undefined,
    onDone: () => undefined,
    onError: () => undefined,
  };
}

function sseChunk(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

describe('双协议 provider', () => {
  it("protocol='responses' 请求 /responses 端点并解析 Responses 事件", async () => {
    let calledUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calledUrl = String(url);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseChunk({ type: 'response.output_text.delta', delta: 'Hi' })));
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return { ok: true, status: 200, body: stream, json: async () => ({}) } as Response;
      }),
    );
    const provider = createDualProtocolProvider('openai', 'OpenAI');
    const texts: string[] = [];
    const h = { ...makeHandlers(), onTextDelta: (t: string) => void texts.push(t) };
    const req: ChatRequest = { model: 'gpt-4o-mini', apiKey: 'k', baseURL: 'https://api.openai.com/v1', protocol: 'responses', messages: [] };
    await provider.streamChat(req, h);
    expect(calledUrl).toBe('https://api.openai.com/v1/responses');
    expect(texts.join('')).toBe('Hi');
  });

  it("protocol='chat' 请求 /chat/completions 端点并解析 choices 事件", async () => {
    let calledUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calledUrl = String(url);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseChunk({ choices: [{ delta: { content: 'Yo' } }] })));
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return { ok: true, status: 200, body: stream, json: async () => ({}) } as Response;
      }),
    );
    const provider = createDualProtocolProvider('openai', 'OpenAI');
    const texts: string[] = [];
    const h = { ...makeHandlers(), onTextDelta: (t: string) => void texts.push(t) };
    const req: ChatRequest = { model: 'gpt-4o-mini', apiKey: 'k', baseURL: 'https://api.openai.com/v1', protocol: 'chat', messages: [] };
    await provider.streamChat(req, h);
    expect(calledUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect(texts.join('')).toBe('Yo');
  });

  // ===== v0.0.64：Responses body 映射（instructions / reasoning / temperature / input_image）=====
  it("responses：systemPrompt→instructions、thinkLevel→reasoning.effort、图片→input_image", async () => {
    let calledBody: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        calledBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return { ok: true, status: 200, body: stream, json: async () => ({}) } as Response;
      }),
    );
    const provider = createDualProtocolProvider('openai', 'OpenAI');
    const req: ChatRequest = {
      model: 'gpt-5',
      apiKey: 'k',
      baseURL: 'https://api.openai.com/v1',
      protocol: 'responses',
      temperature: 0.5,
      systemPrompt: '你是助手',
      thinkLevel: 4,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '看图' },
            { type: 'image', imageUrl: 'data:image/jpeg;base64,BBB=' },
          ],
        },
      ],
    };
    await provider.streamChat(req, makeHandlers());
    expect(calledBody.instructions).toBe('你是助手');
    expect(calledBody.temperature).toBe(0.5);
    expect(calledBody.reasoning).toEqual({ effort: 'high' });
    const input = calledBody.input as { role: string; content: unknown[] }[];
    expect(input[0].content).toEqual([
      { type: 'input_text', text: '看图' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,BBB=' },
    ]);
  });

  it("responses：thinkLevel 0=不思考→effort none，1=自动→省略 reasoning", async () => {
    const bodies: Record<string, unknown>[] = [];
    for (const level of [0, 1]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
              controller.close();
            },
          });
          return { ok: true, status: 200, body: stream, json: async () => ({}) } as Response;
        }),
      );
      const provider = createDualProtocolProvider('openai', 'OpenAI');
      await provider.streamChat({ ...({ model: 'gpt-5', apiKey: 'k', baseURL: 'https://api.openai.com/v1', protocol: 'responses', messages: [], thinkLevel: level } as ChatRequest) }, makeHandlers());
    }
    expect(bodies[0].reasoning).toEqual({ effort: 'none' });
    expect(bodies[1].reasoning).toBeUndefined();
  });
});
