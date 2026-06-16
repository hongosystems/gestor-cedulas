import { redirect } from "next/navigation";

export default function RecibidosPage() {
  redirect("/app/documentos?tab=recibidos");
}
