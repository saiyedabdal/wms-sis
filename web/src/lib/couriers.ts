/** Couriers Frido ships with, and where a customer-facing tracking page lives for an AWB. */
export const COURIERS: { value: string; label: string; track?: (awb: string) => string }[] = [
  { value: "Shiprocket", label: "Shiprocket", track: (awb) => `https://shiprocket.co/tracking/${encodeURIComponent(awb)}` },
  { value: "Delhivery", label: "Delhivery", track: (awb) => `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}` },
  { value: "Safexpress", label: "Safexpress", track: () => "https://www.safexpress.com/" },
  { value: "Blue Dart", label: "Blue Dart", track: (awb) => `https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo=${encodeURIComponent(awb)}` },
  { value: "Hand delivery", label: "Hand delivery / own vehicle" },
  { value: "Other", label: "Other" },
];

export function trackingUrl(courier: string | null | undefined, awb: string | null | undefined) {
  if (!courier || !awb) return null;
  return COURIERS.find((c) => c.value === courier)?.track?.(awb) ?? null;
}
