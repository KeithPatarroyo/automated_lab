import { describe, expect, it } from "vitest";
import { AGENT_NPC_IDS, BACKGROUND_NPC_IDS } from "@lab/shared";
import { getNpcLines } from "./npcDialogue.js";

describe("npcDialogue", () => {
  it("has at least one line for every BACKGROUND_NPC_ID", () => {
    for (const npcId of BACKGROUND_NPC_IDS) {
      const lines = getNpcLines(npcId);
      expect(lines, `missing dialogue for background npc "${npcId}"`).toBeDefined();
      expect(lines!.length, `no lines for background npc "${npcId}"`).toBeGreaterThan(0);
      for (const line of lines!) expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it("does not define canned dialogue for the LLM-agent npcIds - they use npc_chat instead", () => {
    for (const npcId of AGENT_NPC_IDS) {
      expect(getNpcLines(npcId)).toBeUndefined();
    }
  });
});
