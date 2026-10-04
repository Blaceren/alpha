import { redirect } from "next/navigation";

/**
 * /support → /profile/support.
 *
 * Support is a part of the profile since 2026-10-03 (owner: «что бы написать в
 * поддержку можно было только из профиля, не по ссылке из хеда»). The bar no
 * longer links here, but a bookmark, an old notification or a link in a letter
 * may: they arrive at the same desk, in its new place. A temporary redirect, so
 * nothing caches an answer the product may want to change again.
 */
export default function SupportPage() {
  redirect("/profile/support");
}
