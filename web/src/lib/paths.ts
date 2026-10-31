"use client";

import { useSearchParams } from "next/navigation";

/** The site is a static export, so record pages take their id from `?id=` instead of the path. */
export const paths = {
  facility: (id: number | string) => `/facilities/view/?id=${id}`,
  request: (id: number | string) => `/requests/view/?id=${id}`,
  dispatch: (foId: number | string) => `/fulfilment/dispatch/?id=${foId}`,
  receiveShipment: (shipmentId: number | string) => `/receive/shipment/?id=${shipmentId}`,
  grn: (id: number | string) => `/receive/grn/?id=${id}`,
};

export function useIdParam() {
  return useSearchParams().get("id") ?? "";
}

/** Login page per audience: retailers and super stockists have their own (with their onboarding form). */
export const loginPath = (who: "admin" | "field_sales" | "retailer" | "super_stockist") =>
  who === "retailer" ? "/login/retailer/" : who === "super_stockist" ? "/login/ss/" : "/login/";
