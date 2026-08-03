import { describe, test, expect, vi, beforeEach } from "vitest";

const chatCompletionMock = vi.fn();
vi.mock("./llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm-client")>();
  return { ...actual, chatCompletion: (...args: unknown[]) => chatCompletionMock(...args) };
});

const { runMiraAgentLoop } = await import("./agent-loop");

const baseTool = { name: "search_assets", description: "search", operation: "assets.list", isWrite: false, danger: null, parameters: { type: "object", properties: {} } };

function assistantText(content: string) {
  return { message: { role: "assistant" as const, content }, finishReason: "stop" };
}

function assistantToolCall(name: string, args: Record<string, unknown>, id = "call_1") {
  return {
    message: { role: "assistant" as const, content: null, tool_calls: [{ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }] },
    finishReason: "tool_calls",
  };
}

beforeEach(() => {
  chatCompletionMock.mockReset();
});

describe("runMiraAgentLoop", () => {
  test("no tool calls: returns immediately with the assistant's text", async () => {
    chatCompletionMock.mockResolvedValueOnce(assistantText("Hi there!"));
    const executeTool = vi.fn();

    const result = await runMiraAgentLoop({
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "hello" }],
      tools: [baseTool],
      executeTool,
    });

    expect(result.appended).toEqual([{ role: "assistant", content: "Hi there!" }]);
    expect(result.pendingConfirmation).toBeNull();
    expect(executeTool).not.toHaveBeenCalled();
  });

  test("one tool round-trip then a final answer", async () => {
    chatCompletionMock.mockResolvedValueOnce(assistantToolCall("search_assets", { q: "camera" }));
    chatCompletionMock.mockResolvedValueOnce(assistantText("Found 3 assets."));
    const executeTool = vi.fn().mockResolvedValue({ ok: true, data: [{ id: "a1" }] });

    const result = await runMiraAgentLoop({
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "find cameras" }],
      tools: [baseTool],
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledWith("search_assets", { q: "camera" });
    expect(result.appended.at(-1)).toEqual({ role: "assistant", content: "Found 3 assets." });
    expect(result.appended).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "search_assets", arguments: JSON.stringify({ q: "camera" }) } }] },
      { role: "tool", tool_call_id: "call_1", name: "search_assets", content: JSON.stringify([{ id: "a1" }]) },
      { role: "assistant", content: "Found 3 assets." },
    ]);
    expect(result.pendingConfirmation).toBeNull();
  });

  test("a CONFIRMATION_REQUIRED tool result stops the loop after one explanatory turn, never retries", async () => {
    chatCompletionMock.mockResolvedValueOnce(assistantToolCall("dispatch_gear", { projectId: "p1" }));
    chatCompletionMock.mockResolvedValueOnce(assistantText("I'm ready to dispatch this — please confirm."));
    const pending = { operation: "warehouseWrites.checkOutItems", args: { projectId: "p1" }, idempotencyKey: "idem-1", summary: "This would dispatch gear." };
    const executeTool = vi.fn().mockResolvedValue({ ok: false, needsConfirmation: true, pending });

    const result = await runMiraAgentLoop({
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "dispatch it" }],
      tools: [baseTool],
      executeTool,
    });

    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
    expect(chatCompletionMock.mock.calls[1]![0]).toMatchObject({ tools: undefined }); // final explanatory turn has NO tools
    expect(result.pendingConfirmation).toEqual(pending);
    expect(result.appended.at(-1)).toEqual({ role: "assistant", content: "I'm ready to dispatch this — please confirm." });
  });

  test("invalid tool-call JSON never reaches executeTool, surfaces as a tool error instead", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "search_assets", arguments: "{not json" } }] },
      finishReason: "tool_calls",
    });
    chatCompletionMock.mockResolvedValueOnce(assistantText("Let me try again."));
    const executeTool = vi.fn();

    const result = await runMiraAgentLoop({ apiKey: "k", model: "m", messages: [], tools: [baseTool], executeTool });

    expect(executeTool).not.toHaveBeenCalled();
    const toolResult = result.appended.find((m) => m.role === "tool")!;
    expect(toolResult.content).toMatch(/not valid JSON/i);
  });

  test("running out of iterations synthesizes a fallback instead of looping forever", async () => {
    chatCompletionMock.mockResolvedValue(assistantToolCall("search_assets", {}));
    const executeTool = vi.fn().mockResolvedValue({ ok: true, data: [] });

    const result = await runMiraAgentLoop({ apiKey: "k", model: "m", messages: [], tools: [baseTool], executeTool, maxIterations: 2 });

    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
    expect(result.appended.at(-1)?.content).toMatch(/didn't reach a final answer/i);
  });

  test("an LLM client error is caught and surfaced as an assistant message, not thrown", async () => {
    const { LlmClientError } = await import("./llm-client");
    chatCompletionMock.mockRejectedValueOnce(new LlmClientError("boom", 500));
    const result = await runMiraAgentLoop({ apiKey: "k", model: "m", messages: [], tools: [baseTool], executeTool: vi.fn() });
    expect(result.appended[0]!.content).toMatch(/error talking to the language model/i);
  });

  test("baseUrl is threaded through to every chatCompletion call", async () => {
    chatCompletionMock.mockResolvedValueOnce(assistantText("hi"));
    await runMiraAgentLoop({ apiKey: "k", model: "m", baseUrl: "https://my-backend.example/v1", messages: [], tools: [baseTool], executeTool: vi.fn() });
    expect(chatCompletionMock.mock.calls[0]![0]).toMatchObject({ baseUrl: "https://my-backend.example/v1" });
  });
});
