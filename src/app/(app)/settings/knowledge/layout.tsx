import { BookOpen, Package, Paperclip } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";

/** Conocimiento: lo que la asistente sabe y puede enviar (documentos, archivos e inventario). */
export default async function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  const [docs, files, items] = await Promise.all([db.knowledgeDoc.count(), db.mediaFile.count(), db.inventoryItem.count()]);
  return (
    <>
      <PageHeader
        title="Conocimiento"
        description="Todo lo que la asistente consulta para responder y lo que puede enviarle al cliente por el chat."
      />
      <SubTabs
        label="Secciones de conocimiento"
        tabs={[
          ["/settings/knowledge", "Base de conocimiento", <BookOpen key="i" />, docs],
          ["/settings/knowledge/files", "Archivos", <Paperclip key="i" />, files],
          ["/settings/knowledge/inventory", "Inventario", <Package key="i" />, items],
        ]}
      />
      {children}
    </>
  );
}
