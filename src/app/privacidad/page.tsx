import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { getLegalSettings } from "@/lib/domain/privacy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Política de privacidad" };

export default async function PrivacyPage() {
  const { legalName, contactEmail } = await getLegalSettings();
  const contact = contactEmail ? <a href={`mailto:${contactEmail}`}>{contactEmail}</a> : "los canales de atención de la empresa";
  return (
    <LegalPage title="Política de privacidad" updated="9 de octubre de 2026">
      <p>
        {legalName} usa Bella, su sistema de atención de clientes, para responder los mensajes que recibe por WhatsApp,
        Instagram y Facebook. Esta política explica qué datos guardamos, para qué y cómo puedes pedir que los borremos.
      </p>

      <h2>Qué datos guardamos</h2>
      <ul>
        <li>Tu nombre de perfil y el identificador de tu cuenta en el canal por el que nos escribes (y tu número, si es WhatsApp).</li>
        <li>Los mensajes, notas de voz y comentarios que nos envías, y nuestras respuestas.</li>
        <li>Los datos que nos entregas en la conversación para atenderte (por ejemplo, correo, RUT o el producto que te interesa).</li>
      </ul>

      <h2>Para qué los usamos</h2>
      <ul>
        <li>Responder tus consultas, enviarte la información que pides y darle seguimiento a tu solicitud.</li>
        <li>Asignarte un ejecutivo de ventas y coordinar la atención dentro del equipo.</li>
      </ul>
      <p>
        Parte de las respuestas las prepara un asistente de inteligencia artificial, que procesa el contenido de la
        conversación con proveedores de IA solo para generar la respuesta. Siempre puedes pedir hablar con una persona.
      </p>

      <h2>Con quién los compartimos</h2>
      <p>
        No vendemos tus datos. Solo los procesan los proveedores necesarios para operar el servicio: Meta (WhatsApp,
        Instagram y Facebook), el hosting y la base de datos de la aplicación, y el proveedor de IA.
      </p>

      <h2>Cuánto tiempo los guardamos</h2>
      <p>Mientras exista una relación comercial o una consulta abierta, o hasta que pidas eliminarlos.</p>

      <h2>Tus derechos</h2>
      <p>
        Puedes pedir acceso, rectificación o eliminación de tus datos, y oponerte a recibir mensajes, escribiendo a{" "}
        {contact}, conforme a la Ley N° 19.628 sobre protección de la vida privada y la Ley N° 21.719. También puedes
        pedir el borrado desde la configuración de tu cuenta de Facebook o Instagram; revisa{" "}
        <a href="/eliminacion-de-datos">cómo eliminar tus datos</a>.
      </p>

      <h2>Responsable</h2>
      <p>
        {legalName}
        {contactEmail ? <> · {contact}</> : null}
      </p>
    </LegalPage>
  );
}
