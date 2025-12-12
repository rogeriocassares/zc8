import { api } from "@repo/eden";

export default async function Page() {
  const { data } = await api.get();

  return (
    <div>
      {data?.message}: {data?.id}
    </div>
  );
}
