"use client";

import dynamic from "next/dynamic";

export const ListingMapLazy = dynamic(
  () => import("@directoryone/ui/listings/map").then((m) => m.ListingMap),
  { ssr: false }
);
