import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  parseWeFlowExport,
  parseWeFlowGroupExport,
} from "../../src/parsers/weflow.ts";

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

  test("parses ChatLab groups into the group side channel", async () => {
    const messages = await parseWeFlowGroupExport(
      join(FIXTURE_ROOT, "group-chatlab.json"),
      "Me",
    );
    expect(messages.length).toBe(2);
    expect(messages.every((m) => m.group_id === "project@chatroom")).toBe(true);
    expect(messages[0]?.sender).toBe("participant");
    expect(messages[1]?.sender).toBe("me");
    expect(messages[0]?.participant_id).toBe("wxid_coworker");
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

  test("parses WeFlow text export JSON with session metadata and no my name", async () => {
    const messages = await parseWeFlowExport(
      join(FIXTURE_ROOT, "session-export.json"),
      "",
    );

    expect(messages.length).toBe(3);
    expect(messages.every((m) => m.contact_id === "wxid_session_friend")).toBe(true);
    expect(messages.every((m) => m.contact_name === "Session Friend")).toBe(true);
    expect(messages[0]?.sender).toBe("me");
    expect(messages[1]?.sender).toBe("them");
    expect(messages[2]?.media_type).toBe("voice");
    expect(messages[2]?.text).toBeNull();
  });

  test("strips embedded quoted context from raw WeFlow text exports", async () => {
    const messages = await parseWeFlowExport(
      join(FIXTURE_ROOT, "session-quoted-emoji.json"),
      "",
    );

    expect(messages.length).toBe(2);
    expect(messages[0]?.sender).toBe("me");
    expect(messages[0]?.text).toBe("啥意思");
    expect(messages[0]?.text).not.toContain("🍙");
    expect(messages[1]?.text).toBeNull();
  });

  test("uses session.type to skip group text exports by default", async () => {
    const messages = await parseWeFlowExport(
      join(FIXTURE_ROOT, "session-group-export.json"),
      "",
    );
    expect(messages).toEqual([]);
  });

  test("can include session-group text exports when requested", async () => {
    const messages = await parseWeFlowExport(
      join(FIXTURE_ROOT, "session-group-export.json"),
      "",
      [],
      { includeGroups: true },
    );
    expect(messages.length).toBe(1);
    expect(messages[0]?.contact_id).toBe("wxid_group_session");
    expect(messages[0]?.contact_name).toBe("Session Group");
  });

  test("parses session-group text exports into the group side channel", async () => {
    const messages = await parseWeFlowGroupExport(
      join(FIXTURE_ROOT, "session-group-export.json"),
      "",
    );
    expect(messages.length).toBe(1);
    expect(messages[0]?.group_id).toBe("wxid_group_session");
    expect(messages[0]?.participant_id).toBe("wxid_group_member");
    expect(messages[0]?.participant_name).toBe("Member");
  });
});
