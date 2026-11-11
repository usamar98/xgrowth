import { handle } from "@/lib/server";
import { recordOutcome } from "@/lib/outcomes";
export async function POST(r: Request) {
  return handle(() => recordOutcome(r));
}
