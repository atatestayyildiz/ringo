"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  Avatar,
  Card,
  EmptyState,
  SelectBase,
  useToast,
} from "@/components/ui";
import { IconFunnel } from "@/components/icons";
import { appointmentBadge, compareAppointments } from "@/lib/appointment";
import { formatPhone } from "@/lib/format";
import { ChangeAppointmentDialog } from "./AppointmentDialog";
import { createClient } from "@/lib/supabase/client";
import {
  ALL_STAGES,
  MAIN_STAGES,
  memberName,
  OPERATOR_LABEL,
  SIDE_STAGES,
  STAGE_LABEL,
  type Customer,
  type MemberLite,
  type Viewer,
} from "./shared";
import "./musteri.css";
import { toUserMessage } from "@/lib/errors";

const APPT_OPTION = "__appointment";

type V = Pick<Viewer, "id" | "isManager">;

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

const reducedQuery = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(reducedQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(reducedQuery).matches,
    () => false,
  );
}

export function FunnelBoard({
  customers,
  members,
  viewer,
  reached,
}: {
  customers: Customer[];
  members: MemberLite[];
  viewer: V;
  /** MAIN_STAGES sırasıyla, o aşamaya (veya ilerisine) ulaşmış müşteri sayısı */
  reached: number[];
}) {
  const router = useRouter();
  const toast = useToast();
  const reduced = useReducedMotion();
  const [foldOpen, setFoldOpen] = useState(false);
  // İyimser taşıma: yalnız aynı sunucu verisi (customers) için geçerli; yenilenince düşer.
  const [moved, setMoved] = useState<{ base: Customer[]; map: Record<string, string> }>({
    base: customers,
    map: {},
  });
  const [pending, setPending] = useState<Record<string, true>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [apptFor, setApptFor] = useState<Customer | null>(null);

  const overrides = moved.base === customers ? moved.map : {};
  const effective = (() => {
    if (Object.keys(overrides).length === 0) return customers;
    const first: Customer[] = [];
    const rest: Customer[] = [];
    for (const c of customers) {
      const o = overrides[c.id];
      if (o)
        first.push({
          ...c,
          pipeline_stage: o,
          // DB, Randevu aşamasına geçişte zamanı "belli değil" yapar
          ...(o === "appointment" && c.pipeline_stage !== "appointment"
            ? { appointment_day: null, appointment_time: null }
            : {}),
        });
      else rest.push(c);
    }
    return [...first, ...rest];
  })();
  const by = (stage: string) => {
    const list = effective.filter((c) => c.pipeline_stage === stage);
    return stage === "appointment" ? list.sort(compareAppointments) : list;
  };
  const active = activeId
    ? (effective.find((c) => c.id === activeId) ?? null)
    : null;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
  );

  const move = async (c: Customer, stage: string) => {
    const current = overrides[c.id] ?? c.pipeline_stage;
    if (!stage || stage === current || pending[c.id]) return;
    setMoved((m) => ({
      base: customers,
      map: { ...(m.base === customers ? m.map : {}), [c.id]: stage },
    }));
    setPending((p) => ({ ...p, [c.id]: true }));
    const { error } = await createClient().rpc("set_pipeline_stage", {
      p_customer: c.id,
      p_stage: stage,
    });
    setPending((p) => {
      const n = { ...p };
      delete n[c.id];
      return n;
    });
    if (error) {
      setMoved((m) => {
        const map = { ...m.map };
        delete map[c.id];
        return { ...m, map };
      });
      toast(toUserMessage(error), "error");
      return;
    }
    toast(`${c.full_name}: ${STAGE_LABEL[stage]}`);
    router.refresh();
  };

  const onMenu = (c: Customer, value: string) => {
    if (value === APPT_OPTION) setApptFor(c);
    else void move(c, value);
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const c = effective.find((x) => x.id === e.active.id);
    const stage = e.over ? String(e.over.id) : null;
    if (c && stage && (ALL_STAGES as readonly string[]).includes(stage))
      void move(c, stage);
  };

  const nameOf = (id: unknown) =>
    effective.find((c) => c.id === id)?.full_name ?? "Kart";
  const stageOf = (id: unknown) => (id ? (STAGE_LABEL[String(id)] ?? "") : "");
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${nameOf(active.id)} tutuldu.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)}, ${stageOf(over.id)} üzerinde.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${nameOf(active.id)}, ${stageOf(over.id)} aşamasına bırakıldı.`
        : `${nameOf(active.id)} bırakıldı.`,
    onDragCancel: ({ active }) => `${nameOf(active.id)} taşıma iptal edildi.`,
  };

  if (customers.length === 0) {
    return (
      <Card>
        <EmptyState title="Huni boş" icon={<IconFunnel />}>
          Randevu alınan müşteriler burada aşama aşama görünür. Müşteri
          detayından veya aramada &quot;Dükkana gelecek&quot; seçerek başlatın.
        </EmptyState>
      </Card>
    );
  }

  const sideCount = SIDE_STAGES.reduce((n, s) => n + by(s).length, 0);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Kartı fareyle veya basılı tutarak sürükleyebilirsiniz. Klavye için Aşamayı değiştir menüsünü kullanın.",
        },
      }}
    >
      <div
        className="mu-board"
        role="list"
        aria-label="Huni aşamaları"
        data-dragging={active ? "" : undefined}
      >
        {MAIN_STAGES.map((stage, i) => {
          const list = by(stage);
          const prev = i > 0 ? reached[i - 1] : 0;
          const conv =
            i > 0 && prev > 0 ? Math.round((reached[i] / prev) * 100) : null;
          return (
            <Column key={stage} stage={stage} role="listitem">
              <div className="mu-col-head">
                <b>{STAGE_LABEL[stage]}</b>
                <span className="count">{list.length}</span>
              </div>
              <div
                className="mu-conv"
                title="Bu aşamaya ulaşan müşterilerin, bir önceki aşamaya ulaşanlara oranı"
              >
                {i === 0
                  ? `${reached[0]} müşteri ulaştı`
                  : conv === null
                    ? "Önceki aşamada kimse yok"
                    : `Bir öncekine göre %${conv}`}
              </div>
              <Cards
                list={list}
                members={members}
                viewer={viewer}
                busy={pending}
                activeId={activeId}
                onMove={onMenu}
              />
            </Column>
          );
        })}
      </div>

      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          className="mu-fold-toggle"
          aria-expanded={foldOpen}
          aria-controls="mu-fold"
          onClick={() => setFoldOpen((o) => !o)}
        >
          <span>
            {SIDE_STAGES.map((s) => `${STAGE_LABEL[s]} ${by(s).length}`).join(
              ", ",
            )}
          </span>
          <span aria-hidden="true">
            {foldOpen ? "Gizle" : sideCount > 0 ? "Göster" : "Aç"}
          </span>
        </button>
        {foldOpen ? (
          <div id="mu-fold" className="mu-fold-body">
            {SIDE_STAGES.map((stage) => (
              <Column key={stage} stage={stage}>
                <div className="mu-col-head">
                  <b>{STAGE_LABEL[stage]}</b>
                  <span className="count">{by(stage).length}</span>
                </div>
                <Cards
                  list={by(stage)}
                  members={members}
                  viewer={viewer}
                  busy={pending}
                  activeId={activeId}
                  onMove={onMenu}
                />
              </Column>
            ))}
          </div>
        ) : null}
      </div>

      <ChangeAppointmentDialog
        open={apptFor !== null}
        customerId={apptFor?.id ?? ""}
        initial={{ day: apptFor?.appointment_day ?? null, time: apptFor?.appointment_time ?? null }}
        onClose={() => setApptFor(null)}
        onDone={() => {
          setApptFor(null);
          router.refresh();
        }}
      />

      <DragOverlay dropAnimation={reduced ? null : undefined} zIndex={60}>
        {active ? (
          <article className="mu-card mu-card-overlay">
            <CardBody c={active} members={members} />
          </article>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  stage,
  role,
  children,
}: {
  stage: string;
  role?: "listitem";
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section
      ref={setNodeRef}
      className="mu-col"
      role={role}
      aria-label={STAGE_LABEL[stage]}
      data-over={isOver ? "" : undefined}
    >
      {children}
    </section>
  );
}

function Cards({
  list,
  members,
  viewer,
  busy,
  activeId,
  onMove,
}: {
  list: Customer[];
  members: MemberLite[];
  viewer: V;
  busy: Record<string, true>;
  activeId: string | null;
  onMove: (c: Customer, stage: string) => void;
}) {
  if (list.length === 0)
    return <div className="mu-empty-col">Bu aşamada müşteri yok</div>;
  return (
    <>
      {list.map((c) => (
        <FunnelCard
          key={c.id}
          c={c}
          members={members}
          viewer={viewer}
          busy={!!busy[c.id]}
          dragging={activeId === c.id}
          onMove={onMove}
        />
      ))}
    </>
  );
}

function AppointmentPill({ c }: { c: Customer }) {
  const b = appointmentBadge(c.pipeline_stage, c.appointment_day, c.appointment_time);
  return (
    <span className="mu-ap-badge" data-overdue={b.overdue ? "" : undefined}>
      {b.text}
    </span>
  );
}

function CardBody({ c, members }: { c: Customer; members: MemberLite[] }) {
  const who = memberName(members, c.assigned_to);
  return (
    <>
      <div className="mu-who">
        <Avatar name={c.full_name} />
        <span style={{ minWidth: 0 }}>
          <b>
            <span className="mu-first">{c.full_name.split(" ")[0]}</span>
            <span className="mu-rest">
              {c.full_name.slice(c.full_name.split(" ")[0].length)}
            </span>
          </b>
          <span>{formatPhone(c.phone)}</span>
        </span>
      </div>
      <div className="meta">
        {c.operator ? <span>{OPERATOR_LABEL[c.operator]}</span> : null}
        {who ? <span>{who}</span> : null}
      </div>
      {c.pipeline_stage === "appointment" ? <AppointmentPill c={c} /> : null}
      {c.last_note ? <p className="quote">{c.last_note}</p> : null}
    </>
  );
}

function FunnelCard({
  c,
  members,
  viewer,
  busy,
  dragging,
  onMove,
}: {
  c: Customer;
  members: MemberLite[];
  viewer: V;
  busy: boolean;
  dragging: boolean;
  onMove: (c: Customer, stage: string) => void;
}) {
  const canMove = viewer.isManager || c.assigned_to === viewer.id;
  const { setNodeRef, listeners } = useDraggable({
    id: c.id,
    disabled: !canMove || busy,
  });

  return (
    <article
      ref={setNodeRef}
      className="mu-card"
      title={c.full_name}
      data-draggable={canMove ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
      {...listeners}
    >
      {canMove ? (
        <span
          className="mu-grip"
          role="img"
          aria-label={`${c.full_name} kartını sürükle`}
        />
      ) : null}
      <CardBody c={c} members={members} />
      {canMove ? (
        <SelectBase
          className="mu-move"
          aria-label={`${c.full_name} için aşamayı değiştir`}
          value=""
          disabled={busy}
          onChange={(e) => onMove(c, e.target.value)}
        >
          <option value="" hidden>Aşamayı değiştir</option>
          {c.pipeline_stage === "appointment" ? (
            <option value={APPT_OPTION}>Randevu zamanını değiştir</option>
          ) : null}
          {ALL_STAGES.filter((s) => s !== c.pipeline_stage).map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </SelectBase>
      ) : null}
    </article>
  );
}
