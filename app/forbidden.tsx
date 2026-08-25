import { CanonicalRouteError } from "./canonical-route-error.tsx";
import { getTranslator } from "./i18n.ts";

export default async function Forbidden() {
  const { d } = await getTranslator();
  return (
    <CanonicalRouteError
      kind="forbidden"
      title={d.routeStatus.forbiddenTitle}
      body={d.routeStatus.forbiddenBody}
      back={d.routeStatus.back}
    />
  );
}
