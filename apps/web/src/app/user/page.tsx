import { api } from "@repo/eden";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data } = await api.get();

  return (
    <div>
      {data?.message}: {data?.id}
    </div>
  );
}
