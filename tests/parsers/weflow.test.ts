import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseWeFlowExport } from "../../src/parsers/weflow.ts";

const FIXTURE_ROOT = join(import.meta.dir, "..", "fixtures", "weflow");

describe("parseWeFlowExport — ChatLab JSON", () => {
  test("parses private ChatLab exports and ignores media contents", async () => {
    const messages = await parseWeFlowExport(
      join(FIXTURE_ROOT, "private-chatlab.json"),
      "Me",
    );

    expect(messages.length).toBe(4);
    expect(messages.every((m) => m.platform === "wechat")).toBe(true);
    expect(messages.every((m) => m.contact_id === "wxid_friend")).toBe(true);
    expect(messages.every((m) => m.contact_name === "小明")).toBe(true);

    expect(messages[0]?.sender).toBe("them");
    expect(messages[0]?.text).toBe("到家了吗");
    expect(messages[1]?.sender).toBe("me");
    expect(messages[1]?.text).toBe("到了，刚洗完澡");

    const image = messages.find((m) => m.media_type === "image");
    expect(image).toBeDefined();
    expect(image?.text).toBeNull();

    const reply = messages.find((m) => m.text === "那就好");
    expect(reply?.reply_to_timestamp?.getTime()).toBe(
      new Date(1738713660 * 1000).getTime(),
    );
  });

  test("skips group chats by default", async () => {
    const messages = await parseWeFlowExport(
      join(FIXTURE_ROOT, "group-chatlab.json"),
      "Me",
    );
    expect(messages).toEqual([]);
  });

  test("can import group chats as conversation-level contacts when requested", async () => {
    const messages = await parseWeFlowExport(
      join(FIXTURE_ROOT, "group-chatlab.json"),
      "Me",
      [],
      { includeGroups: true },
    );
    expect(messages.length).toBe(2);
    expect(messages.every((m) => m.contact_id === "project@chatroom")).toBe(true);
    expect(messages.every((m) => m.contact_name === "项目群")).toBe(true);
    expect(messages[0]?.sender).toBe("them");
    expect(messages[1]?.sender).toBe("me");
  });
});

describe("parseWeFlowExport — raw WeFlow messages JSON", () => {
  test("parses saved /api/v1/messages JSON without importing media payloads", async () => {
    const messages = await parseWeFlowExport(
      join(FIXTURE_ROOT, "raw-messages.json"),
      "Me",
    );

    expect(messages.length).toBe(3);
    expect(messages.every((m) => m.platform === "wechat")).toBe(true);
    expect(messages.every((m) => m.contact_id === "wxid_raw_friend")).toBe(true);
    expect(messages.every((m) => m.contact_name === "Raw Friend")).toBe(true);

    expect(messages[0]?.sender).toBe("me");
    expect(messages[0]?.text).toBe("我晚点到");

    expect(messages[1]?.sender).toBe("them");
    expect(messages[1]?.media_type).toBe("image");
    expect(messages[1]?.text).toBeNull();

    expect(messages[2]?.text).toBe("行");
    expect(messages[2]?.reply_to_timestamp?.getTime()).toBe(
      new Date(1738716000 * 1000).getTime(),
    );
  });
});
