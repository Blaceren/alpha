import { redirect } from "next/navigation";

/** Root: in mock/development mode, redirect to the operator's start screen. */
export default function RootPage() {
  redirect("/today");
}
