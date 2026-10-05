"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { claimNextAction, distributeDayAction, logCallAction } from "@/app/(app)/bugun/actions";
import { IconArrow, IconChat, IconClock, IconInfo } from "@/components/icons";
import {
  Avatar,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  StatusBadge,
  useToast,
} from "@/components/ui";
import { formatDayMonth, formatTime, relativeTime } from "@/lib/format";
import { AppointmentDialog, type AppointmentValue } from "@/components/musteri/AppointmentDialog";
import { CallbackDialog, ReasonDialog } from "./Dialogs";
import { FocusCard } from "./FocusCard";
import {
  OPERATORS,
  firstName,
  isCallOpen,
  isDeferred,
  logText,
  toneOf,
  type BirthdayInfo,
  type ClaimInfo,
  type DistributionMode,
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
  todayKey: string;
  isManager: boolean;
  teamView: boolean;
  items: Item[];
  birthday: BirthdayInfo | null;
  pool: PoolInfo;
  /** Kiracının dağıtım yöntemi */
  mode: DistributionMode;
  /** Serbest havuz kartı sayıları; yalnız free_pool modunda dolu */
  claim: ClaimInfo | null;
  rulesText: string;
  rules: RuleNumbers;
  team: TeamRow[] | null;
  /** Hatırlatma kartından gelen müşteri: odak kartında açılır */
  focusId?: string | null;
};

const QUEUE_LIMIT = 6;

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
  if (outcome === "disqualified" || outcome === "wrong_number")
    return "disqualified";
  return "retry";
}

function defaultCursor(items: Item[]): string | null {
  return (
    (
      items.find((i) => i.status === "pending") ??
      items.find((i) => i.status === "retry") ??
      items[0]
    )?.id ?? null
  );
}

/** Sıradaki bekleyen müşteri (mevcuttan sonra, başa sararak); yoksa vakti gelmiş tekrar. */
function pickNext(items: Item[], fromId: string): string | null {
  const idx = items.findIndex((i) => i.id === fromId);
  const ordered = [
    ...items.slice(idx + 1),
    ...items.slice(0, Math.max(idx, 0)),
  ];
  const now = Date.now();
  return (
    ordered.find((i) => i.status === "pending")?.id ??
    ordered.find(
      (i) => i.status === "retry" && new Date(i.nextCallAt).getTime() <= now,
    )?.id ??
    null
  );
}

export function BugunView(props: Props) {
  const { isManager, teamView, rules, pool, birthday, team, mode, claim } = props;
  const toast = useToast();
  const router = useRouter();

  const { todayKey } = props;
  const activeOf = (l: Item[]) => l.filter((i) => !isDeferred(i, todayKey));
  const [prevItems, setPrevItems] = useState(props.items);
  const [allItems, setItems] = useState(props.items);
  const startCursor = (list: Item[]) =>
    props.focusId && list.some((i) => i.id === props.focusId)
      ? props.focusId
      : defaultCursor(list);
  const [curId, setCurId] = useState<string | null>(() =>
    startCursor(activeOf(props.items)),
  );
  const [prevFocus, setPrevFocus] = useState(props.focusId);
  if (props.focusId !== prevFocus) {
    setPrevFocus(props.focusId);
    if (props.focusId && activeOf(props.items).some((i) => i.id === props.focusId))
      setCurId(props.focusId);
  }
  const [showDeferred, setShowDeferred] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [distributing, setDistributing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [dialog, setDialog] = useState<{
    kind: "callback" | "reason" | "appointment";
    note: string;
  } | null>(null);

  // Sunucu verisi yenilenince (revalidatePath, Dağıt) yerel durumu ona eşitle
  if (props.items !== prevItems) {
    setPrevItems(props.items);
    setItems(props.items);
    const act = activeOf(props.items);
    if (curId === null || !act.some((i) => i.id === curId))
      setCurId(startCursor(act));
  }

  // Bugünden sonraya ertelenenler bugünün sayısından, çubuktan ve sıradan düşer
  const items = activeOf(allItems);
  const deferredItems = allItems
    .filter((i) => isDeferred(i, todayKey))
    .sort((a, b) => a.nextCallAt.localeCompare(b.nextCallAt));

  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<Tone | null>(null);
  const focusRef = useRef<HTMLElement>(null);
  // Daralt/Genişlet: basılan düğme ekranda aynı yerde kalır, içerik onun altında değişir
  const anchorRef = useRef<{ el: HTMLElement; top: number } | null>(null);

  function toggleQueue(e: React.MouseEvent<HTMLButtonElement>) {
    anchorRef.current = {
      el: e.currentTarget,
      top: e.currentTarget.getBoundingClientRect().top,
    };
    setShowAll((v) => !v);
  }

  useLayoutEffect(() => {
    const a = anchorRef.current;
    anchorRef.current = null;
    if (!a || !a.el.isConnected) return;
    const delta = a.el.getBoundingClientRect().top - a.top;
    if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, behavior: "instant" });
  }, [showAll]);

  const curFallback = items.some((i) => i.id === curId)
    ? curId
    : defaultCursor(items);
  const cur = items.find((i) => i.id === curFallback) ?? null;
  const count = (t: Tone) => items.filter((i) => toneOf(i.status) === t).length;
  const left = count("wait");
  const finished = count("done") + count("bad") + count("pool");

  async function submit(
    item: Item,
    outcome: Outcome,
    note: string,
    callbackAt?: Date,
    appointment?: AppointmentValue,
  ) {
    // Aynı render içindeki çift dokunuşu engelle (state kapanışı henüz güncellenmemiş olabilir)
    if (busyRef.current || !isCallOpen(item.status)) return;
    busyRef.current = true;
    const snapshot = allItems;
    const trimmed = note.trim();
    const after = allItems.map((x) =>
      x.id === item.id
        ? {
            ...x,
            status: provisional(outcome),
            log: [...x.log, { outcome, note: trimmed || null }].slice(-3),
          }
        : x,
    );
    setBusy(true);
    setItems(after);
    const next = pickNext(activeOf(after), item.id);
    setCurId(next ?? item.id);
    setNonce((n) => n + 1);
    const rect = focusRef.current?.getBoundingClientRect();
    if (rect && (rect.top < 0 || rect.top > window.innerHeight * 0.6)) {
      focusRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    const res = await logCallAction(
      item.id,
      outcome,
      trimmed || null,
      callbackAt ? callbackAt.toISOString() : null,
      appointment?.day ?? null,
      appointment?.time ?? null,
    );
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
      l.map((x) =>
        x.id === item.id
          ? {
              ...x,
              status: res.status,
              tries: res.attempts,
              nextCallAt: res.nextCallAt,
            }
          : x,
      ),
    );
    const who = firstName(item.name);
    if (res.status === "pool") {
      toast(
        `${who} ${rules.maxAttempts} denemeyi doldurdu, ${rules.poolWaitDays} gün sonra listeye döner.`,
      );
    } else if (res.status === "unreachable") {
      toast(
        `${who} için ${rules.maxRounds} tur denendi, ulaşılamadı olarak kapandı.`,
      );
    } else if (outcome === "callback") {
      toast(`Kaydedildi. ${who} ${relativeTime(res.nextCallAt)} aranacak.`);
    } else if (res.status === "retry") {
      toast(
        `Kaydedildi. ${who} tekrar listesinde (${res.attempts}/${rules.maxAttempts} deneme).`,
      );
    } else {
      toast("Kaydedildi");
    }
  }

  function pick(outcome: Outcome, note: string) {
    if (!cur || busy || busyRef.current || !isCallOpen(cur.status)) return;
    if (outcome === "callback") return setDialog({ kind: "callback", note });
    if (outcome === "appointment") return setDialog({ kind: "appointment", note });
    if (outcome === "disqualified" && !note.trim())
      return setDialog({ kind: "reason", note });
    void submit(cur, outcome, note);
  }

  async function distribute() {
    setDistributing(true);
    const res = await distributeDayAction();
    setDistributing(false);
    if (!res.ok) return toast(res.error, "error");
    toast(
      res.count > 0
        ? `${res.count} müşteri dağıtıldı.`
        : "Dağıtılacak yeni müşteri yok.",
    );
  }

  async function claimNext() {
    if (claiming) return;
    setClaiming(true);
    const res = await claimNextAction();
    setClaiming(false);
    if (!res.ok) return toast(res.error, "error");
    if (res.id === null) return toast("Şu an sırada bekleyen müşteri yok.");
    toast(`${res.name} listene eklendi.`);
    router.replace(`/bugun?m=${res.id}`, { scroll: false });
  }

  const showClaim = mode === "free_pool" && !isManager && !teamView && claim !== null;
  const atLimit = claim !== null && claim.open >= claim.limit;

  const matches = (i: Item) => filter === null || toneOf(i.status) === filter;
  const retryItems = items.filter((i) => i.status === "retry");
  const queue = items.filter(matches).sort((a, b) => {
    const r = (i: Item) =>
      i.status === "pending" ? 0 : i.status === "retry" ? 1 : 2;
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
            <div
              className={styles.slots}
              role="group"
              aria-label="Bugünün listesi"
            >
              {items.map((c, i) => {
                const t = toneOf(c.status);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.slot}${c.id === curId ? ` ${styles.cur}` : ""}`}
                    data-s={t}
                    data-dim={matches(c) ? undefined : "true"}
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
            <div
              className={styles.legend}
              role="group"
              aria-label="Duruma göre filtrele"
            >
              <button
                type="button"
                className={styles.chip}
                aria-pressed={filter === null}
                onClick={() => setFilter(null)}
              >
                Hepsi <b>{items.length}</b>
              </button>
              {LEGEND.map(([t, label]) => {
                const n = count(t);
                return (
                  <button
                    key={t}
                    type="button"
                    className={styles.chip}
                    aria-pressed={filter === t}
                    disabled={n === 0 && filter !== t}
                    onClick={() => setFilter((f) => (f === t ? null : t))}
                  >
                    <i style={{ background: `var(--c-${t})` }} />
                    {label} <b>{n}</b>
                  </button>
                );
              })}
            </div>
            {teamView ? <DayProgress items={items} count={count} /> : null}
          </div>
        ) : null}
      </section>

      {items.length === 0 ? (
        <Card style={{ marginTop: 18 }}>
          <EmptyState title="Bugün listen boş.">
            {deferredItems.length > 0
              ? "Ertelenenler vakti gelince listeye döner."
              : mode === "free_pool"
                ? "Sıradaki müşteriyi alarak başla."
                : mode === "manual"
                  ? "Yönetici müşteri atayınca burada görünecek."
                  : "Yönetici dağıtım yapınca burada görünecek."}
          </EmptyState>
        </Card>
      ) : null}

      {showClaim && claim ? (
        <Card className={styles.claimCard} data-testid="claim-card">
          <div className={styles.claimText}>
            <h2>Sıradaki müşteriyi al</h2>
            <p>
              {claim.waiting > 0 ? (
                <>
                  Sırada <b>{claim.waiting}</b> müşteri bekliyor.
                </>
              ) : (
                "Şu an sırada bekleyen müşteri yok."
              )}{" "}
              {atLimit
                ? `Listende ${claim.open} açık müşteri var, sınır ${claim.limit}. Onları arayınca yenisini alabilirsin.`
                : `Açık müşterin ${claim.open} / ${claim.limit}.`}
            </p>
          </div>
          <Button
            variant="brand"
            onClick={claimNext}
            disabled={claiming || atLimit || claim.waiting === 0}
          >
            {claiming ? "Alınıyor" : "Sıradaki müşteriyi al"}
          </Button>
        </Card>
      ) : null}

      <div className={styles.grid}>
        <div className={styles.colMain}>
          {cur ? (
            <section
              className={`card ${styles.focus}`}
              aria-live="polite"
              ref={focusRef}
            >
              <FocusCard
                key={`${cur.id}:${nonce}`}
                item={cur}
                busy={busy}
                onPick={pick}
              />
            </section>
          ) : null}

          {items.length > 0 ? (
            <Card className={styles.queueCard}>
              <div className={`${styles.qHead}${showAll ? ` ${styles.qHeadSticky}` : ""}`}>
                <h2>
                  Bugünün sırası
                  <span className={styles.headNote}>
                    {finished} / {items.length} bitti
                  </span>
                </h2>
                {queue.length > QUEUE_LIMIT ? (
                  <button
                    type="button"
                    className={styles.qToggle}
                    aria-expanded={showAll}
                    onClick={toggleQueue}
                  >
                    {showAll ? "Daralt" : `Tümünü göster (${queue.length})`}
                  </button>
                ) : null}
              </div>
              {queue.length === 0 ? (
                <p className={styles.empty}>Bu durumda müşteri yok.</p>
              ) : null}
              <div>
                {(showAll ? queue : queue.slice(0, QUEUE_LIMIT)).map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    className={`${styles.q}${x.id === curId ? ` ${styles.cur}` : ""}`}
                    onClick={() => {
                      setCurId(x.id);
                      focusRef.current?.scrollIntoView({
                        block: "start",
                        behavior: "smooth",
                      });
                    }}
                  >
                    <Avatar name={x.name} size={42} radius={15} />
                    <div className={styles.qT}>
                      <b>{x.name}</b>
                      <span>
                        {[
                          x.operator
                            ? (OPERATORS[x.operator] ?? x.operator)
                            : null,
                          x.owner ?? x.appliedLabel,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <StatusBadge status={x.status} />
                  </button>
                ))}
              </div>
              {queue.length > QUEUE_LIMIT ? (
                <button
                  type="button"
                  className={styles.more}
                  aria-expanded={showAll}
                  onClick={toggleQueue}
                >
                  {showAll
                    ? "Daha az göster"
                    : `Tümünü göster (${queue.length})`}
                </button>
              ) : null}
            </Card>
          ) : null}

          {deferredItems.length > 0 ? (
            <Card className={styles.deferredCard}>
              <button
                type="button"
                className={styles.deferredHead}
                aria-expanded={showDeferred}
                aria-controls="ertelendi-liste"
                onClick={() => setShowDeferred((v) => !v)}
              >
                <span>
                  Ertelendi
                  <span className={styles.headNote}> {deferredItems.length}</span>
                </span>
                <i className={styles.deferredCaret} aria-hidden />
              </button>
              {showDeferred ? (
                <div id="ertelendi-liste" className={styles.deferredList}>
                  {deferredItems.map((x) => (
                    <div className={styles.row} key={x.id}>
                      <Avatar name={x.name} size={40} radius={14} />
                      <div className={styles.rowT}>
                        <b>{x.name}</b>
                        <span>
                          Geri arama{" "}
                          {relativeTime(x.nextCallAt).startsWith("yarın")
                            ? relativeTime(x.nextCallAt)
                            : `${formatDayMonth(x.nextCallAt)} ${formatTime(x.nextCallAt)}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
          ) : null}

          {isManager && team ? (
            <Card className={styles.teamCard}>
              <h2>
                Ekibin bugünkü ilerlemesi
                <span className={styles.headNote}>
                  {team.reduce((s, t) => s + t.done, 0)} /{" "}
                  {team.reduce((s, t) => s + t.assigned, 0)} bitti
                </span>
              </h2>
              {team.length ? (
                team.map((t) => (
                  <div className={styles.row} key={t.memberId}>
                    <Avatar name={t.name} size={40} radius={14} />
                    <div className={styles.rowT}>
                      <b>{t.name}</b>
                      <div className={styles.mini}>
                        <i
                          style={{
                            width: `${t.assigned ? (t.done / t.assigned) * 100 : 0}%`,
                          }}
                        />
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
          ) : null}
        </div>
        <div className={styles.colSide}>
          {items.length > 0 ? (
            <div className={`${styles.stack} ${styles.retryStack}`}>
              <Card>
                <h2>
                  Tekrar aranacaklar
                  <Link
                    href="/musteriler"
                    className={styles.open}
                    aria-label="Tümünü aç"
                  >
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
                          <span>
                            {future
                              ? `Geri arama ${relativeTime(x.nextCallAt)}`
                              : last
                                ? logText(last)
                                : "Tekrar aranacak"}
                          </span>
                        </div>
                        <div
                          className={styles.tries}
                          title={`${x.tries}/${rules.maxAttempts} deneme`}
                        >
                          {Array.from({ length: rules.maxAttempts }, (_, i) => (
                            <i key={i} data-on={i < x.tries} />
                          ))}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className={styles.empty}>
                    Şu an tekrar aranacak kimse yok.
                  </p>
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

          <div className={`${styles.stack} ${styles.poolStack}`}>
            <Card>
              <h2>
                Havuz
                <Link
                  href="/havuz"
                  className={styles.open}
                  aria-label="Havuzu aç"
                >
                  <IconArrow />
                </Link>
              </h2>
              <div className={styles.poolBig}>
                <b data-testid="pool-count">{pool.count}</b>
                <span>kişi bekliyor</span>
              </div>
              <p className={styles.empty}>
                {pool.count === 0 || pool.nearestDays === null ? (
                  "Havuz şu an boş."
                ) : (
                  <>
                    En yakın dönüş{" "}
                    <b>
                      {pool.nearestDays === 0
                        ? "bugün"
                        : `${pool.nearestDays} gün sonra`}
                    </b>
                    .
                    {pool.thisWeek > 0
                      ? ` ${pool.thisWeek} kişi bu hafta listeye geri çıkacak.`
                      : ""}
                  </>
                )}
              </p>
            </Card>
          </div>

          {isManager && team ? (
            <div className={`${styles.stack} ${styles.distStack}`}>
              <Card>
                <h2>Dağıtım</h2>
                <div className={styles.distribute}>
                  {mode === "auto_even" ? (
                    <>
                      <p>
                        Bekleyen müşterileri bugünün listesine çalışanlar arasında
                        eşit dağıtır. Aynı gün tekrar çalıştırırsan yalnız yeni
                        gelenler eklenir.
                      </p>
                      <Button
                        variant="brand"
                        onClick={distribute}
                        disabled={distributing}
                      >
                        {distributing ? "Dağıtılıyor" : "Dağıt"}
                      </Button>
                    </>
                  ) : mode === "manual" ? (
                    <>
                      <p>
                        Elle dağıtım açık. Yeni müşterileri Müşteriler ekranında
                        seçip çalışana ata; atanan müşteri onun bugünkü listesine
                        düşer.
                      </p>
                      <ButtonLink variant="brand" href="/musteriler?atanan=yok">
                        Müşterileri ata
                      </ButtonLink>
                    </>
                  ) : (
                    <p>
                      Serbest havuz açık. Çalışanlar sıradaki müşteriyi kendileri
                      alır
                      {claim ? `, şu an sırada ${claim.waiting} müşteri var` : ""}.
                    </p>
                  )}
                </div>
              </Card>
            </div>
          ) : null}
        </div>
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
      <AppointmentDialog
        open={dialog?.kind === "appointment"}
        onClose={() => setDialog(null)}
        onConfirm={(v) => {
          const d = dialog;
          setDialog(null);
          if (cur && d) void submit(cur, "appointment", d.note, undefined, v);
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

const PROGRESS_PARTS: [Tone, string][] = [
  ["done", "Tamamlandı"],
  ["retry", "Tekrar ara"],
  ["bad", "Uygun değil"],
  ["pool", "Havuza düştü"],
];

/** Bugünün ilerleme çubuğu: toplam = %100, aranmış kısım durum renkleriyle bölünür, bekleyen nötr iz. */
function DayProgress({
  items,
  count,
}: {
  items: Item[];
  count: (t: Tone) => number;
}) {
  const total = items.length;
  const waiting = count("wait");
  const called = total - waiting;
  const pct = total ? Math.round((called / total) * 100) : 0;
  const parts = PROGRESS_PARTS.map(([t, label]) => ({ t, label, n: count(t) }));
  const summary = [
    `${called} / ${total} arandı, %${pct}`,
    ...parts.map((p) => `${p.label} ${p.n}`),
    `Bekliyor ${waiting}`,
  ].join(". ");
  return (
    <div className={styles.progress}>
      <div className={styles.progressHead}>
        <span>
          <b>{called}</b> / {total} arandı
        </span>
        <b className={styles.progressPct}>%{pct}</b>
      </div>
      <div className={styles.bar} role="img" aria-label={summary}>
        {parts.map((p) =>
          p.n > 0 ? (
            <i
              key={p.t}
              className={styles.seg}
              style={{ flexGrow: p.n, background: `var(--c-${p.t})` }}
            />
          ) : null,
        )}
        {waiting > 0 ? (
          <i
            className={`${styles.seg} ${styles.segWait}`}
            style={{ flexGrow: waiting }}
          />
        ) : null}
      </div>
    </div>
  );
}

function statusLabel(s: Item["status"]): string {
  return {
    pending: "Bekliyor",
    retry: "Tekrar ara",
    pool: "Havuzda",
    done: "Tamamlandı",
    unreachable: "Ulaşılamadı",
    disqualified: "Uygun değil",
  }[s];
}

function BirthdayCard({ b }: { b: BirthdayInfo }) {
  return (
    <Card className={styles.bday}>
      <h2>Doğum günü yaklaşıyor</h2>
      <div className={styles.bdayBig}>
        {b.daysLeft === 0 ? (
          "Bugün"
        ) : (
          <>
            {b.daysLeft}
            <small>gün kaldı</small>
          </>
        )}
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
