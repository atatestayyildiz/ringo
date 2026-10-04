"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Card,
  EmptyState,
  SelectBase,
  useToast,
} from "@/components/ui";
import { IconFunnel } from "@/components/icons";
import { formatPhone } from "@/lib/format";
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

type V = Pick<Viewer, "id" | "isManager">;

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
  const [foldOpen, setFoldOpen] = useState(false);
  const by = (stage: string) =>
    customers.filter((c) => c.pipeline_stage === stage);

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
    <>
      <div className="mu-board" role="list" aria-label="Huni aşamaları">
        {MAIN_STAGES.map((stage, i) => {
          const list = by(stage);
          const prev = i > 0 ? reached[i - 1] : 0;
          const conv =
            i > 0 && prev > 0 ? Math.round((reached[i] / prev) * 100) : null;
          return (
            <section
              key={stage}
              className="mu-col"
              role="listitem"
              aria-label={STAGE_LABEL[stage]}
            >
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
              <Cards list={list} members={members} viewer={viewer} />
            </section>
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
              <section
                key={stage}
                className="mu-col"
                aria-label={STAGE_LABEL[stage]}
              >
                <div className="mu-col-head">
                  <b>{STAGE_LABEL[stage]}</b>
                  <span className="count">{by(stage).length}</span>
                </div>
                <Cards list={by(stage)} members={members} viewer={viewer} />
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

function Cards({
  list,
  members,
  viewer,
}: {
  list: Customer[];
  members: MemberLite[];
  viewer: V;
}) {
  if (list.length === 0)
    return <div className="mu-empty-col">Bu aşamada müşteri yok</div>;
  return (
    <>
      {list.map((c) => (
        <FunnelCard key={c.id} c={c} members={members} viewer={viewer} />
      ))}
    </>
  );
}

function FunnelCard({
  c,
  members,
  viewer,
}: {
  c: Customer;
  members: MemberLite[];
  viewer: V;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const canMove = viewer.isManager || c.assigned_to === viewer.id;
  const who = memberName(members, c.assigned_to);

  const move = async (stage: string) => {
    if (!stage || stage === c.pipeline_stage) return;
    setBusy(true);
    const { error } = await createClient().rpc("set_pipeline_stage", {
      p_customer: c.id,
      p_stage: stage,
    });
    setBusy(false);
    if (error) {
      toast(toUserMessage(error), "error");
      return;
    }
    toast(`${c.full_name}: ${STAGE_LABEL[stage]}`);
    router.refresh();
  };

  return (
    <article className="mu-card" title={c.full_name}>
      <div className="mu-who">
        <Avatar name={c.full_name} />
        <span style={{ minWidth: 0 }}>
          <b>
              <span className="mu-first">{c.full_name.split(" ")[0]}</span>
              <span className="mu-rest">{c.full_name.slice(c.full_name.split(" ")[0].length)}</span>
            </b>
          <span>{formatPhone(c.phone)}</span>
        </span>
      </div>
      <div className="meta">
        {c.operator ? <span>{OPERATOR_LABEL[c.operator]}</span> : null}
        {who ? <span>{who}</span> : null}
      </div>
      {c.last_note ? <p className="quote">{c.last_note}</p> : null}
      {canMove ? (
        <SelectBase
          className="mu-move"
          aria-label={`${c.full_name} için aşamayı değiştir`}
          value=""
          disabled={busy}
          onChange={(e) => move(e.target.value)}
        >
          <option value="" hidden>Aşamayı değiştir</option>
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
