import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://flow.example" } }));

const { chatCompletion, OpenRouterError } = await import("./openrouter-client");

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("chatCompletion", () => {
  test("posts to OpenRouter with the org's own API key and returns the first choice's message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }] }), { status: 200 }),
    );

    const result = await chatCompletion({ apiKey: "sk-or-test", model: "some/model", messages: [{ role: "user", content: "hello" }] });

    expect(result).toEqual({ message: { role: "assistant", content: "hi" }, finishReason: "stop" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-or-test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("some/model");
    expect(body.tools).toBeUndefined();
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

  test("a non-2xx response throws OpenRouterError with the status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad key", { status: 401 }));
    await expect(chatCompletion({ apiKey: "k", model: "m", messages: [] })).rejects.toMatchObject({
      name: "OpenRouterError",
      status: 401,
    });
  });

  test("a network failure throws OpenRouterError", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(chatCompletion({ apiKey: "k", model: "m", messages: [] })).rejects.toThrow(OpenRouterError);
  });

  test("no choices in the response throws OpenRouterError", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(chatCompletion({ apiKey: "k", model: "m", messages: [] })).rejects.toThrow(/no choices/i);
  });
});
