import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectPartialAssistantStream,
  isDuplicateAssistantTextEvent,
  parseJsonlEntriesToTimeline,
  parseLiveEventsToTimeline,
} from "./parse-timeline";

describe("parseJsonlEntriesToTimeline", () => {
  it("interleaves text and tool_use in content order", () => {
    const { messages, toolCalls } = parseJsonlEntriesToTimeline(
      [
        {
          role: "user",
          message: { content: [{ type: "text", text: "hi" }] },
        },
        {
          role: "assistant",
          message: {
            content: [
              { type: "text", text: "before" },
              {
                type: "tool_use",
                id: "t1",
                name: "Read",
                input: { path: "a.ts" },
              },
              { type: "text", text: "after" },
            ],
          },
        },
      ],
      "sess",
      1000,
    );

    assert.equal(messages.length, 3);
    assert.equal(messages[0].content, "hi");
    assert.equal(messages[1].content, "before");
    assert.equal(messages[2].content, "after");
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].path, "a.ts");

    assert.ok(messages[1].timestamp < toolCalls[0].timestamp);
    assert.ok(toolCalls[0].timestamp < messages[2].timestamp);
  });

  it("merges consecutive assistant text only when no tools between", () => {
    const { messages, toolCalls } = parseJsonlEntriesToTimeline(
      [
        {
          role: "assistant",
          message: { content: [{ type: "text", text: "Hel" }] },
        },
        {
          role: "assistant",
          message: { content: [{ type: "text", text: "lo" }] },
        },
        {
          role: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "Shell",
                input: { command: "ls" },
              },
            ],
          },
        },
        {
          role: "assistant",
          message: { content: [{ type: "text", text: "done" }] },
        },
      ],
      "sess",
      1000,
    );

    assert.equal(messages.length, 2);
    assert.equal(messages[0].content, "Hello");
    assert.equal(messages[1].content, "done");
    assert.equal(toolCalls.length, 1);
    assert.ok(messages[0].timestamp < toolCalls[0].timestamp);
    assert.ok(toolCalls[0].timestamp < messages[1].timestamp);
  });
});

describe("parseLiveEventsToTimeline", () => {
  it("dedupes stream-partial assistant flushes", () => {
    const events = [
      {
        type: "assistant",
        timestamp_ms: 1,
        message: { content: [{ type: "text", text: "Hi" }] },
      },
      {
        type: "assistant",
        timestamp_ms: 2,
        message: { content: [{ type: "text", text: " there" }] },
      },
      {
        type: "assistant",
        timestamp_ms: 3,
        model_call_id: "mc1",
        message: { content: [{ type: "text", text: "Hi there" }] },
      },
      {
        type: "tool_call",
        subtype: "started",
        call_id: "c1",
        tool_call: { readToolCall: { args: { path: "x.ts" } } },
      },
      {
        type: "tool_call",
        subtype: "completed",
        call_id: "c1",
        tool_call: {
          readToolCall: {
            args: { path: "x.ts" },
            result: { success: { content: "ok", totalLines: 1 } },
          },
        },
      },
      {
        type: "assistant",
        timestamp_ms: 4,
        message: { content: [{ type: "text", text: "Done" }] },
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Hi thereDone" }] },
      },
    ];

    assert.equal(detectPartialAssistantStream(events), true);
    assert.equal(
      isDuplicateAssistantTextEvent(events[2], true),
      true,
    );
    assert.equal(
      isDuplicateAssistantTextEvent(events[6], true),
      true,
    );

    const { messages, toolCalls } = parseLiveEventsToTimeline(events, "live", 1000);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].content, "Hi there");
    assert.equal(messages[1].content, "Done");
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].status, "completed");
    assert.equal(toolCalls[0].path, "x.ts");
    assert.ok(messages[0].timestamp < toolCalls[0].timestamp);
    assert.ok(toolCalls[0].timestamp < messages[1].timestamp);
  });

  it("keeps non-partial assistant messages (no timestamp_ms in stream)", () => {
    const events = [
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Only once" }] },
      },
      {
        type: "tool_call",
        subtype: "started",
        call_id: "c1",
        tool_call: { shellToolCall: { args: { command: "echo 1" } } },
      },
    ];
    const { messages, toolCalls } = parseLiveEventsToTimeline(events, "live", 1000);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, "Only once");
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].command, "echo 1");
  });
});
