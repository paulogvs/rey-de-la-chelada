---
name: forchi-brand
description: "Nivel de integración del branding FORCH.iA dentro de la app (0-4)"
---

# forchi-brand.md — Nivel de Branding FORCH.iA

> **Rey de la Chelada — Nivel 2 (Moderado, Sutil y Mínimo)**

---

## Configuración Actual

```yaml
level: 2
hub_link: https://forch-i-a-hub.vercel.app/
author: "Paulo Velasco"
country: "Bolivia"
sello: "Built with FORCH.i"
subtle_minimal: true
badge_locations: [pwa-footer]
# Un solo badge por PWA: footer compartido (PwaLayout), sin "by Paulo Velasco"
```

---

## Reglas Inviolables

1. **Link al hub SIEMPRE presente** — `https://forch-i-a-hub.vercel.app/`
2. **Branding SUTIL y MÍNIMO** — `"Built with FORCH.i"` (SIN "by Paulo Velasco")
3. **UN SOLO badge por PWA** — en el footer compartido (`PwaLayout`), nunca inline
4. **`branding.json` SIEMPRE** presente
5. **README SIEMPRE tiene sección Acknowledgments**

---

## Implementación Nivel 2 (Sutil)

```html
<!-- Único badge: footer de PWA (PwaLayout) -->
<footer class="forchi-badge">
  <span>Built with </span>
  <a href="https://forch-i-a-hub.vercel.app/" target="_blank" rel="noopener noreferrer">FORCH.i</a>
</footer>
```

---

*FORCH.i | https://forch-i-a-hub.vercel.app/*
