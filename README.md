# Don Zoilo Operaciones

Aplicación web móvil para registrar:

- Ventas
- Cobros
- Compras
- Pagos a proveedores
- Gastos
- Ajustes
- Kilos vendidos
- Saldos por cliente y proveedor

## Uso inmediato

Abrí `index.html` en un navegador. En modo local, los datos quedan guardados únicamente en ese dispositivo.

## Publicar con un link

La opción más rápida es Netlify Drop:

1. Descomprimí esta carpeta.
2. Entrá a Netlify Drop.
3. Arrastrá la carpeta completa.
4. Netlify generará un link HTTPS que podés abrir desde cualquier celular.

También se puede publicar en GitHub Pages, Vercel o Cloudflare Pages.

## Compartir datos entre varios dispositivos

1. Creá un proyecto gratuito en Supabase.
2. Abrí **SQL Editor** y ejecutá el archivo `supabase_schema.sql`.
3. En Supabase, copiá:
   - Project URL
   - anon public key
4. Abrí la app publicada.
5. Tocá **Configurar nube** y pegá ambos datos.

Desde ese momento, los movimientos quedan sincronizados online.

## Seguridad

La configuración incluida es un MVP: cualquiera con el link puede operar. Para producción se recomienda agregar usuarios, contraseña, permisos y auditoría de cambios.
