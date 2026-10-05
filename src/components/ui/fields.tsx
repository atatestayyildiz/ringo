"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type {
  InputHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

type FieldProps = { label: string; hint?: string; error?: string };

function Field({
  label,
  hint,
  error,
  id,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="field">
      <label
        className="lbl"
        htmlFor={id}
        style={{
          display: "block",
          fontSize: 12.5,
          fontWeight: 650,
          color: "var(--ink-2)",
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
      {hint && !error ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="err" id={`${id}-err`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, p: FieldProps) =>
  p.error ? `${id}-err` : p.hint ? `${id}-hint` : undefined;

export function Input({
  label,
  hint,
  error,
  className,
  id,
  ...rest
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} id={fid}>
      <input
        id={fid}
        className={className ? `input ${className}` : "input"}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, { label, hint, error })}
        {...rest}
      />
    </Field>
  );
}

export function Textarea({
  label,
  hint,
  error,
  className,
  id,
  ...rest
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} id={fid}>
      <textarea
        id={fid}
        className={className ? `input ${className}` : "input"}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, { label, hint, error })}
        {...rest}
      />
    </Field>
  );
}

type Opt = { value: string; label: string; disabled: boolean; hidden: boolean };

/** <option> çocuklarını (fragment ve dizi dahil) düz listeye çevirir. */
function readOptions(children: ReactNode, out: Opt[] = []): Opt[] {
  Children.forEach(children, (ch) => {
    if (!isValidElement(ch)) return;
    const el = ch as ReactElement<{
      value?: string | number;
      disabled?: boolean;
      hidden?: boolean;
      children?: ReactNode;
    }>;
    if (el.type === "option") {
      const label = Children.toArray(el.props.children).join("");
      out.push({
        value: el.props.value === undefined ? label : String(el.props.value),
        label,
        disabled: !!el.props.disabled || !!el.props.hidden,
        hidden: !!el.props.hidden,
      });
    } else if (el.props.children) {
      readOptions(el.props.children, out);
    }
  });
  return out;
}

/** onChange'e giden olay: yerel select ile aynı `e.target.value` biçimi. */
export type SelectChange = {
  target: { value: string; name: string };
  currentTarget: { value: string; name: string };
};

type SelectBaseProps = {
  id?: string;
  name?: string;
  value?: string | number;
  defaultValue?: string | number;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  children?: ReactNode;
  onChange?: (e: SelectChange) => void;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

type Pos = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxH: number;
};

/**
 * Özel açılır liste (combobox + listbox). Odak düğmede kalır, aktif seçenek aria-activedescendant ile bildirilir.
 * `name` verilirse form gönderimi için gizli input taşır.
 */
export function SelectBase({
  id,
  name,
  value,
  defaultValue,
  disabled,
  required,
  className,
  children,
  onChange,
  ...aria
}: SelectBaseProps) {
  const auto = useId();
  const fid = id ?? auto;
  const listId = `${fid}-list`;
  const options = readOptions(children);
  const [inner, setInner] = useState(
    defaultValue === undefined ? "" : String(defaultValue),
  );
  const current = value === undefined ? inner : String(value);
  const selIndex = options.findIndex((o) => o.value === current);
  const sel = selIndex >= 0 ? options[selIndex] : options[0];

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<Pos | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const enabled = (i: number) =>
    i >= 0 && i < options.length && !options[i].disabled;
  const step = (from: number, dir: 1 | -1) => {
    let i = from;
    for (let n = 0; n < options.length; n++) {
      i += dir;
      if (i < 0 || i >= options.length) return from;
      if (enabled(i)) return i;
    }
    return from;
  };

  function place() {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const vh = window.innerHeight;
    // mobil yüzen menü açık sayfanın üstünde durur; liste onun altına taşmasın
    let floor = vh;
    if (!document.querySelector(".overlay")) {
      const nav = document.querySelector<HTMLElement>(".nav");
      if (nav && getComputedStyle(nav).position === "fixed")
        floor = Math.min(floor, nav.getBoundingClientRect().top);
    }
    const below = floor - r.bottom - 12;
    const above = r.top - 12;
    const want = Math.min(320, options.length * 46 + 12);
    const up = below < want && above > below;
    const width = Math.max(r.width, 200);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos(
      up
        ? { left, width, bottom: vh - r.top + 6, maxH: Math.min(320, above) }
        : { left, width, top: r.bottom + 6, maxH: Math.min(320, below) },
    );
  }

  function openList() {
    if (disabled || open) return;
    place();
    setActive(selIndex >= 0 && enabled(selIndex) ? selIndex : step(-1, 1));
    setOpen(true);
  }
  function close(focus = true) {
    setOpen(false);
    if (focus) btn.current?.focus();
  }
  function choose(i: number) {
    if (!enabled(i)) return;
    const v = options[i].value;
    if (value === undefined) setInner(v);
    setOpen(false);
    btn.current?.focus();
    if (v !== current)
      onChange?.({
        target: { value: v, name: name ?? "" },
        currentTarget: { value: v, name: name ?? "" },
      });
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (list.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (open && active >= 0)
      list.current
        ?.querySelector(`[data-i="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(e: ReactKeyboardEvent) {
    if (disabled) return;
    const k = e.key;
    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (k === "Escape") {
      e.preventDefault();
      // Next kökü document olduğundan stopPropagation yetmez; diyalogun document dinleyicisini de durdur
      e.nativeEvent.stopImmediatePropagation();
      close();
    } else if (k === "ArrowDown") {
      e.preventDefault();
      setActive((a) => step(a, 1));
    } else if (k === "ArrowUp") {
      e.preventDefault();
      setActive((a) => step(a, -1));
    } else if (k === "Home") {
      e.preventDefault();
      setActive(step(-1, 1));
    } else if (k === "End") {
      e.preventDefault();
      setActive(step(options.length, -1));
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      choose(active);
    } else if (k === "Tab") {
      setOpen(false);
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const t = typed.current;
      const ch = k.toLocaleLowerCase("tr");
      t.text = now - t.at > 700 ? ch : t.text + ch;
      t.at = now;
      const hit = options.findIndex(
        (o) =>
          !o.disabled && o.label.toLocaleLowerCase("tr").startsWith(t.text),
      );
      if (hit >= 0) setActive(hit);
    }
  }

  const empty = sel !== undefined && sel.value === "";
  return (
    <>
      <button
        ref={btn}
        id={fid}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && active >= 0 ? `${fid}-o${active}` : undefined
        }
        aria-required={required || undefined}
        className={`input sel-trigger${className ? ` ${className}` : ""}`}
        data-empty={empty || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        {...aria}
      >
        <span className="sel-text">{sel ? sel.label : ""}</span>
        <svg
          className="sel-caret"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {name ? (
        <input type="hidden" name={name} value={current} disabled={disabled} />
      ) : null}
      {open && pos
        ? createPortal(
            <div
              ref={list}
              id={listId}
              role="listbox"
              aria-label={aria["aria-label"]}
              className="sel-list"
              style={{
                left: pos.left,
                width: pos.width,
                top: pos.top,
                bottom: pos.bottom,
                maxHeight: pos.maxH,
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              {options.map((o, i) =>
                o.hidden ? null : (
                  <div
                    key={`${o.value}-${i}`}
                    id={`${fid}-o${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={o.value === current}
                    aria-disabled={o.disabled || undefined}
                    className={`sel-opt${i === active ? " is-active" : ""}`}
                    onMouseMove={() => !o.disabled && setActive(i)}
                    onClick={() => choose(i)}
                  >
                    <span>{o.label}</span>
                    {o.value === current ? (
                      <svg
                        className="sel-tick"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="m5 12.5 4.5 4.5L19 7.5" />
                      </svg>
                    ) : null}
                  </div>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function Select({
  label,
  hint,
  error,
  id,
  ...rest
}: FieldProps & SelectBaseProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} id={fid}>
      <SelectBase
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, { label, hint, error })}
        {...rest}
      />
    </Field>
  );
}

/** Yetki anahtarı. role="switch" ile okunur. */
export function Switch({
  label,
  className,
  ...rest
}: { label: string } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "role"
>) {
  return (
    <label className={className ? `switch ${className}` : "switch"}>
      <input type="checkbox" role="switch" {...rest} />
      <span className="track" aria-hidden="true" />
      <span className="txt">{label}</span>
    </label>
  );
}
