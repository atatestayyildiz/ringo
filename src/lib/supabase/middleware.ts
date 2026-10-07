import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { parseLockStatus } from "@/components/lock/activity";
import type { Database } from "@/lib/database.types";
import { supabaseEnv } from "./env";

/** Oturum gerektirmeyen tam yollar. */
const PUBLIC_EXACT_PATHS = new Set(["/sifre-sifirla", "/sifre-sifirla/yeni", "/api/meta/webhook", "/gizlilik"]);

/** Oturumsuz geçen yollar: `/api/cron/` öneki (kendi sırrıyla doğrulanır) ve tam eşleşmeler. */
export function isPublicPath(p: string): boolean {
  return p.startsWith("/api/cron/") || PUBLIC_EXACT_PATHS.has(p);
}

/**
 * Oturumu yeniler; oturumsuzu /giris'e, oturumluyu /giris'ten /bugun'a yönlendirir.
 * Panel kilidi: PIN yoksa /pin-belirle, kilitliyse /kilit (ikisi dışındaki tüm oturumlu yollar).
 */
export async function updateSession(request: NextRequest) {
  // Zamanlayıcı kendi sırrıyla doğrulanır; oturum yönlendirmesinden muaf.
  // Şifre sıfırlama, Meta webhook (kendi imzasıyla doğrulanır) ve gizlilik sayfası: yalnız TAM yol eşleşmesi.
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next({ request });

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
    // Tek RPC: aktif üyelik + panel kilidi + PIN durumu (üyelik yoksa null).
    const { data: st } = await supabase.rpc("lock_status");
    const lock = parseLockStatus(st);
    if (!lock) {
      // Oturum var ama aktif üyelik yoksa çerezleri burada temizle (server component çerez yazamaz).
      await supabase.auth.signOut({ scope: "local" });
      return onLogin ? response : redirectTo("/giris?hata=uye");
    }
    // ?hata: giriş ekranı notu gösteriliyor, yönlendirme yapma.
    if (onLogin && request.nextUrl.searchParams.has("hata")) return response;
    // PIN yoksa belirleme zorunlu; kilitliyse yalnız kilit ekranı. Panel verisi DB'de de kilitli.
    if (!lock.has_pin) return path === PIN_SETUP_PATH ? response : redirectTo(PIN_SETUP_PATH);
    if (lock.locked) return path === LOCK_PATH ? response : redirectTo(LOCK_PATH);
    if (onLogin || path === "/" || path === LOCK_PATH || path === PIN_SETUP_PATH) return redirectTo("/bugun");
  }

  return response;
}

const LOCK_PATH = "/kilit";
const PIN_SETUP_PATH = "/pin-belirle";
