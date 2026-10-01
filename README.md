# Saldo Express Nicaragua

Sitio publico de Saldo Express Nicaragua, alojado en GitHub Pages.

La landing comercial anterior esta guardada en `_archive/` para mantenerla fuera
del sitio publico. La portada activa presenta el Certificado de regalo en
efectivo, enlaza al portal privado e incluye calculadoras informativas.

## Cambios rapidos

- Nombre del proyecto: cambia `Saldo Express Nicaragua` en `index.html` y `script.js`.
- Comisiones compartidas: `calculator-core.js`. Calculadora de cajero: `script.js`.
- Logo: esta en `assets/logo-saldo-express.png`.

## Archivos

- `index.html`: pagina publica del producto y acceso al portal.
- `styles.css`: diseno visual y version movil.
- `script.js`: logica de calculo.
- `_archive/`: respaldo no publicado de la version comercial anterior.

## Publicacion

GitHub Actions publica los archivos enumerados en `.github/workflows/pages.yml`
desde `main`, despues de ejecutar las pruebas de cuentas, tickets y calculadora.
El artefacto no incluye `_archive/`, `supabase/`, `docs/` ni archivos de pruebas.

El portal de clientes esta en `https://portal.saldoexpressnicaragua.com/` y se
despliega por separado como un Worker de Cloudflare.
