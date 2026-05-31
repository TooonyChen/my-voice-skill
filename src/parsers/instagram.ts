import type { Message } from "../types/message.ts";

/**
 * Instagram DM parser. Stubbed for v0.1; the Meta export shape for IG DMs is
 * structurally similar to Messenger's but participants and media fields differ.
 * Wire this once the messenger pipeline is validated end-to-end.
 */
export async function parseInstagramExport(
  _exportRoot: string,
  _myName: string,
  _myAliases: string[] = [],
): Promise<Message[]> {
  throw new Error(
    "Instagram parser not implemented in v0.1. Use the messenger parser first; revisit IG after the pipeline is stable.",
  );
}
