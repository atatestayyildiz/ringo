"use client";

import { useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { saveBrandAction } from "@/app/(app)/ayarlar/actions";
import { Button, Card, Input, useToast } from "@/components/ui";
import type { TenantSettings } from "@/lib/session";
import { BRAND_SWATCHES, HEX_RE } from "./shared";
import s from "./ayarlar.module.css";

export function BrandPanel({ settings }: { settings: TenantSettings }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState(settings.brand_name);
  const [color, setColor] = useState(settings.brand_color);
  const [logo, setLogo] = useState(settings.logo_url ?? "");
  const [logoBroken, setLogoBroken] = useState(false);

  const hexOk = HEX_RE.test(color);
  const nameErr = name.trim() ? undefined : "Marka adı boş olamaz.";
  const colorErr = hexOk ? undefined : "Renk #RRGGBB biçiminde olmalı, örneğin #FF5E2B.";
  const previewColor = hexOk ? color : settings.brand_color;
  const mark = (name.trim()[0] ?? "M").toLocaleUpperCase("tr");

  const save = () => {
    if (nameErr || colorErr) {
      toast("Kırmızı işaretli alanları düzeltin.", "error");
      return;
    }
    start(async () => {
      const res = await saveBrandAction({ brand_name: name, brand_color: color, logo_url: logo });
      if (res.ok) toast("Marka kaydedildi.");
      else toast(res.error, "error");
    });
  };

  return (
    <div className={s.cols}>
      <Card>
        <h2>Marka</h2>
        <div className={s.formStack}>
          <Input label="Marka adı" value={name} maxLength={60} error={nameErr} onChange={(e) => setName(e.target.value)} />

          <div>
            <span className={s.label}>Marka rengi</span>
            <div className={s.swatches} role="group" aria-label="Hazır renkler">
              {BRAND_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  style={{ background: c }}
                  aria-label={`Renk ${c}`}
                  aria-pressed={color.toUpperCase() === c}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          <div className={s.colorRow}>
            <input
              type="color"
              className={s.picker}
              aria-label="Renk seçici"
              value={hexOk ? color.toLowerCase() : "#ff5e2b"}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
            />
            <Input
              label="Renk kodu"
              value={color}
              maxLength={7}
              error={colorErr}
              placeholder="#FF5E2B"
              onChange={(e) => setColor(e.target.value.trim())}
            />
          </div>

          <Input
            label="Logo adresi (isteğe bağlı)"
            hint="https:// ile başlayan bir görsel bağlantısı. Boşsa baş harf görünür."
            type="url"
            value={logo}
            placeholder="https://"
            onChange={(e) => {
              setLogo(e.target.value);
              setLogoBroken(false);
            }}
          />
        </div>
        <div className={s.actions}>
          <Button variant="brand" onClick={save} disabled={pending} style={{ "--brand": previewColor } as CSSProperties}>
            {pending ? "Kaydediliyor" : "Kaydet"}
          </Button>
        </div>
      </Card>

      <Card>
        <h2>Önizleme</h2>
        <div className={s.preview} style={{ "--brand": previewColor } as CSSProperties}>
          <div className={s.previewBody}>
            <div className={s.previewTop}>
              <span className="logo-mark" aria-hidden="true">
                {logo.trim() && !logoBroken ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo.trim()} alt="" onError={() => setLogoBroken(true)} />
                ) : (
                  mark
                )}
              </span>
              <span>{name.trim() || "Marka adı"}</span>
            </div>
            <Button variant="brand">Ara</Button>
          </div>
          {logoBroken ? <p className={s.warn}>Logo yüklenemedi. Adresi kontrol edin.</p> : null}
        </div>
      </Card>
    </div>
  );
}
