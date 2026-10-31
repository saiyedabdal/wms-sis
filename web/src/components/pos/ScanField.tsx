"use client";

import { useEffect, useRef, useState } from "react";
import { RiBarcodeLine, RiCameraLine, RiCloseCircleFill } from "@remixicon/react";
import { Alert, Button, Modal, cx } from "./ui";

/**
 * Scan-first input. USB / Bluetooth scanners act as keyboards: they type the code and press Enter here.
 * Typing letters filters the product grid; the camera button scans with the device camera (ZXing).
 * Focus snaps back to this box after taps elsewhere so the next scan always lands (keyboard-wedge focus trap).
 */
export function ScanField({ value, onChange, onScan, trapFocus, autoCamera }: {
  value: string;
  onChange: (v: string) => void;
  onScan: (code: string) => void;
  trapFocus: boolean;
  autoCamera?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);

  useEffect(() => {
    if (!trapFocus) return;
    ref.current?.focus();
    const back = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      // leave real form fields alone; refocus after buttons / empty space
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      setTimeout(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!document.querySelector("[role=dialog]") && (!a || !["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName))) ref.current?.focus();
      }, 0);
    };
    document.addEventListener("focusin", back);
    document.addEventListener("click", back as unknown as EventListener);
    return () => { document.removeEventListener("focusin", back); document.removeEventListener("click", back as unknown as EventListener); };
  }, [trapFocus]);

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <RiBarcodeLine className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-n800" />
        <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} inputMode="search" autoComplete="off" spellCheck={false}
          onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) { e.preventDefault(); onScan(value.trim()); } }}
          placeholder="Scan a barcode or search products"
          aria-label="Scan a barcode or search products"
          className="h-14 w-full rounded-md border-2 border-ink bg-white pl-13 pr-11 text-lg font-medium placeholder:font-normal placeholder:text-n700 focus:outline-none focus:ring-4 focus:ring-yellow/60" />
        {value && (
          <button type="button" aria-label="Clear" onClick={() => { onChange(""); ref.current?.focus(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-n700 hover:text-ink"><RiCloseCircleFill className="h-6 w-6" /></button>
        )}
      </div>
      <Button variant="dark" size="lg" className={cx("px-4", autoCamera && "ring-2 ring-yellow")} onClick={() => setCamera(true)} aria-label="Scan with camera">
        <RiCameraLine className="h-6 w-6" /><span className="hidden xl:inline">Camera</span>
      </Button>
      <CameraScanner open={camera} onClose={() => setCamera(false)} onScan={(c) => { setCamera(false); onScan(c); }} />
    </div>
  );
}

function CameraScanner({ open, onClose, onScan }: { open: boolean; onClose: () => void; onScan: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let controls: { stop: () => void } | undefined;
    let done = false;
    setErr(null);
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video.current!, (res) => {
          if (res && !done) { done = true; navigator.vibrate?.(60); onScan(res.getText()); }
        });
      } catch (e) {
        setErr(e instanceof Error && e.name === "NotAllowedError" ? "Camera permission was refused. Allow it in the browser settings." : "No camera available on this device.");
      }
    })();
    return () => { done = true; controls?.stop(); };
  }, [open, onScan]);

  return (
    <Modal open={open} onClose={onClose} title="Scan with camera">
      {err ? <Alert>{err}</Alert> : (
        <div className="relative overflow-hidden rounded-md bg-ink">
          <video ref={video} className="aspect-[4/3] w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-b shadow-[0_0_8px_#f22b20]" />
        </div>
      )}
      <p className="mt-3 text-sm text-n800">Hold the barcode on the box label inside the frame.</p>
    </Modal>
  );
}
