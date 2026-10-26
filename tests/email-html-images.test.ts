import { describe, expect, it } from "vitest";
import { isPlaceholderImage, setImageSrc, withImagePicking } from "@/lib/email-html-images";

describe("imágenes de un HTML pegado", () => {
  const html = '<!-- <img src="viejo.png"> --><p><img src="https://placehold.co/600x280"></p><img alt="sin src"><img src=foto.png width=300>';

  it("cambia el src de la imagen elegida, sin contar las comentadas", () => {
    expect(setImageSrc(html, 0, "https://blob/a.png")).toContain('<p><img src="https://blob/a.png"></p>');
    expect(setImageSrc(html, 1, "https://blob/b.png")).toContain('<img src="https://blob/b.png" alt="sin src">');
    expect(setImageSrc(html, 2, "https://blob/c.png")).toContain('<img src="https://blob/c.png" width=300>');
    expect(setImageSrc(html, 3, "https://blob/d.png")).toBe(html);
    expect(setImageSrc(html, 0, "https://blob/a.png")).toContain('<!-- <img src="viejo.png"> -->');
  });

  it("reconoce imágenes de relleno y agrega el script solo a la vista previa", () => {
    expect(isPlaceholderImage("https://placehold.co/600x280")).toBe(true);
    expect(isPlaceholderImage("C:/fotos/a.png")).toBe(true);
    expect(isPlaceholderImage("")).toBe(true);
    expect(isPlaceholderImage("https://x.public.blob.vercel-storage.com/a.png")).toBe(false);
    expect(withImagePicking("<html><body><p>Hola</p></body></html>")).toMatch(/<p>Hola<\/p><script>[\s\S]*beliappImage[\s\S]*<\/script><\/body><\/html>$/);
  });
});
