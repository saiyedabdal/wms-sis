"use client";

import { useEffect, useRef, useState } from "react";
import { RiBarcodeLine, RiCameraLine, RiCameraOffLine } from "@remixicon/react";
import { Button, Input } from "./ui";

/**
 * Barcode entry. USB/Bluetooth scanners type the code + Enter into the box;
 * on phones the camera button decodes barcodes with ZXing.
 */
export function ScanInput({
  onScan,
  placeholder = "Scan or type SKU barcode, then Enter",
  disabled,
}: {
  onScan: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  // a scanner types into whatever has focus; refocus once the box becomes usable
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  useEffect(() => {
    if (!camera || disabled) return;
    let controls: { stop: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
          if (!result || cancelled) return;
          const text = result.getText();
          const now = Date.now();
          // the camera sees the same code many times a second
          if (text === lastRef.current.code && now - lastRef.current.at < 1500) return;
          lastRef.current = { code: text, at: now };
          navigator.vibrate?.(60);
          onScan(text);
        });
      } catch (e) {
        setCamErr(e instanceof Error ? e.message : "Camera unavailable");
        setCamera(false);
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [camera, disabled, onScan]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <RiBarcodeLine size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n700" />
          <Input
            ref={inputRef}
            value={code}
            autoFocus
            disabled={disabled}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (code.trim()) onScan(code.trim());
                setCode("");
              }
            }}
            placeholder={placeholder}
            className="pl-10"
          />
        </div>
        <Button type="button" variant="secondary" onClick={() => setCamera((c) => !c)} aria-label="Toggle camera">
          {camera ? <RiCameraOffLine size={18} /> : <RiCameraLine size={18} />}
          <span className="hidden sm:inline">{camera ? "Stop" : "Camera"}</span>
        </Button>
      </div>
      {camErr && <p className="text-xs text-red-a">{camErr}</p>}
      {camera && <video ref={videoRef} className="aspect-video w-full max-w-md rounded-md bg-ink object-cover" muted playsInline />}
    </div>
  );
}
