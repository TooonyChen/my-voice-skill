import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseThreadJson } from "../../src/parsers/meta.ts";
import { parseInstagramExport } from "../../src/parsers/instagram.ts";

describe("parseThreadJson (instagram platform)", () => {
  it("stamps the instagram platform when requested", () => {
    const thread = {
      participants: [{ name: "me_handle" }, { name: "friend_handle" }],
      messages: [
        { sender_name: "friend_handle", timestamp_ms: 1700000000000, content: "yooo" },
        { sender_name: "me_handle", timestamp_ms: 1700000001000, content: "ayy" },
      ],
    };
    const parsed = parseThreadJson(thread, {
      myName: "me_handle",
      platform: "instagram",
    });
    expect(parsed.messages[0]!.platform).toBe("instagram");
    expect(parsed.messages[1]!.sender).toBe("me");
  });
});

describe("parseInstagramExport", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ig-export-"));
    const inbox = join(root, "your_instagram_activity", "messages", "inbox");
    const requests = join(
      root,
      "your_instagram_activity",
      "messages",
      "message_requests",
    );
    const threadA = join(inbox, "frienda_123");
    const threadB = join(requests, "strangerb_456");
    await mkdir(threadA, { recursive: true });
    await mkdir(threadB, { recursive: true });

    await writeFile(
      join(threadA, "message_1.json"),
      JSON.stringify({
        participants: [{ name: "me_handle" }, { name: "Friend A" }],
        thread_path: "inbox/frienda_123",
        messages: [
          { sender_name: "Friend A", timestamp_ms: 1700000000000, content: "hey" },
          { sender_name: "me_handle", timestamp_ms: 1700000001000, content: "sup" },
        ],
      }),
    );
    await writeFile(
      join(threadB, "message_1.json"),
      JSON.stringify({
        participants: [{ name: "me_handle" }, { name: "Stranger B" }],
        thread_path: "message_requests/strangerb_456",
        messages: [
          { sender_name: "Stranger B", timestamp_ms: 1700000002000, content: "hi!" },
        ],
      }),
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("scans both inbox and message_requests and tags messages as instagram", async () => {
    const messages = await parseInstagramExport(root, "me_handle");
    expect(messages.length).toBe(3);
    expect(messages.every((m) => m.platform === "instagram")).toBe(true);
    const contactIds = new Set(messages.map((m) => m.contact_id));
    expect(contactIds.has("frienda_123")).toBe(true);
    expect(contactIds.has("strangerb_456")).toBe(true);
  });
});
