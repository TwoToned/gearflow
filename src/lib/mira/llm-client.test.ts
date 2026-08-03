import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://flow.example" } }));

const { chatCompletion, LlmClientError, DEFAULT_LLM_BASE_URL } = await import("./llm-client");

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("chatCompletion", () => {
  test("defaults to OpenRouter and returns the first choice's message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }] }), { status: 200 }),
    );

    const result = await chatCompletion({ apiKey: "sk-or-test", model: "some/model", messages: [{ role: "user", content: "hello" }] });

    expect(result).toEqual({ message: { role: "assistant", content: "hi" }, finishReason: "stop" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${DEFAULT_LLM_BASE_URL}/chat/completions`);
    expect(init.headers.Authorization).toBe("Bearer sk-or-test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("some/model");
    expect(body.tools).toBeUndefined();
  });

  // Regression test: a prior version hardcoded "RVLT Flow — Mira" (an em
  // dash, U+2014) into the X-Title header. Fetch header values must be
  // ASCII (a ByteString) — that shipped as a production outage
  // ("Cannot convert argument to a ByteString because the character at
  // index 10 has a value of 8212 which is greater than 255"). Construct a
  // REAL Headers object from what chatCompletion sends, the same way the
  // real fetch() implementation would, so this test fails the same way
  // the bug did if it ever comes back.
  test("every header value is ASCII-safe — constructing real Headers from them never throws", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }] }), { status: 200 }));
    await chatCompletion({ apiKey: "k", model: "m", messages: [] });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(() => new Headers(init.headers)).not.toThrow();
    for (const value of Object.values(init.headers as Record<string, string>)) {
      for (let i = 0; i < value.length; i++) {
        expect(value.charCodeAt(i)).toBeLessThanOrEqual(255);
      }
    }
  });

  test("includes tools + tool_choice:auto only when tools are passed", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200 }));
    await chatCompletion({
      apiKey: "k",
      model: "m",
      messages: [],
      tools: [{ type: "function", function: { name: "t", description: "d", parameters: {} } }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe("auto");
  });

  test("a custom baseUrl posts to {baseUrl}/chat/completions and omits OpenRouter attribution headers", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200 }));
    await chatCompletion({ apiKey: "k", model: "m", messages: [], baseUrl: "https://my-vllm.internal:8000/v1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://my-vllm.internal:8000/v1/chat/completions");
    expect(init.headers["HTTP-Referer"]).toBeUndefined();
    expect(init.headers["X-Title"]).toBeUndefined();
  });

  test("a custom baseUrl's trailing slash doesn't produce a double slash", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200 }));
    await chatCompletion({ apiKey: "k", model: "m", messages: [], baseUrl: "https://my-vllm.internal:8000/v1/" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://my-vllm.internal:8000/v1/chat/completions");
  });

  test("a non-2xx response throws LlmClientError with the status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad key", { status: 401 }));
    await expect(chatCompletion({ apiKey: "k", model: "m", messages: [] })).rejects.toMatchObject({
      name: "LlmClientError",
      status: 401,
    });
  });

  test("a network failure throws LlmClientError", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(chatCompletion({ apiKey: "k", model: "m", messages: [] })).rejects.toThrow(LlmClientError);
  });

  test("no choices in the response throws LlmClientError", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(chatCompletion({ apiKey: "k", model: "m", messages: [] })).rejects.toThrow(/no choices/i);
  });
});
