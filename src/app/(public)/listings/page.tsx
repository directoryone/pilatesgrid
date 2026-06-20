import ListingsPage from "@directoryone/app/routes/public/listings";
export { generateMetadata } from "@directoryone/app/routes/public/listings";
import { ListingMapLazy } from "./listing-map-lazy";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <ListingsPage searchParams={searchParams} ListingMap={ListingMapLazy} />;
}
