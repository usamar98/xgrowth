export const sections = [
  { id: "overview", name: "Overview", group: "Workspace" },
  { id: "compose", name: "Compose", group: "Workspace" },
  { id: "drafts", name: "Drafts", group: "Workspace" },
  { id: "calendar", name: "Calendar & queue", group: "Workspace" },
  { id: "engage", name: "Engage", group: "Workspace" },
  { id: "analytics", name: "Analytics", group: "Workspace" },
  { id: "campaigns", name: "Campaigns", group: "Library" },
  { id: "inspiration", name: "Inspiration", group: "Library" },
  { id: "voice", name: "Voice & knowledge", group: "Library" },
  { id: "automations", name: "Automations", group: "Operations" },
  { id: "costs", name: "Costs & usage", group: "Operations" },
  { id: "activity", name: "Activity", group: "Operations" },
  { id: "settings", name: "Settings", group: "Operations" },
] as const;
export const brand = process.env.NEXT_PUBLIC_APP_NAME || "SignalDesk";
