import { describe, expect, test } from "bun:test";
import type { ContactStats } from "../../src/types/contact.ts";
import type { GroupMessage } from "../../src/types/group.ts";
import {
  computeGroupContexts,
  computeGroupRelationshipSignals,
  computeGroupToneStats,
} from "../../src/analyzers/group.ts";

const GROUP_MESSAGES: GroupMessage[] = [
  {
    group_id: "project@chatroom",
    group_name: "Project",
    platform: "wechat",
    timestamp: new Date("2026-01-01T00:00:00Z"),
    sender: "participant",
    participant_id: "wxid_alex",
    participant_name: "Alex",
    text: "上线吗",
    media_type: "text",
    reply_to_timestamp: null,
  },
  {
    group_id: "project@chatroom",
    group_name: "Project",
    platform: "wechat",
    timestamp: new Date("2026-01-01T00:01:00Z"),
    sender: "me",
    participant_id: "chenxzhong2012",
    participant_name: "untitled",
    text: "Alex 先等回归结果",
    media_type: "text",
    reply_to_timestamp: null,
  },
  {
    group_id: "project@chatroom",
    group_name: "Project",
    platform: "wechat",
    timestamp: new Date("2026-01-01T00:02:00Z"),
    sender: "participant",
    participant_id: "wxid_alex",
    participant_name: "Alex",
    text: "ok",
    media_type: "text",
    reply_to_timestamp: null,
  },
];

const CONTACTS: ContactStats[] = [
  {
    contact_id: "wxid_alex",
    contact_name: "Alex",
    username: null,
    message_count_total: 200,
    message_count_from_me: 100,
    message_count_from_them: 100,
    first_message_at: new Date("2025-01-01T00:00:00Z"),
    last_message_at: new Date("2026-01-01T00:00:00Z"),
    span_days: 365,
  },
];

describe("group side-channel analyzers", () => {
  test("computes tone stats from group messages", () => {
    const stats = computeGroupToneStats(GROUP_MESSAGES, "groups.jsonl");
    expect(stats.total_group_messages).toBe(3);
    expect(stats.total_messages_from_me).toBe(1);
    expect(stats.total_groups).toBe(1);
    expect(stats.stats.lexical.total_tokens).toBeGreaterThan(0);
  });

  test("computes deterministic group contexts", () => {
    const bundle = computeGroupContexts(GROUP_MESSAGES, "groups.jsonl");
    expect(bundle.groups.length).toBe(1);
    expect(bundle.groups[0]?.group_id).toBe("project@chatroom");
    expect(bundle.groups[0]?.top_participants[0]?.participant_name).toBe("Alex");
    expect(bundle.groups[0]?.top_terms_from_me.length).toBeGreaterThan(0);
  });

  test("matches group participants to private contacts as weak signals", () => {
    const signals = computeGroupRelationshipSignals(GROUP_MESSAGES, CONTACTS);
    expect(signals.length).toBe(1);
    expect(signals[0]?.contact_id).toBe("wxid_alex");
    expect(signals[0]?.shared_groups).toBe(1);
    expect(signals[0]?.weight).toBe("weak");
    expect(signals[0]?.address_terms_from_me[0]?.term).toBe("Alex");
  });
});
