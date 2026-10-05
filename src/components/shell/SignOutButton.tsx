"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { IconLogout } from "@/components/icons";
import { Button, Modal, RoundButton } from "@/components/ui";

function Confirm() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="brand" disabled={pending}>
      {pending ? "Çıkış yapılıyor" : "Çıkış yap"}
    </Button>
  );
}

/** Onay diyaloğu: onaylanınca sunucu eylemi (action) çalışır. */
export function SignOutDialog({
  open,
  onClose,
  action,
}: {
  open: boolean;
  onClose: () => void;
  action: () => void | Promise<void>;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Çıkış yapılsın mı?">
      <p style={{ color: "var(--ink-2)", fontSize: 14.5, lineHeight: 1.5 }}>
        Oturumun kapanır. Tekrar girmek için e-posta ve şifren gerekir.
      </p>
      <form action={action}>
        <div className="modal-foot">
          <Button variant="soft" data-autofocus onClick={onClose}>
            İptal
          </Button>
          <Confirm />
        </div>
      </form>
    </Modal>
  );
}

/** Çıkış önce onay diyaloğu açar; onaylanınca sunucu eylemi (action) çalışır. */
export function SignOutButton({
  action,
}: {
  action: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <RoundButton label="Çıkış yap" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <IconLogout />
      </RoundButton>
      <SignOutDialog open={open} onClose={() => setOpen(false)} action={action} />
    </>
  );
}
