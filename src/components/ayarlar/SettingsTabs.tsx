"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui";
import type { TenantSettings } from "@/lib/session";
import { BrandPanel } from "./BrandPanel";
import { NotificationsPanel, type SelfTelegram } from "./NotificationsPanel";
import { RulesForm } from "./RulesForm";
import type { MemberRow } from "./shared";
import { TeamPanel } from "./TeamPanel";
import s from "./ayarlar.module.css";

type Tab = "kurallar" | "ekip" | "bildirimler" | "marka";

export function SettingsTabs({
  settings,
  summary,
  members,
  emailWarning,
  selfTelegram,
}: {
  settings: TenantSettings;
  summary: string;
  members: MemberRow[];
  emailWarning: string | null;
  selfTelegram: SelfTelegram;
}) {
  const [tab, setTab] = useState<Tab>("kurallar");
  return (
    <>
      <div className={s.tabs}>
        <Segmented<Tab>
          label="Ayar bölümleri"
          value={tab}
          onChange={setTab}
          options={[
            { value: "kurallar", label: "Kurallar" },
            { value: "ekip", label: "Ekip" },
            { value: "bildirimler", label: "Bildirimler" },
            { value: "marka", label: "Marka" },
          ]}
        />
      </div>
      {tab === "kurallar" ? <RulesForm settings={settings} summary={summary} /> : null}
      {tab === "ekip" ? <TeamPanel members={members} emailWarning={emailWarning} /> : null}
      {tab === "bildirimler" ? <NotificationsPanel settings={settings} selfTelegram={selfTelegram} /> : null}
      {tab === "marka" ? <BrandPanel settings={settings} /> : null}
    </>
  );
}
