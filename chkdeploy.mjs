// Verificación remota: el HTML servido por producción referencia el bundle nuevo
const r = await fetch("https://agenttask.vercel.app/");
