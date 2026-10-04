"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { distributeDayAction, logCallAction } from "@/app/(app)/bugun/actions";
import { IconArrow, IconChat, IconClock, IconInfo } from "@/components/icons";
import { Avatar, Button, Card, EmptyState, StatusBadge, useToast } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { CallbackDialog, ReasonDialog } from "./Dialogs";
import { FocusCard } from "./FocusCard";
import {
  OPERATORS,
  firstName,
  isCallOpen,
  logText,
  toneOf,
  type BirthdayInfo,
  type Item,
  type Outcome,
  type PoolInfo,
  type RuleNumbers,
  type TeamRow,
  type Tone,
} from "./model";
import styles from "./bugun.module.css";

type Props = {
  greeting: string;
  firstName: string;
  dateLabel: string;
  isManager: boolean;
  teamView: boolean;
  items: Item[];
  birthday: BirthdayInfo | null;
  pool: PoolInfo;
  rulesText: string;
  rules: RuleNumbers;
  team: TeamRow[] | null;
};

const LEGEND: [Tone, string][] = [
  ["wait", "Bekliyor"],
  ["retry", "Tekrar ara"],
  ["done", "Tamamlandı"],
  ["bad", "Uygun değil"],
  ["pool", "Havuza düştü"],
];

/** Sunucu cevabı gelmeden gösterilen geçici durum; kesin değer RPC dönüşüyle gelir. */
function provisional(outcome: Outcome): Item["status"] {
  if (outcome === "appointment" || outcome === "not_interested") return "done";
  if (outcome === "disqualified" || outcome === "wrong_number") return "disqualified";
  return "retry";
}

function defaultCursor(items: Item[]): string | null {
  return (items.find((i) => i.status === "pending") ?? items.find((i) => i.status === "retry") ?? items[0])?.id ?? null;
}

/** Sıradaki bekleyen müşteri (mevcuttan sonra, başa sararak); yoksa vakti gelmiş tekrar. */
function pickNext(items: Item[], fromId: string): string | null {
  const idx = items.findIndex((i) => i.id === fromId);
  const ordered = [...items.slice(idx + 1), ...items.slice(0, Math.max(idx, 0))];
  const now = Date.now();
  return (
    ordered.find((i) => i.status === "pending")?.id ??
    ordered.find((i) => i.status === "retry" && new Date(i.nextCallAt).getTime() <= now)?.id ??
    null
  );
}

export function BugunView(props: Props) {
  const { isManager, teamView, rules, pool, birthday, team } = props;
  const toast = useToast();

  const [prevItems, setPrevItems] = useState(props.items);
  const [items, setItems] = useState(props.items);
  const [curId, setCurId] = useState<string | null>(() => defaultCursor(props.items));
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [distributing, setDistributing] = useState(false);
  const [dialog, setDialog] = useState<{ kind: "callback" | "reason"; note: string } | null>(null);

  // Sunucu verisi yenilenince (revalidatePath, Dağıt) yerel durumu ona eşitle
  if (props.items !== prevItems) {
    setPrevItems(props.items);
    setItems(props.items);
    if (curId === null || !props.items.some((i) => i.id === curId)) setCurId(defaultCursor(props.items));
  }

  const slotsRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLElement>(null);

  useEffect(() => {
    slotsRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [curId]);

  const cur = items.find((i) => i.id === curId) ?? null;
  const count = (t: Tone) => items.filter((i) => toneOf(i.status) === t).length;
  const left = count("wait");
  const finished = count("done") + count("bad") + count("pool");

  async function submit(item: Item, outcome: Outcome, note: string, callbackAt?: Date) {
    // Aynı render içindeki çift dokunuşu engelle (state kapanışı henüz güncellenmemiş olabilir)
    if (busyRef.current || !isCallOpen(item.status)) return;
    busyRef.current = true;
    const snapshot = items;
    const trimmed = note.trim();
    const after = items.map((x) =>
      x.id === item.id
        ? { ...x, status: provisional(outcome), log: [...x.log, { outcome, note: trimmed || null }].slice(-3) }
        : x,
    );
    setBusy(true);
    setItems(after);
    const next = pickNext(after, item.id);
    setCurId(next ?? item.id);
    setNonce((n) => n + 1);
    const rect = focusRef.current?.getBoundingClientRect();
    if (rect && (rect.top < 0 || rect.top > window.innerHeight * 0.6)) {
      focusRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    const res = await logCallAction(item.id, outcome, trimmed || null, callbackAt ? callbackAt.toISOString() : null);
    busyRef.current = false;
    setBusy(false);
    if (!res.ok) {
      setItems(snapshot);
      setCurId(item.id);
      setNonce((n) => n + 1);
      toast(res.error, "error");
      return;
    }
    setItems((l) =>
      l.map((x) => (x.id === item.id ? { ...x, status: res.status, tries: res.attempts, nextCallAt: res.nextCallAt } : x)),
    );
    const who = firstName(item.name);
    if (res.status === "pool") {
      toast(`${who} ${rules.maxAttempts} denemeyi doldurdu, ${rules.poolWaitDays} gün sonra listeye döner.`);
    } else if (res.status === "unreachable") {
      toast(`${who} için ${rules.maxRounds} tur denendi, ulaşılamadı olarak kapandı.`);
    } else if (outcome === "callback") {
      toast(`Kaydedildi. ${who} ${relativeTime(res.nextCallAt)} aranacak.`);
    } else if (res.status === "retry") {
      toast(`Kaydedildi. ${who} tekrar listesinde (${res.attempts}/${rules.maxAttempts} deneme).`);
    } else {
      toast("Kaydedildi");
    }
  }

  function pick(outcome: Outcome, note: string) {
    if (!cur || busy || busyRef.current || !isCallOpen(cur.status)) return;
    if (outcome === "callback") return setDialog({ kind: "callback", note });
    if (outcome === "disqualified" && !note.trim()) return setDialog({ kind: "reason", note });
    void submit(cur, outcome, note);
  }

  async function distribute() {
    setDistributing(true);
    const res = await distributeDayAction();
    setDistributing(false);
    if (!res.ok) return toast(res.error, "error");
    toast(res.count > 0 ? `${res.count} müşteri dağıtıldı.` : "Dağıtılacak yeni müşteri yok.");
  }

  const retryItems = items.filter((i) => i.status === "retry");
  const queue = [...items].sort((a, b) => {
    const r = (i: Item) => (i.status === "pending" ? 0 : i.status === "retry" ? 1 : 2);
    return r(a) - r(b);
  });

  const title = teamView ? (
    <>
      Ekip bugün <em>{items.length}</em> kişiyi
      <br />
      arayacak.
    </>
  ) : left > 0 || items.length === 0 ? (
    <>
      Bugün <em>{left}</em> kişi
      <br />
      seni bekliyor.
    </>
  ) : (
    <>
      Liste <em>tamam.</em>
      <br />
      Eline sağlık.
    </>
  );

  return (
    <>
      <section className={styles.hero}>
        <p className={styles.hi}>
          {props.greeting}, {props.firstName}
        </p>
        <div className={styles.heroRow}>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.date}>
            <IconClock />
            <span>{props.dateLabel}</span>
          </div>
        </div>
        {items.length > 0 ? (
          <div className={styles.slotsWrap}>
            <div className={styles.slots} ref={slotsRef} role="group" aria-label="Bugünün listesi">
              {items.map((c, i) => {
                const t = toneOf(c.status);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.slot}${c.id === curId ? ` ${styles.cur}` : ""}`}
                    data-s={t}
                    aria-current={c.id === curId ? "true" : undefined}
                    aria-label={`${i + 1}. ${c.name}, ${statusLabel(c.status)}`}
                    title={`${c.name} · ${statusLabel(c.status)}`}
                    onClick={() => setCurId(c.id)}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className={styles.legend}>
              {LEGEND.map(([t, label]) => (
                <span key={t}>
                  <i style={{ background: `var(--c-${t})` }} />
                  {label} <b>{count(t)}</b>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {items.length === 0 ? (
        <Card style={{ marginTop: 18 }}>
          <EmptyState title="Bugün listen boş.">Yönetici dağıtım yapınca burada görünecek.</EmptyState>
        </Card>
      ) : null}

      <div className={styles.grid}>
        {cur ? (
          <section className={`card ${styles.s7} ${styles.focus}`} aria-live="polite" ref={focusRef}>
            <FocusCard key={`${cur.id}:${nonce}`} item={cur} busy={busy} onPick={pick} />
          </section>
        ) : null}

        {items.length > 0 ? (
          <div className={`${styles.stack} ${styles.s5}`}>
            <Card>
              <h2>
                Tekrar aranacaklar
                <Link href="/musteriler" className={styles.open} aria-label="Tümünü aç">
                  <IconArrow />
                </Link>
              </h2>
              {retryItems.length ? (
                retryItems.map((x) => {
                  const last = x.log[x.log.length - 1];
                  const future = last?.outcome === "callback";
                  return (
                    <div className={styles.row} key={x.id}>
                      <Avatar name={x.name} size={40} radius={14} />
                      <div className={styles.rowT}>
                        <b>{x.name}</b>
                        <span>{future ? `Geri arama ${relativeTime(x.nextCallAt)}` : last ? logText(last) : "Tekrar aranacak"}</span>
                      </div>
                      <div className={styles.tries} title={`${x.tries}/${rules.maxAttempts} deneme`}>
                        {Array.from({ length: rules.maxAttempts }, (_, i) => (
                          <i key={i} data-on={i < x.tries} />
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className={styles.empty}>Şu an tekrar aranacak kimse yok.</p>
              )}
              <div className={styles.rule}>
                <IconInfo />
                <div>
                  {props.rulesText}
                  {isManager ? (
                    <>
                      {" "}
                      <Link href="/ayarlar">Kuralları değiştir</Link>
                    </>
                  ) : null}
                </div>
              </div>
            </Card>

            {birthday ? <BirthdayCard b={birthday} /> : null}
          </div>
        ) : null}

        {items.length > 0 ? (
          <Card className={styles.s7}>
            <h2>
              Bugünün sırası
              <span className={styles.headNote}>
                {finished} / {items.length} bitti
              </span>
            </h2>
            <div>
              {queue.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className={`${styles.q}${x.id === curId ? ` ${styles.cur}` : ""}`}
                  onClick={() => {
                    setCurId(x.id);
                    focusRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
                  }}
                >
                  <Avatar name={x.name} size={42} radius={15} />
                  <div className={styles.qT}>
                    <b>{x.name}</b>
                    <span>
                      {[x.operator ? (OPERATORS[x.operator] ?? x.operator) : null, x.owner ?? x.appliedLabel]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <StatusBadge status={x.status} />
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        <div className={`${styles.stack} ${styles.s5}`}>
          <Card>
            <h2>
              Havuz
              <Link href="/havuz" className={styles.open} aria-label="Havuzu aç">
                <IconArrow />
              </Link>
            </h2>
            <div className={styles.poolBig}>
              <b>{pool.count}</b>
              <span>kişi bekliyor</span>
            </div>
            <p className={styles.empty}>
              {pool.count === 0 || pool.nearestDays === null ? (
                "Havuz şu an boş."
              ) : (
                <>
                  En yakın dönüş <b>{pool.nearestDays === 0 ? "bugün" : `${pool.nearestDays} gün sonra`}</b>.
                  {pool.thisWeek > 0 ? ` ${pool.thisWeek} kişi bu hafta listeye geri çıkacak.` : ""}
                </>
              )}
            </p>
          </Card>
        </div>

        {isManager && team ? (
          <>
            <Card className={styles.s7}>
              <h2>
                Ekibin bugünkü ilerlemesi
                <span className={styles.headNote}>
                  {team.reduce((s, t) => s + t.done, 0)} / {team.reduce((s, t) => s + t.assigned, 0)} bitti
                </span>
              </h2>
              {team.length ? (
                team.map((t) => (
                  <div className={styles.row} key={t.memberId}>
                    <Avatar name={t.name} size={40} radius={14} />
                    <div className={styles.rowT}>
                      <b>{t.name}</b>
                      <div className={styles.mini}>
                        <i style={{ width: `${t.assigned ? (t.done / t.assigned) * 100 : 0}%` }} />
                      </div>
                    </div>
                    <span className={styles.teamCount}>
                      {t.done}/{t.assigned}
                    </span>
                  </div>
                ))
              ) : (
                <p className={styles.empty}>Henüz atama yok.</p>
              )}
            </Card>
            <div className={`${styles.stack} ${styles.s5}`}>
              <Card>
                <h2>Dağıtım</h2>
                <div className={styles.distribute}>
                  <p>Bekleyen müşterileri bugünün listesine çalışanlar arasında eşit dağıtır. Aynı gün tekrar çalıştırırsan yalnız yeni gelenler eklenir.</p>
                  <Button variant="brand" onClick={distribute} disabled={distributing}>
                    {distributing ? "Dağıtılıyor" : "Dağıt"}
                  </Button>
                </div>
              </Card>
            </div>
          </>
        ) : null}
      </div>

      <CallbackDialog
        open={dialog?.kind === "callback"}
        onClose={() => setDialog(null)}
        onConfirm={(at) => {
          const d = dialog;
          setDialog(null);
          if (cur && d) void submit(cur, "callback", d.note, at);
        }}
      />
      <ReasonDialog
        open={dialog?.kind === "reason"}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => {
          setDialog(null);
          if (cur) void submit(cur, "disqualified", reason);
        }}
      />
    </>
  );
}

function statusLabel(s: Item["status"]): string {
  return { pending: "Bekliyor", retry: "Tekrar ara", pool: "Havuzda", done: "Tamamlandı", unreachable: "Ulaşılamadı", disqualified: "Uygun değil" }[s];
}

function BirthdayCard({ b }: { b: BirthdayInfo }) {
  return (
    <Card className={styles.bday}>
      <h2>Doğum günü yaklaşıyor</h2>
      <div className={styles.bdayBig}>
        {b.daysLeft === 0 ? "Bugün" : <>{b.daysLeft}<small>gün kaldı</small></>}
      </div>
      <p>
        <b>{b.name}</b> · {b.dateLabel}
        {b.more > 0 ? ` ve ${b.more} kişi daha` : ""}
        <br />
        Ufak bir tebrik mesajı geri dönüşü güçlendirir.
      </p>
      {b.waHref ? (
        <a
          className={`${styles.btn} ${styles.bdayBtn}`}
          href={`${b.waHref}?text=${encodeURIComponent("Doğum gününüz kutlu olsun!")}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconChat />
          Mesajı hazırla
        </a>
      ) : null}
    </Card>
  );
}
