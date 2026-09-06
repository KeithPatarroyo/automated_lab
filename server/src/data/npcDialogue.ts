// lab_scientist and theoretical_scientist are NOT here - they're LLM agents now (see
// agents/personas.ts), reached via npc_chat_open/message instead of this canned-lines
// flow. This map is only for the remaining static flavor NPCs, including the minor
// background "worker" NPCs (see shared/src/protocol.ts's BACKGROUND_NPC_IDS) - those
// render with no floating name label, but are otherwise identical NPCs from here.
export const npcDialogue: Record<string, string[]> = {
  workshop_tech: [
    "Careful around the workbenches, some of that equipment is still warm.",
    "Let me know if you need the soldering iron, it's on the second bench.",
  ],
  kitchen_cook: ["Coffee's fresh. Help yourself.", "Mind the wet floor by the counter."],
  office_manager: [
    "Desk bookings are first come, first served this week.",
    "Let me know if you need anything set up for a meeting.",
  ],

  workshop_worker_1: [
    "Careful with the lathe, I just resharpened the bit.",
    "If you need custom mounts for the automated grower, I can mill a batch this afternoon.",
  ],
  workshop_worker_2: [
    "Still getting the hang of the CNC, don't mind the scrap pile.",
    "The lab scientist keeps asking for weirder sample holders every week.",
  ],

  lab_worker_1: [
    "Watch your step, we've got a new batch of SiC samples curing on that bench.",
    "The automated grower's been running non-stop since this morning.",
  ],
  lab_worker_2: [
    "I'm just logging inventory - let me know if you need a specific stacking-fault sample.",
    "Someone really needs to clean the centrifuge after they use it.",
  ],

  office_worker_1: [
    "If you're looking for the theorist, they were just at their desk a minute ago.",
    "Meeting room's booked all afternoon, sorry.",
  ],
  office_worker_2: [
    "I've been helping cross-check some of the information-content numbers - the spread this week is wild.",
    "Someone left their coffee on my desk again.",
  ],

  // Facilities Coordinator
  kitchen_worker_1: [
    "Grab a mug before the good coffee runs out.",
    "I've got a work order in for that flickering light in the corridor - should be fixed by Friday.",
  ],
  // Lab Safety Officer
  kitchen_worker_2: [
    "Reminder: gloves stay in the lab, not the kitchen.",
    "We're due for a fire-extinguisher inspection next week, don't mind me poking around.",
  ],
  // Operations Administrator
  kitchen_worker_3: [
    "If you need anything signed off, catch me before 3pm, I'm out after that.",
    "Someone still owes me their timesheet from last week.",
  ],
};

export function getNpcLines(npcId: string): string[] | undefined {
  return npcDialogue[npcId];
}
