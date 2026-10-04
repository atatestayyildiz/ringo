import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next 16'da "middleware" dosya adı "proxy" oldu; iş mantığı lib/supabase/middleware.ts içinde.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
