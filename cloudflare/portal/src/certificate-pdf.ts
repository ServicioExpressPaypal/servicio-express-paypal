import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type CertificatePdfInput = {
  code: string;
  ticketId: string;
  amount: string;
  issuedAt: string;
};

const printable = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  return btoa(binary);
}

export async function certificatePdfAttachment(input: CertificatePdfInput) {
  const document = await PDFDocument.create();
  document.setTitle(`Certificado ${printable(input.code)}`);
  document.setAuthor("Saldo Express");
  document.setSubject("Certificado de regalo digital");
  document.setCreator("Saldo Express");
  document.setProducer("Saldo Express");

  const page = document.addPage([792, 360]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const display = await document.embedFont(StandardFonts.TimesRomanBoldItalic);
  const navy = rgb(0.04, 0.15, 0.32);
  const muted = rgb(0.35, 0.4, 0.48);
  const red = rgb(0.72, 0.08, 0.08);
  const gold = rgb(0.73, 0.49, 0.18);
  const paper = rgb(0.99, 0.99, 0.98);

  page.drawRectangle({ x: 0, y: 0, width: 792, height: 360, color: paper });
  page.drawRectangle({
    x: 16,
    y: 16,
    width: 760,
    height: 328,
    borderColor: rgb(0.78, 0.8, 0.82),
    borderWidth: 1.2,
  });
  page.drawRectangle({ x: 54, y: 16, width: 50, height: 328, color: red });
  page.drawLine({
    start: { x: 578, y: 26 },
    end: { x: 578, y: 334 },
    color: muted,
    thickness: 1,
    dashArray: [5, 5],
  });

  page.drawText("SALDO EXPRESS", {
    x: 139,
    y: 296,
    font: bold,
    size: 11,
    color: gold,
  });
  page.drawText("CERTIFICADO DE REGALO", {
    x: 139,
    y: 254,
    font: bold,
    size: 22,
    color: navy,
  });
  page.drawText("Efectivo", {
    x: 139,
    y: 176,
    font: display,
    size: 65,
    color: navy,
  });
  page.drawLine({
    start: { x: 139, y: 157 },
    end: { x: 330, y: 157 },
    color: gold,
    thickness: 3,
  });
  page.drawText("MONTO DEL CERTIFICADO", {
    x: 139,
    y: 115,
    font: bold,
    size: 10,
    color: muted,
  });
  page.drawText(printable(input.amount), {
    x: 139,
    y: 76,
    font: bold,
    size: 27,
    color: navy,
  });

  const stubX = 605;
  const stub = (label: string, value: string, y: number, size = 12) => {
    page.drawText(label, {
      x: stubX,
      y,
      font: bold,
      size: 9,
      color: muted,
    });
    page.drawText(printable(value), {
      x: stubX,
      y: y - 24,
      font: bold,
      size,
      color: navy,
      maxWidth: 150,
    });
  };
  stub("CODIGO", input.code, 285, 10);
  stub("TICKET", input.ticketId, 207, 10);
  stub("EMITIDO", input.issuedAt, 129, 9);

  page.drawText(
    "Documento digital. El codigo identifica el certificado y su ticket.",
    {
      x: 139,
      y: 37,
      font: regular,
      size: 8,
      color: muted,
    },
  );

  const bytes = await document.save({ useObjectStreams: true });
  return {
    filename: `certificado-${printable(input.code)}.pdf`,
    content: toBase64(bytes),
  };
}
