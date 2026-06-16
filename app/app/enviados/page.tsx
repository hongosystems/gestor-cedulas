import { redirect } from "next/navigation";

export default function EnviadosPage() {
  redirect("/app/documentos?tab=enviados");
}
