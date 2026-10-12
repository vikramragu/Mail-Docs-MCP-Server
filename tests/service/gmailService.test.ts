import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesSend = vi.fn();
const draftsCreate = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        messages: { send: messagesSend },
        drafts: { create: draftsCreate },
      },
    })),
  },
}));

const { sendEmail, createDraft } = await import("../../src/services/gmailService.js");

const fakeAuth = {} as never;

beforeEach(() => {
  messagesSend.mockReset();
  draftsCreate.mockReset();
});

describe("gmailService.sendEmail", () => {
  it("sends the raw message and returns the message/thread id", async () => {
    messagesSend.mockResolvedValue({ data: { id: "msg1", threadId: "thread1" } });

    const result = await sendEmail(fakeAuth, { raw: "RAW", threadId: "thread1" });

    expect(messagesSend).toHaveBeenCalledWith({
      userId: "me",
      requestBody: { raw: "RAW", threadId: "thread1" },
    });
    expect(result).toEqual({ messageId: "msg1", threadId: "thread1" });
  });

  it("throws when Gmail returns no message id", async () => {
    messagesSend.mockResolvedValue({ data: {} });
    await expect(sendEmail(fakeAuth, { raw: "RAW" })).rejects.toThrow("no message id");
  });
});

describe("gmailService.createDraft", () => {
  it("creates a draft and returns the draft/message id", async () => {
    draftsCreate.mockResolvedValue({ data: { id: "draft1", message: { id: "msg1" } } });

    const result = await createDraft(fakeAuth, { raw: "RAW" });

    expect(draftsCreate).toHaveBeenCalledWith({
      userId: "me",
      requestBody: { message: { raw: "RAW", threadId: undefined } },
    });
    expect(result).toEqual({ draftId: "draft1", messageId: "msg1" });
  });
});
