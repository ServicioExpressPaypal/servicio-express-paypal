# Calculadoras para Saldo Express Nicaragua

Sitio estatico listo para abrir en navegador o subir a un hosting.

La landing comercial anterior esta guardada en `_archive/` para mantenerla fuera
del sitio publico de GitHub Pages mientras se usa una version solo con
calculadoras.

## Cambios rapidos

- Nombre del proyecto: cambia `Saldo Express Nicaragua` en `index.html`.
- Comisiones de la home: `home-calculators.js`. Interfaz: `home.js`.
- Logo: esta en `assets/logo-saldo-express.png`.

## Archivos

- `index.html`: pagina publica de calculadoras.
- `home.css`: diseno visual y version movil de la home.
- `home-calculators.js`: formulas puras de PayPal y Payoneer.
- `home.js`: conexion local entre los campos y los resultados.
- `styles.css`, `script.js` y `calculator-core.js`: recursos heredados de otras
  paginas publicadas; la home no los carga.
- `_archive/`: respaldo no publicado de la version comercial anterior.

## Publicacion

GitHub Actions publica los archivos enumerados en `.github/workflows/pages.yml`
desde `main`, despues de ejecutar las pruebas de cuentas, tickets y calculadora.
El artefacto no incluye `_archive/`, `supabase/`, `docs/` ni archivos de pruebas.

El prototipo esta en `https://saldoexpressnicaragua.com/_pilot/tickets/`.
Es una demostracion publica, no un portal privado: usa exclusivamente datos
ficticios y se reinicia al recargar. No hay autenticacion, correo ni pagos reales.
La pagina principal contiene solo calculadoras informativas y no enlaza el
prototipo ni el portal privado.
