import { ownerAccess } from "@/app/owner-access";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => ownerAccess(request, true);
export const POST = GET;
