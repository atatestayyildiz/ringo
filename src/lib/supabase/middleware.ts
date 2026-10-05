import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { supabaseEnv } from "./env";

/** Oturum gerektirmeyen tam yollar. */
const PUBLIC_EXACT_PATHS = new Set(["/sifre-sifirla", "/sifre-sifirla/yeni"]);

/** Oturumu yeniler; oturumsuzu /giris'e, oturumluyu /giris'ten /bugun'a yönlendirir. */
export async function updateSession(request: NextRequest) {
  // Telegram webhook'u ve zamanlayıcı kendi sırlarıyla doğrulanır; oturum yönlendirmesinden muaf.
  const p = request.nextUrl.pathname;
  if (p === "/api/telegram/webhook" || p.startsWith("/api/cron/")) return NextResponse.next({ request });
  // Şifre sıfırlama oturumsuz erişilir: yalnız TAM yol eşleşmesi (önek yok; /sifre-sifirla-x korunur).
  if (PUBLIC_EXACT_PATHS.has(p)) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  let signedIn = Boolean(data?.claims);
  const path = request.nextUrl.pathname;
  const onLogin = path === "/giris";

  // getClaims yalnız JWT imzasına bakar; sayfalar getUser ile sunucuya sorar. Oturum sunucuda kapatılmışsa
  // (başka cihazdan "tüm cihazlardan çık", şifre değişimi) iki karar ayrışır ve /giris <-> /bugun döngüsü olur.
  // /giris'ten ve kökten yönlendirmeden önce sunucuya sor; geçersizse yerel çerezi temizle ve girişi göster.
  if (signedIn && (onLogin || path === "/")) {
    const { data: u, error } = await supabase.auth.getUser();
    if (error || !u.user) {
      await supabase.auth.signOut({ scope: "local" });
      signedIn = false;
    }
  }

  const redirectTo = (to: string) => {
    const r = NextResponse.redirect(new URL(to, request.url));
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  if (!signedIn && !onLogin) return redirectTo("/giris");

  if (signedIn) {
    // Oturum var ama aktif üyelik yoksa çerezleri burada temizle (server component çerez yazamaz).
    const { data: member } = await supabase
      .from("members")
      .select("id")
      .eq("user_id", String(data?.claims?.sub))
      .eq("is_active", true)
      .maybeSingle();
    if (!member) {
      await supabase.auth.signOut({ scope: "local" });
      return onLogin ? response : redirectTo("/giris?hata=uye");
    }
  }

  // ?hata: giriş ekranı notu gösteriliyor, yönlendirme yapma.
  if (signedIn && ((onLogin && !request.nextUrl.searchParams.has("hata")) || path === "/")) return redirectTo("/bugun");
  return response;
}
