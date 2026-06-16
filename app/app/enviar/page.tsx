import { redirect } from "next/navigation";

export default function EnviarPage() {
  redirect("/app/documentos?tab=enviar");
}
