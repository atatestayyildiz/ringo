import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

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
      <label className="lbl" htmlFor={id} style={{ display: "block", fontSize: 12.5, fontWeight: 650, color: "var(--ink-2)", marginBottom: 6 }}>
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

export function Input({ label, hint, error, className, id, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
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

export function Textarea({ label, hint, error, className, id, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
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

export function Select({
  label,
  hint,
  error,
  className,
  id,
  children,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} id={fid}>
      <select
        id={fid}
        className={className ? `input ${className}` : "input"}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, { label, hint, error })}
        {...rest}
      >
        {children}
      </select>
    </Field>
  );
}

/** Yetki anahtarı. role="switch" ile okunur. */
export function Switch({
  label,
  className,
  ...rest
}: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role">) {
  return (
    <label className={className ? `switch ${className}` : "switch"}>
      <input type="checkbox" role="switch" {...rest} />
      <span className="track" aria-hidden="true" />
      <span className="txt">{label}</span>
    </label>
  );
}
