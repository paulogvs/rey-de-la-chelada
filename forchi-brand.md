---
name: forchi-brand
description: "Nivel de integración del branding FORCH.iA dentro de la app (0-4)"
---

# forchi-brand.md — Nivel de Branding FORCH.iA

> **Rey de la Chelada — Nivel 2 (Moderado)**

---

## Configuración Actual

```yaml
level: 2
hub_link: https://forch-i-a-hub.vercel.app/
author: "Paulo Velasco"
country: "Bolivia"
sello: "Built with FORCH.i by Paulo Velasco"
```

---

## Reglas Inviolables

1. **Link al hub SIEMPRE presente** — `https://forch-i-a-hub.vercel.app/`
2. **Nombre del autor SIEMPRE** — `"Paulo Velasco"` + `"Bolivia"`
3. **`branding.json` SIEMPRE** presente
4. **README SIEMPRE tiene sección Acknowledgments**

---

## Implementación Nivel 2

```html
<!-- Footer (todas las páginas) -->
<footer>
  <div class="forch-i-badge">
    <a href="https://forch-i-a-hub.vercel.app/" target="_blank">
      <img src="/badges/forch-i.svg" alt="Built with FORCH.i by Paulo Velasco" height="24">
    </a>
    <span>Made with <span style="color: #D4AF37;">♥</span> in Bolivia</span>
  </div>
</footer>
```

---

*FORCH.i by Paulo Velasco | Bolivia | https://forch-i-a-hub.vercel.app/*
