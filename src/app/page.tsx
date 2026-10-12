import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";

export default async function RootPage() {
  redirect((await currentUser()) ? "/w" : "/login");
}
