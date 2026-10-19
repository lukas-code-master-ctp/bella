/*
 * Widget de chat de Beliapp. La empresa lo pega en su sitio:
 *   <script src="https://app.beliapp.cl/widget.js" data-company="<id>" async></script>
 * Dibuja una burbuja flotante (en un Shadow DOM, para no chocar con los estilos del sitio) y
 * conversa con /api/widget/<id>. Los mensajes llegan como leads del canal "Web".
 */
(function () {
  var script = document.currentScript;
  if (!script || window.__beliappWidget) return;
  window.__beliappWidget = true;
  var company = script.getAttribute("data-company");
  if (!company) return;
  var api = new URL(script.src).origin + "/api/widget/" + encodeURIComponent(company);
  var key = "beliapp:" + company + ":";

  function store(name, value) {
    try {
      if (value === undefined) return localStorage.getItem(key + name);
      localStorage.setItem(key + name, value);
    } catch (e) {
      return null;
    }
  }
  function randomId() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  var visitor = store("visitor");
  if (!visitor) {
    visitor = randomId();
    store("visitor", visitor);
  }

  var config = null;
  var messages = [];
  var open = false;
  var sending = false;
  var timer = null;
  var contact = null;
  try { contact = JSON.parse(store("contact") || "null"); } catch (e) {}

  function get() {
    return fetch(api + "?visitor=" + visitor, { credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error("widget " + r.status);
      return r.json();
    });
  }

  get().then(function (data) {
    config = data.config;
    messages = data.messages;
    mount();
  }).catch(function () {});

  var root, panel, list, form, input, bubble, badge, contactForm, errorBox;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function css(color, side) {
    return [
      ":host{all:initial}",
      "*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}",
      ".bubble{position:fixed;bottom:20px;" + side + ":20px;z-index:2147483646;width:60px;height:60px;border-radius:50%;border:0;background:" + color + ";color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(15,23,42,.25);display:flex;align-items:center;justify-content:center;transition:transform .15s}",
      ".bubble:hover{transform:scale(1.06)}.bubble:focus-visible{outline:3px solid " + color + ";outline-offset:3px}",
      ".bubble svg{width:28px;height:28px}",
      ".badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#e11d48;color:#fff;font-size:12px;font-weight:700;line-height:20px;text-align:center}",
      ".panel{position:fixed;bottom:92px;" + side + ":20px;z-index:2147483647;width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;box-shadow:0 16px 48px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;transition:opacity .18s,transform .18s}",
      ".panel.open{opacity:1;transform:none;pointer-events:auto}",
      "@media (max-width:480px){.panel{inset:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0}.panel.open~.bubble{display:none}}",
      ".head{background:" + color + ";color:#fff;padding:16px;display:flex;align-items:center;gap:12px}",
      ".head b{display:block;font-size:16px}.head span{font-size:13px;opacity:.85}",
      ".close{margin-left:auto;background:transparent;border:0;color:#fff;width:36px;height:36px;border-radius:8px;cursor:pointer;font-size:22px;line-height:1}",
      ".close:hover{background:rgba(255,255,255,.15)}",
      ".list{flex:1;overflow-y:auto;padding:16px;background:#f8fafc;display:flex;flex-direction:column;gap:8px}",
      ".msg{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}",
      ".agent{align-self:flex-start;background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-bottom-left-radius:4px}",
      ".visitor{align-self:flex-end;background:" + color + ";color:#fff;border-bottom-right-radius:4px}",
      ".msg a{color:inherit;text-decoration:underline}.msg img{display:block;max-width:100%;border-radius:8px;margin-bottom:4px}",
      ".pending{opacity:.6}",
      "form.send{display:flex;gap:8px;padding:12px;border-top:1px solid #e2e8f0;background:#fff}",
      "textarea,input{flex:1;font-size:14px;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;color:#0f172a;background:#fff;resize:none;outline:none}",
      "textarea:focus,input:focus{border-color:" + color + ";box-shadow:0 0 0 3px " + color + "33}",
      "button.go{background:" + color + ";color:#fff;border:0;border-radius:10px;padding:0 16px;font-weight:600;font-size:14px;cursor:pointer;min-height:42px}",
      "button.go:disabled{opacity:.5;cursor:default}",
      ".contact{padding:16px;display:flex;flex-direction:column;gap:10px;background:#fff;border-top:1px solid #e2e8f0}",
      ".contact p{margin:0;font-size:13px;color:#475569}",
      ".error{margin:0 12px;font-size:12px;color:#be123c}",
      ".foot{text-align:center;font-size:11px;color:#94a3b8;padding:0 0 8px;background:#fff}",
    ].join("");
  }

  var chatIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';

  function mount() {
    var host = el("div", { id: "beliapp-widget" });
    document.body.appendChild(host);
    root = host.attachShadow({ mode: "open" });
    root.appendChild(el("style", { text: css(config.color, config.position === "left" ? "left" : "right") }));

    var close = el("button", { class: "close", type: "button", "aria-label": "Cerrar chat", text: "×" });
    close.addEventListener("click", toggle);
    var head = el("div", { class: "head" }, [
      el("div", {}, [el("b", { text: config.title }), el("span", { text: config.assistantName })]),
      close,
    ]);
    list = el("div", { class: "list", role: "log", "aria-live": "polite" });
    errorBox = el("p", { class: "error", role: "alert" });

    input = el("textarea", { rows: "1", placeholder: "Escribe tu mensaje…", "aria-label": "Mensaje", maxlength: "2000" });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    var go = el("button", { class: "go", type: "submit", text: "Enviar" });
    form = el("form", { class: "send" }, [input, go]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      send();
    });

    contactForm = buildContactForm();
    panel = el("div", { class: "panel", role: "dialog", "aria-label": config.title }, [
      head,
      list,
      errorBox,
      contactForm || el("span"),
      form,
      el("div", { class: "foot", text: "Chat con Beliapp" }),
    ]);
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") toggle();
    });

    bubble = el("button", { class: "bubble", type: "button", "aria-label": "Abrir chat" });
    bubble.innerHTML = chatIcon;
    badge = el("span", { class: "badge", hidden: "" });
    bubble.appendChild(badge);
    bubble.addEventListener("click", toggle);

    root.appendChild(panel);
    root.appendChild(bubble);
    showContactStep();
    render();
    if (store("open") === "1") toggle();
    else schedule();
  }

  function buildContactForm() {
    if (!config.askContact || contact) return null;
    var name = el("input", { name: "name", placeholder: "Tu nombre", "aria-label": "Tu nombre", autocomplete: "name", required: "" });
    var phone = el("input", { name: "phone", type: "tel", placeholder: "Tu teléfono", "aria-label": "Tu teléfono", autocomplete: "tel", required: "" });
    var email = el("input", { name: "email", type: "email", placeholder: "Tu correo (opcional)", "aria-label": "Tu correo", autocomplete: "email" });
    var go = el("button", { class: "go", type: "submit", text: "Empezar a chatear" });
    var f = el("form", { class: "contact" }, [el("p", { text: "Déjanos tus datos para poder responderte." }), name, phone, email, go]);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!name.value.trim() || phone.value.replace(/\D/g, "").length < 8) {
        errorBox.textContent = "Escribe tu nombre y un teléfono válido.";
        return;
      }
      contact = { name: name.value.trim(), phone: phone.value.trim(), email: email.value.trim() };
      store("contact", JSON.stringify(contact));
      errorBox.textContent = "";
      showContactStep();
      input.focus();
    });
    return f;
  }

  function showContactStep() {
    var needsContact = config.askContact && !contact && !messages.length;
    if (contactForm) contactForm.style.display = needsContact ? "" : "none";
    form.style.display = needsContact ? "none" : "";
  }

  function linkify(text, node) {
    var parts = text.split(/(https?:\/\/[^\s]+)/g);
    parts.forEach(function (p, i) {
      if (i % 2) node.appendChild(el("a", { href: p, target: "_blank", rel: "noopener noreferrer", text: p }));
      else if (p) node.appendChild(document.createTextNode(p));
    });
  }

  function bubbleFor(m) {
    var node = el("div", { class: "msg " + m.from + (m.pending ? " pending" : "") });
    if (m.mediaUrl) {
      if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(m.mediaUrl)) node.appendChild(el("img", { src: m.mediaUrl, alt: m.mediaName || "Imagen" }));
      else node.appendChild(el("a", { href: m.mediaUrl, target: "_blank", rel: "noopener noreferrer", text: "📎 " + (m.mediaName || "Archivo adjunto") }));
      if (m.body) node.appendChild(document.createElement("br"));
    }
    if (m.body) linkify(m.body, node);
    return node;
  }

  function render() {
    list.innerHTML = "";
    if (config.greeting) list.appendChild(bubbleFor({ from: "agent", body: config.greeting }));
    messages.forEach(function (m) { list.appendChild(bubbleFor(m)); });
    list.scrollTop = list.scrollHeight;
    var seen = store("seen") || "";
    var unread = open ? 0 : messages.filter(function (m) { return m.from === "agent" && m.at > seen; }).length;
    if (open && messages.length) store("seen", messages[messages.length - 1].at);
    badge.textContent = String(unread);
    if (unread) badge.removeAttribute("hidden");
    else badge.setAttribute("hidden", "");
  }

  function refresh() {
    return get().then(function (data) {
      var before = JSON.stringify(messages);
      var pending = messages.filter(function (m) { return m.pending; });
      messages = data.messages.concat(pending);
      if (JSON.stringify(messages) !== before) render();
    }).catch(function () {});
  }

  function schedule() {
    clearTimeout(timer);
    // Abierto se revisa seguido; cerrado, solo si ya hay conversación (para el contador).
    if (!open && !messages.length) return;
    timer = setTimeout(function () {
      if (document.hidden) return schedule();
      refresh().then(schedule);
    }, open ? 3000 : 20000);
  }

  function toggle() {
    open = !open;
    store("open", open ? "1" : "0");
    panel.classList.toggle("open", open);
    bubble.setAttribute("aria-label", open ? "Cerrar chat" : "Abrir chat");
    render();
    if (open) {
      (contactForm && contactForm.style.display !== "none" ? contactForm.querySelector("input") : input).focus();
      refresh();
    }
    schedule();
  }

  function send() {
    var body = input.value.trim();
    if (!body || sending) return;
    sending = true;
    errorBox.textContent = "";
    var clientId = randomId();
    var optimistic = { id: clientId, from: "visitor", body: body, at: new Date().toISOString(), pending: true };
    messages.push(optimistic);
    input.value = "";
    render();
    var payload = { visitorId: visitor, clientId: clientId, body: body, pageUrl: location.href };
    if (contact) {
      payload.name = contact.name;
      payload.phone = contact.phone;
      payload.email = contact.email;
    }
    fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), credentials: "omit" })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.error || "No se pudo enviar. Intenta de nuevo.");
        });
      })
      .then(function () {
        messages = messages.filter(function (m) { return m !== optimistic; });
        return refresh();
      })
      .catch(function (e) {
        messages = messages.filter(function (m) { return m !== optimistic; });
        input.value = body;
        errorBox.textContent = e.message;
        render();
      })
      .then(function () {
        sending = false;
        schedule();
      });
  }
})();
