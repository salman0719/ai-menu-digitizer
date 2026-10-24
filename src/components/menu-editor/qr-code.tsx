"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * A QR code generated in the browser from a URL — no external image service,
 * nothing to leak. Shared by the publish panel and the wizard's success
 * screen; generation is a convenience, so a failure leaves the (visible)
 * link as the source of truth.
 */
export function QrCode({
  value,
  alt,
  size = 120,
}: {
  value: string;
  alt: string;
  /** Rendered CSS pixels; the bitmap is generated at 2x for crisp print. */
  size?: number;
}) {
  // Keep the URL alongside its bitmap so changing the link never shows the
  // previous code while the new one is being generated.
  const [qr, setQr] = useState<{ value: string; dataUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1c1917", light: "#ffffff" },
    })
      .then((next) => {
        if (!cancelled) setQr({ value, dataUrl: next });
      })
      .catch(() => {
        // The link beside the code remains usable.
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  const dataUrl = qr?.value === value ? qr.dataUrl : null;

  if (!dataUrl) {
    return (
      <div
        role="status"
        aria-label="Generating the QR code"
        className="animate-pulse rounded-lg bg-stone-100"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- QR data URL, generated locally
    <img
      src={dataUrl}
      alt={alt}
      width={size}
      height={size}
      className="rounded-lg"
      style={{ width: size, height: size }}
    />
  );
}
