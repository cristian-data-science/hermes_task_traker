import { q } from "./agent-bridge/auth.mjs";
const t = await q("tasks:get", { id: process.argv[2] });
console.log({ agentState: t.agentState, sessionId: t.agentSessionId });
