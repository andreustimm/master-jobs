import { CanonicalRouteError } from "./canonical-route-error.tsx";
import { getTranslator } from "./i18n.ts";

export default async function NotFound() {
  const { d } = await getTranslator();
  return (
    <CanonicalRouteError
      kind="not-found"
      title={d.routeStatus.notFoundTitle}
      body={d.routeStatus.notFoundBody}
      back={d.routeStatus.back}
    />
  );
}
