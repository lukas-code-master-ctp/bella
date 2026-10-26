/**
 * Imágenes de un HTML pegado: en la vista previa cada imagen se puede apretar para elegirla o
 * cambiarla, y la elegida se escribe en el src de esa misma imagen del código.
 */

/** Las imágenes del código en orden, sin contar las que están dentro de un comentario. */
function imageTags(html: string) {
  const masked = html.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
  return [...masked.matchAll(/<img\b[^>]*>/gi)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
}

const SRC_RE = /(\ssrc\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i;

/** Cambia el src de la imagen número `index` (desde 0) del HTML. */
export function setImageSrc(html: string, index: number, url: string): string {
  const tag = imageTags(html)[index];
  if (!tag) return html;
  const safe = url.replace(/"/g, "%22");
  const old = html.slice(tag.start, tag.end);
  const next = SRC_RE.test(old) ? old.replace(SRC_RE, (_all, attr: string) => `${attr}"${safe}"`) : old.replace(/^<img\b/i, `<img src="${safe}"`);
  return html.slice(0, tag.start) + next + html.slice(tag.end);
}

/** Una imagen que todavía no es real: sin src, sin https:// o de un servicio de relleno. */
export function isPlaceholderImage(src: string | null | undefined): boolean {
  return !src || !/^https?:\/\//i.test(src.trim()) || /placehold\.co|placeholder\.com|placekitten|picsum\.photos/i.test(src);
}

const PLACEHOLDER_TEXT = "Haz clic aquí para agregar la imagen";

/**
 * Script de la vista previa (corre en un iframe aislado, sin acceso a Beliapp): muestra un recuadro
 * «Haz clic aquí…» en las imágenes de relleno y avisa a la página qué imagen se apretó.
 */
export const PREVIEW_IMAGE_SCRIPT = `<script>(function(){
var TEXT=${JSON.stringify(PLACEHOLDER_TEXT)};
function box(w,h){return "data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><rect x="1" y="1" width="'+(w-2)+'" height="'+(h-2)+'" rx="8" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8 6"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="'+Math.max(12,Math.min(18,Math.round(w/22)))+'" fill="#475569">'+TEXT+'</text></svg>');}
function ph(s){return !s||!/^https?:\\/\\//i.test(s.trim())||/placehold\\.co|placeholder\\.com|placekitten|picsum\\.photos/i.test(s);}
var imgs=document.getElementsByTagName("img");
for(var i=0;i<imgs.length;i++)(function(img,i){
var w=parseInt(img.getAttribute("width"),10)||600,h=Math.round(w*(parseInt(img.getAttribute("height"),10)/w||0.45));
function fill(){img.onerror=null;img.src=box(w,h);img.style.height="auto";}
if(ph(img.getAttribute("src")))fill();else img.onerror=fill;
img.style.cursor="pointer";img.title=ph(img.getAttribute("src"))?TEXT:"Haz clic para cambiar la imagen";
img.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();parent.postMessage({beliappImage:i},"*");});
})(imgs[i],i);
})();</script>`;

/** HTML de la vista previa con el script de las imágenes al final del body. */
export function withImagePicking(html: string): string {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${PREVIEW_IMAGE_SCRIPT}</body>`) : html + PREVIEW_IMAGE_SCRIPT;
}
