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
