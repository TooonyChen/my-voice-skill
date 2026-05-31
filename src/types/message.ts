import { z } from "zod";

export const MediaType = z.enum([
  "text",
  "voice",
  "image",
  "video",
  "sticker",
  "reaction",
  "share",
  "gif",
  "file",
  "call",
  "unknown",
]);
export type MediaType = z.infer<typeof MediaType>;

export const Sender = z.enum(["me", "them"]);
export type Sender = z.infer<typeof Sender>;

export const Platform = z.enum(["messenger", "instagram", "wechat"]);
export type Platform = z.infer<typeof Platform>;

export const MessageSchema = z.object({
  contact_id: z.string(),
  contact_name: z.string(),
  timestamp: z.coerce.date(),
  sender: Sender,
  text: z.string().nullable(),
  media_type: MediaType,
  reply_to_timestamp: z.coerce.date().nullable(),
  platform: Platform,
});
export type Message = z.infer<typeof MessageSchema>;

export function isFromMe(m: Message): boolean {
  return m.sender === "me";
}

export function hasText(m: Message): m is Message & { text: string } {
  return typeof m.text === "string" && m.text.length > 0;
}
