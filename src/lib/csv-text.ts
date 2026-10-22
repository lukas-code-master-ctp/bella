/**
 * Texto de un CSV subido. Excel en Windows guarda los CSV en Windows-1252 (Latin-1),
 * así que si los bytes no son UTF-8 válido se leen con esa codificación ("Pérez" y no "P�rez").
 */
export function decodeCsv(bytes: ArrayBuffer | Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}
