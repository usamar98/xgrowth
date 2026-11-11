import { ownerAccess } from "@/app/owner-access";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => ownerAccess(request, false);
export const POST = GET;
