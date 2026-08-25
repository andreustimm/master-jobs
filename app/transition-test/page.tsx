import { notFound } from "next/navigation";
import { requirePage } from "../auth";
import { getTranslator } from "../i18n";
import { TransitionClientFailure } from "./client-failure";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  delay?: string | string[];
  error?: string | string[];
}>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function fixtureDelay(value: string | undefined): number {
  if (value === "prolonged") return 4200;
  if (value === "race-old") return 700;
  if (value === "race-new") return 1500;
  return 0;
}

export default async function TransitionTestPage({ searchParams }: { searchParams: SearchParams }) {
  // E2E_BASE already belongs to the isolated harness. Outside it this route is
  // absent, so production gains no delay/error control surface.
  if (!process.env.E2E_BASE) notFound();
  await requirePage("job:read");

  const query = await searchParams;
  const delay = fixtureDelay(first(query.delay));
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

  const { t } = await getTranslator();
  const errorToken = first(query.error);
  if (errorToken) {
    return <TransitionClientFailure token={errorToken} title={t("transition.loading")} />;
  }

  return (
    <main data-testid="transition-test-destination" className="pt-10" tabIndex={-1}>
      <h1 className="type-display-md">{t("transition.loading")}</h1>
    </main>
  );
}
