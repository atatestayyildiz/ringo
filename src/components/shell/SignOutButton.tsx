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

/** Çıkış önce onay diyaloğu açar; onaylanınca sunucu eylemi (action) çalışır. */
export function SignOutButton({
  action,
}: {
  action: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <RoundButton
        label="Çıkış yap"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <IconLogout />
      </RoundButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Çıkış yapılsın mı?"
      >
        <p style={{ color: "var(--ink-2)", fontSize: 14.5, lineHeight: 1.5 }}>
          Oturumun kapanır. Tekrar girmek için e-posta ve şifren gerekir.
        </p>
        <form action={action}>
          <div className="modal-foot">
            <Button
              variant="soft"
              data-autofocus
              onClick={() => setOpen(false)}
            >
              İptal
            </Button>
            <Confirm />
          </div>
        </form>
      </Modal>
    </>
  );
}
