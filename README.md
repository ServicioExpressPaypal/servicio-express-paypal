# Calculadoras para Saldo Express Nicaragua

Sitio estatico listo para abrir en navegador o subir a un hosting.

La landing comercial anterior esta guardada en `_archive/` para mantenerla fuera
del sitio publico de GitHub Pages mientras se usa una version solo con
calculadoras.

## Cambios rapidos

- Nombre del proyecto: cambia `Saldo Express Nicaragua` en `index.html` y `script.js`.
- Comisiones compartidas: `calculator-core.js`. Calculadora de cajero: `script.js`.
- Logo: esta en `assets/logo-saldo-express.png`.

## Archivos

- `index.html`: pagina publica de calculadoras.
- `styles.css`: diseno visual y version movil.
- `script.js`: logica de calculo.
- `_archive/`: respaldo no publicado de la version comercial anterior.

## Publicacion

GitHub Actions publica los archivos enumerados en `.github/workflows/pages.yml`
desde `main`, despues de ejecutar las pruebas de cuentas, tickets y calculadora.
El artefacto no incluye `_archive/`, `supabase/`, `docs/` ni archivos de pruebas.

El prototipo esta en `https://saldoexpressnicaragua.com/_pilot/tickets/`.
Es una demostracion publica, no un portal privado: usa exclusivamente datos
ficticios y se reinicia al recargar. No hay autenticacion, correo ni pagos reales.
La pagina principal conserva las calculadoras; no dirige clientes al prototipo.
